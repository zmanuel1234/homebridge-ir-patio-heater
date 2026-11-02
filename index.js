'use strict';

const { TuyaCloud } = require('./lib/tuya');
const { PatioHeater } = require('./lib/heater');

const PLUGIN_NAME = 'homebridge-ir-patio-heater';
const PLATFORM_NAME = 'PatioHeater';

class PatioHeaterPlatform {
  constructor(log, config, api) {
    this.log = log;
    this.config = config || {};
    this.api = api;
    this.cached = new Map();
    this.heaters = [];

    api.on('didFinishLaunching', () => this.setup());
    api.on('shutdown', () => this.heaters.forEach((h) => h.stop()));
  }

  configureAccessory(accessory) {
    this.cached.set(accessory.UUID, accessory);
  }

  /** Returns the cached accessory for this id, or creates and registers a new one. */
  accessoryFor(id, name, category) {
    // Seeded differently from homebridge-tuya-platform so the UUIDs never collide.
    const uuid = this.api.hap.uuid.generate(id);
    this.keep.add(uuid);
    let accessory = this.cached.get(uuid);
    if (!accessory) {
      accessory = new this.api.platformAccessory(name, uuid, category);
      this.toRegister.push(accessory);
      this.log.info('Added %s.', name);
    }
    return accessory;
  }

  setup() {
    const { accessId, accessKey, endpoint } = this.config;
    const list = Array.isArray(this.config.heaters) ? this.config.heaters : [];
    if (!accessId || !accessKey) {
      this.log.error('accessId and accessKey are required (same values as in the Tuya plugin).');
      return;
    }

    this.cloud = new TuyaCloud({ endpoint, accessId, accessKey, log: this.log });
    this.keep = new Set();
    this.toRegister = [];
    const { Categories } = this.api.hap;

    for (const cfg of list) {
      if (!cfg.name || !cfg.blasterId || !cfg.remoteId) {
        this.log.error('Each heater needs name, blasterId and remoteId. Skipping: %j', cfg);
        continue;
      }
      if (cfg.temperatureSensorId || cfg.accessoryType === 'heater') {
        this.log.info('[%s] temperatureSensorId / accessoryType are no longer used; '
          + 'the patio sensor already shows in HomeKit through the Tuya plugin.', cfg.name);
      }

      if (cfg.showPowerButton !== undefined || cfg.showResetButton !== undefined
        || cfg.powerButtonName || cfg.resetButtonName) {
        this.log.info('[%s] Power/Reset buttons were replaced by Level and Out of Sync tiles in v1.0.4; '
          + 'the old settings are ignored.', cfg.name);
      }

      const main = this.accessoryFor(`patio-heater:${cfg.remoteId}`, cfg.name, Categories.SWITCH);
      const extra = {
        level: this.accessoryFor(`patio-heater:${cfg.remoteId}:level`,
          cfg.levelName || `${cfg.name} Level`, Categories.FAN),
      };
      if (cfg.showSyncButton !== false) {
        extra.sync = this.accessoryFor(`patio-heater:${cfg.remoteId}:sync`,
          cfg.syncName || `${cfg.name} Out of Sync`, Categories.SWITCH);
      }

      const heater = new PatioHeater(this, main, cfg, extra);
      this.heaters.push(heater);
    }

    if (this.toRegister.length) {
      this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, this.toRegister);
    }
    const stale = [...this.cached.values()].filter((a) => !this.keep.has(a.UUID));
    if (stale.length) {
      this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, stale);
      stale.forEach((a) => this.log.info('Removed %s (no longer in config).', a.displayName));
    }

    for (const heater of this.heaters) {
      heater.start().catch((err) => this.log.error('[%s] Start failed: %s', heater.name, err.message));
    }
  }
}

module.exports = (api) => {
  api.registerPlatform(PLATFORM_NAME, PatioHeaterPlatform);
};
