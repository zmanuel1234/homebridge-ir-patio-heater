import type { API, Categories, DynamicPlatformPlugin, Logging, PlatformAccessory, PlatformConfig } from 'homebridge';

import { PatioHeater, type HeaterConfig, type HeaterContext } from './heater.js';
import { PLATFORM_NAME, PLUGIN_NAME } from './settings.js';
import { TuyaCloud } from './tuya.js';

/** The platform's settings (config.schema.json). They come from the user's config.json, so each is checked before use. */
interface PatioHeaterConfig extends PlatformConfig {
  accessId?: string;
  accessKey?: string;
  endpoint?: string;
  heaters?: unknown;
}

export class PatioHeaterPlatform implements DynamicPlatformPlugin {
  readonly log: Logging;
  readonly config: PatioHeaterConfig;
  readonly api: API;
  readonly cached = new Map<string, PlatformAccessory>();
  readonly heaters: PatioHeater[] = [];
  cloud: TuyaCloud | null = null;
  keep = new Set<string>();
  toRegister: PlatformAccessory[] = [];

  constructor(log: Logging, config: PlatformConfig | undefined, api: API) {
    this.log = log;
    this.config = config || ({} as PatioHeaterConfig);
    this.api = api;

    api.on('didFinishLaunching', () => this.setup());
    api.on('shutdown', () => this.heaters.forEach((h) => h.stop()));
  }

  configureAccessory(accessory: PlatformAccessory) {
    this.cached.set(accessory.UUID, accessory);
  }

  /** Returns the cached accessory for this id, or creates and registers a new one. */
  accessoryFor(id: string, name: string, category: Categories) {
    // Ids are prefixed with "patio-heater:", so they can't collide with UUIDs another
    // plugin generates from the same Tuya device id.
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
    const list = (Array.isArray(this.config.heaters) ? this.config.heaters : []) as Partial<HeaterConfig>[];
    if (!accessId || !accessKey) {
      this.log.error('accessId and accessKey are required (the Access ID / Access Secret of your Tuya cloud project).');
      return;
    }

    const cloud = new TuyaCloud({ endpoint, accessId, accessKey, log: this.log });
    this.cloud = cloud;
    this.keep = new Set();
    this.toRegister = [];
    const { Categories } = this.api.hap;

    for (const entry of list) {
      if (!entry.name || !entry.blasterId || !entry.remoteId) {
        this.log.error('Each heater needs name, blasterId and remoteId. Skipping: %j', entry);
        continue;
      }
      const cfg = entry as HeaterConfig;
      const main = this.accessoryFor(`patio-heater:${cfg.remoteId}`, cfg.name, Categories.SWITCH);
      const extra: { level: PlatformAccessory; sync?: PlatformAccessory } = {
        level: this.accessoryFor(`patio-heater:${cfg.remoteId}:level`,
          cfg.levelName || `${cfg.name} Level`, Categories.FAN),
      };
      if (cfg.showSyncButton !== false) {
        extra.sync = this.accessoryFor(`patio-heater:${cfg.remoteId}:sync`,
          cfg.syncName || `${cfg.name} Out of Sync`, Categories.SWITCH);
      }

      const heater = new PatioHeater({ api: this.api, cloud, log: this.log },
        main as PlatformAccessory<HeaterContext>, cfg, extra);
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
      heater.start().catch((err: Error) => this.log.error('[%s] Start failed: %s', heater.name, err.message));
    }
  }
}
