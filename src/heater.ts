import type { API, CharacteristicValue, PlatformAccessory, Service, WithUUID } from 'homebridge';

import { sleep, type Log, type RemoteKey, type RemoteKeys, type TuyaCloud } from './tuya.js';

const norm = (s: string | undefined) => String(s || '').trim().toLowerCase();

/** One entry of the platform's "heaters" setting (config.schema.json). */
export interface HeaterConfig {
  name: string;
  blasterId: string;
  remoteId: string;
  levelName?: string;
  syncName?: string;
  showSyncButton?: boolean;
  powerKey?: string;
  levelKeys?: string[];
  defaultLevel?: number;
  keyDelayMs?: number;
  levelRepeat?: number;
  levelRepeatDelayMs?: number;
  debounceMs?: number;
  plugId?: string;
  plugCode?: string;
  plugPowerUpDelayMs?: number;
  plugPollSeconds?: number;
  autoOffMinutes?: number;
}

/** What HomeKit last showed, kept in the main accessory's context across restarts. */
export interface HeaterState {
  on: boolean;
  level: number;
}

export interface HeaterContext {
  state?: Partial<HeaterState>;
}

/** The Tuya calls the heater makes. */
export type HeaterCloud = Pick<TuyaCloud, 'getRemoteKeys' | 'pressKey' | 'getStatus' | 'sendCommands'>;

/** What the heater needs from the platform. */
export interface HeaterHost {
  api: API;
  cloud: HeaterCloud;
  log: Log;
}

interface Keys {
  power: RemoteKey;
  levels: RemoteKey[];
}

/**
 * One IR-controlled patio heater, shown in HomeKit as three tiles:
 *
 *  - Heater (switch): the only tile that turns the heater ON. On = Power,
 *    wait, level. Off = Power.
 *  - Level (fan slider): sets 500/1000/1500 W. Never turns the heater on.
 *    Off / slider to zero does the same as Heater off. Mirrors Heater's state.
 *  - Out of Sync (button): flips HomeKit's on/off belief without sending
 *    anything, for when a Power press was missed.
 *
 * The heater cannot report its state and its Power button is a toggle, so
 * HomeKit can only ever be wrong by being inverted, which one flip fixes.
 * With an optional Tuya smart plug, "off" cuts power, which is always correct.
 */
export class PatioHeater {
  readonly platform: HeaterHost;
  readonly api: API;
  readonly cloud: HeaterCloud;
  readonly accessory: PlatformAccessory<HeaterContext>;
  readonly cfg: HeaterConfig;
  readonly levelAccessory: PlatformAccessory | null;
  readonly syncAccessory: PlatformAccessory | null;
  readonly name: string;
  readonly log: Log;

  readonly levelNames: string[];
  readonly maxLevel: number;
  readonly powerKeyName: string;
  readonly keyDelayMs: number;
  readonly levelRepeat: number;
  readonly levelRepeatDelayMs: number;
  readonly debounceMs: number;
  timings: string[] = [];
  readonly powerUpDelayMs: number;
  readonly plugId: string;
  readonly plugCode: string;
  readonly autoOffMinutes: number;

  state: HeaterState;
  desired: HeaterState;
  offRequested = false;
  requestedAt: number | null = null;
  busy = false;

  remote: RemoteKeys | null = null; // keys from Tuya, loaded in start()
  keys: Keys | null = null;
  queue: Promise<void> = Promise.resolve();
  timer: NodeJS.Timeout | null = null;
  autoOffTimer: NodeJS.Timeout | null = null;
  retryTimer?: NodeJS.Timeout;
  snapTimer?: NodeJS.Timeout;
  syncResetTimer?: NodeJS.Timeout;
  plugInterval?: NodeJS.Timeout;

  readonly heaterSwitch: Service;
  levelFan?: Service;
  syncSwitch?: Service;

  constructor(platform: HeaterHost, accessory: PlatformAccessory<HeaterContext>, cfg: HeaterConfig,
    extra: { level?: PlatformAccessory; sync?: PlatformAccessory } = {}) {
    this.platform = platform;
    this.api = platform.api;
    this.cloud = platform.cloud;
    this.accessory = accessory;
    this.cfg = cfg;
    this.levelAccessory = extra.level || null;
    this.syncAccessory = extra.sync || null;
    this.name = cfg.name;
    this.log = {
      info: (m, ...a) => platform.log.info(`[${this.name}] ${m}`, ...a),
      warn: (m, ...a) => platform.log.warn(`[${this.name}] ${m}`, ...a),
      error: (m, ...a) => platform.log.error(`[${this.name}] ${m}`, ...a),
      debug: (m, ...a) => platform.log.debug(`[${this.name}] ${m}`, ...a),
    };

    this.levelNames = cfg.levelKeys && cfg.levelKeys.length ? cfg.levelKeys : ['500W', '1000W', '1500W'];
    this.maxLevel = this.levelNames.length;
    this.powerKeyName = cfg.powerKey || 'power';
    this.keyDelayMs = cfg.keyDelayMs ?? 1000;
    // Level presses are idempotent on these heaters, so they are repeated to
    // survive a missed IR press. Power is a toggle and is never repeated.
    this.levelRepeat = Math.max(1, Math.min(cfg.levelRepeat ?? 2, 4));
    this.levelRepeatDelayMs = cfg.levelRepeatDelayMs ?? 700;
    this.debounceMs = cfg.debounceMs ?? 150;
    this.powerUpDelayMs = cfg.plugPowerUpDelayMs ?? 4000;
    this.plugId = cfg.plugId || '';
    this.plugCode = cfg.plugCode || 'switch_1';
    this.autoOffMinutes = this.plugId ? (cfg.autoOffMinutes || 0) : 0;
    if (!this.plugId && cfg.autoOffMinutes) {
      this.log.warn('autoOffMinutes needs plugId and is ignored: without a plug, "off" is a Power toggle '
        + 'that could switch the heater ON if it was already off.');
    }

    const defaultLevel = Math.min(Math.max(cfg.defaultLevel || this.maxLevel, 1), this.maxLevel);
    const saved = accessory.context.state || {};
    this.state = {
      on: !!saved.on,
      level: saved.level !== undefined && saved.level >= 1 && saved.level <= this.maxLevel ? saved.level : defaultLevel,
    };
    this.desired = { ...this.state };

    this.heaterSwitch = this.setupServices();
  }

  // ---------- HomeKit ----------

  setInfo(accessory: PlatformAccessory, model: string) {
    const { Service, Characteristic } = this.api.hap;
    accessory.getService(Service.AccessoryInformation)
      ?.setCharacteristic(Characteristic.Manufacturer, 'Patio Heater (IR)')
      .setCharacteristic(Characteristic.Model, model)
      .setCharacteristic(Characteristic.SerialNumber, `${this.cfg.remoteId}-${model.toLowerCase().replace(/\s+/g, '-')}`);
  }

  /** Removes every service except AccessoryInformation and the given types. */
  keepOnly(accessory: PlatformAccessory, ...types: WithUUID<typeof Service>[]) {
    const { Service } = this.api.hap;
    const keep = new Set([Service.AccessoryInformation.UUID, ...types.map((t) => t.UUID)]);
    for (const svc of [...accessory.services]) {
      if (!keep.has(svc.UUID)) {
        accessory.removeService(svc);
      }
    }
  }

  /** Sets up the tiles; returns the Heater tile's switch. */
  setupServices(): Service {
    const { Service, Characteristic } = this.api.hap;

    // Tile 1: Heater (on/off). keepOnly() also clears any other service a cached accessory may carry.
    this.setInfo(this.accessory, 'Heater');
    this.keepOnly(this.accessory, Service.Switch);
    const heaterSwitch = this.accessory.getService(Service.Switch)
      || this.accessory.addService(Service.Switch, this.name);
    heaterSwitch.getCharacteristic(Characteristic.On)
      .onGet(() => this.state.on)
      .onSet((value: CharacteristicValue) => {
        this.desired.on = !!value;
        this.offRequested = !value;
        this.schedule();
      });

    // Tile 2: Level (fan slider).
    if (this.levelAccessory) {
      this.setInfo(this.levelAccessory, 'Level');
      this.keepOnly(this.levelAccessory, Service.Fanv2);
      const levelFan = this.levelAccessory.getService(Service.Fanv2)
        || this.levelAccessory.addService(Service.Fanv2, this.levelAccessory.displayName);
      this.levelFan = levelFan;

      levelFan.getCharacteristic(Characteristic.Active)
        .onGet(() => (this.state.on ? 1 : 0))
        .onSet((value: CharacteristicValue) => {
          if (value === 0) {
            this.desired.on = false; // same as Heater off
            this.offRequested = true;
          }
          // Active = 1 never turns the heater on; reconcile() snaps the tile back.
          this.schedule();
        });

      levelFan.getCharacteristic(Characteristic.RotationSpeed)
        .setProps({ minValue: 0, maxValue: this.maxLevel, minStep: 1 })
        .onGet(() => (this.state.on ? this.state.level : 0))
        .onSet((value: CharacteristicValue) => {
          const v = Math.round(Number(value));
          if (v <= 0) {
            this.desired.on = false; // same as Heater off
            this.offRequested = true;
          } else {
            this.desired.level = Math.min(v, this.maxLevel);
          }
          this.schedule();
        });
    }

    // Tile 3: Out of Sync (button that springs back).
    if (this.syncAccessory) {
      this.setInfo(this.syncAccessory, 'Out of Sync');
      this.keepOnly(this.syncAccessory, Service.Switch);
      const syncSwitch = this.syncAccessory.getService(Service.Switch)
        || this.syncAccessory.addService(Service.Switch, this.syncAccessory.displayName);
      this.syncSwitch = syncSwitch;
      syncSwitch.getCharacteristic(Characteristic.On)
        .onGet(() => false)
        .onSet((value: CharacteristicValue) => {
          if (value) {
            this.flipState();
            clearTimeout(this.syncResetTimer);
            this.syncResetTimer = setTimeout(() => syncSwitch.updateCharacteristic(Characteristic.On, false), 500);
          }
        });
    }
    return heaterSwitch;
  }

  /** Flips what HomeKit believes (on <-> off) without sending anything to the heater. */
  flipState() {
    clearTimeout(this.timer ?? undefined);
    this.requestedAt = null;
    this.queue = this.queue.then(() => {
      this.state.on = !this.state.on;
      this.desired = { ...this.state };
      this.saveState();
      this.pushState();
      if (this.state.on) {
        this.armAutoOff();
      } else {
        clearTimeout(this.autoOffTimer ?? undefined);
        this.autoOffTimer = null;
      }
      this.log.info('Out of Sync: Heater tile flipped to %s (nothing sent to the heater).', this.state.on ? 'On' : 'Off');
    });
  }

  pushState() {
    const { Characteristic } = this.api.hap;
    this.heaterSwitch.updateCharacteristic(Characteristic.On, this.state.on);
    if (this.levelFan) {
      this.levelFan.updateCharacteristic(Characteristic.Active, this.state.on ? 1 : 0);
      this.levelFan.updateCharacteristic(Characteristic.RotationSpeed, this.state.on ? this.state.level : 0);
    }
  }

  saveState() {
    this.accessory.context.state = { ...this.state };
    this.api.updatePlatformAccessories([this.accessory]);
  }

  // ---------- Startup / polling ----------

  async start() {
    await this.loadKeys();
    if (this.plugId) {
      await this.pollPlug();
      // pollPlug and loadKeys catch their own errors.
      this.plugInterval = setInterval(() => void this.pollPlug(), (this.cfg.plugPollSeconds || 60) * 1000);
    }
    if (this.state.on) {
      this.armAutoOff();
    }
  }

  stop() {
    clearInterval(this.plugInterval);
    clearTimeout(this.timer ?? undefined);
    clearTimeout(this.autoOffTimer ?? undefined);
    clearTimeout(this.retryTimer);
    clearTimeout(this.snapTimer);
    clearTimeout(this.syncResetTimer);
  }

  async loadKeys() {
    try {
      const remote = await this.cloud.getRemoteKeys(this.cfg.blasterId, this.cfg.remoteId);
      const list = remote.key_list || [];
      const find = (name: string) => list.find((k) => norm(k.key_name) === norm(name) || norm(k.key) === norm(name));
      const available = list.map((k) => k.key_name || k.key).join(', ');

      const power = find(this.powerKeyName);
      const levels = this.levelNames.map(find);
      const missing = [this.powerKeyName, ...this.levelNames].filter((n, i) => !(i === 0 ? power : levels[i - 1]));
      // (power is in missing when it wasn't found; the second test is for the type checker.)
      if (missing.length || !power) {
        this.log.error('Remote has no key named %s. Available keys: %s', missing.join(', '), available || '(none)');
        return;
      }
      this.remote = remote;
      this.keys = { power, levels: levels.filter((k) => k !== undefined) };
      this.log.info('Ready. Keys: power="%s", levels=%s.', power.key_name || power.key,
        this.keys.levels.map((k) => `"${k.key_name || k.key}"`).join(' / '));
    } catch (err) {
      this.log.error('Could not load remote keys (retrying in 60s): %s', (err as Error).message);
      this.retryTimer = setTimeout(() => void this.loadKeys(), 60_000);
    }
  }

  async pollPlug() {
    try {
      const status = await this.cloud.getStatus(this.plugId);
      const item = (status || []).find((s) => s.code === this.plugCode);
      if (!item) {
        this.log.warn('Plug %s has no "%s" status code.', this.plugId, this.plugCode);
        return;
      }
      // A plug that is off means the heater is off. (Plug on does not mean
      // heater on: the heater stays off after power returns.)
      if (item.value === false && this.state.on && !this.busy) {
        this.log.info('Plug is off, so the heater is off.');
        this.state.on = false;
        this.desired.on = false;
        clearTimeout(this.autoOffTimer ?? undefined);
        this.autoOffTimer = null;
        this.saveState();
        this.pushState();
      }
    } catch (err) {
      this.log.debug('Plug poll failed: %s', (err as Error).message);
    }
  }

  // ---------- Control ----------

  /** Coalesce rapid HomeKit writes (Active + RotationSpeed arrive together). */
  schedule() {
    this.requestedAt = this.requestedAt || Date.now();
    clearTimeout(this.timer ?? undefined);
    this.timer = setTimeout(() => {
      this.queue = this.queue.then(() => this.reconcile());
    }, this.debounceMs);
  }

  /** The remote and its keys; reconcile() checks they are loaded before anything is pressed. */
  loaded(): { remote: RemoteKeys; keys: Keys } {
    if (!this.remote || !this.keys) {
      throw new Error('remote keys not loaded yet (see earlier errors)');
    }
    return { remote: this.remote, keys: this.keys };
  }

  async press(key: RemoteKey, label: string) {
    const t0 = Date.now();
    await this.cloud.pressKey(this.cfg.blasterId, this.cfg.remoteId, this.loaded().remote, key);
    this.timings.push(`${label} ${Date.now() - t0}ms`);
  }

  async pressLevel(level: number) {
    const { keys } = this.loaded();
    for (let i = 0; i < this.levelRepeat; i++) {
      if (i === 0) {
        await this.press(keys.levels[level - 1], this.levelNames[level - 1]);
        continue;
      }
      await sleep(this.levelRepeatDelayMs);
      try {
        await this.press(keys.levels[level - 1], this.levelNames[level - 1]);
      } catch (err) {
        // The first press already went through; a failed extra copy is harmless.
        this.log.warn('Repeat of %s failed (first press was sent): %s', this.levelNames[level - 1], (err as Error).message);
      }
    }
  }

  async setPlug(on: boolean) {
    const t0 = Date.now();
    await this.cloud.sendCommands(this.plugId, [{ code: this.plugCode, value: on }]);
    this.timings.push(`plug ${on ? 'on' : 'off'} ${Date.now() - t0}ms`);
  }

  async reconcile() {
    const want = { ...this.desired };
    const offRequested = this.offRequested;
    this.offRequested = false;
    this.timings = [];
    const started = this.requestedAt || Date.now();
    this.requestedAt = null;
    const took = () => `(${this.timings.join(', ')}; total ${Date.now() - started}ms after HomeKit request)`;
    const have = this.state;
    this.busy = true;
    try {
      const { keys } = this.loaded();

      if (want.on && !have.on) {
        // Only the Heater tile can request this.
        if (this.plugId) {
          await this.setPlug(true);
          await sleep(this.powerUpDelayMs);
        }
        await this.press(keys.power, 'power');
        have.on = true; // the heater is now on, even if the level press below fails
        this.saveState();
        await sleep(this.keyDelayMs);
        await this.pressLevel(want.level);
        have.level = want.level;
        this.log.info('On at %s %s', this.levelNames[have.level - 1], took());
      } else if (!want.on && have.on) {
        if (this.plugId) {
          await this.setPlug(false);
        } else {
          await this.press(keys.power, 'power');
        }
        have.on = false;
        have.level = want.level; // remember a level picked in the same gesture
        this.log.info('Off %s', took());
      } else if (!want.on && !have.on) {
        if (this.plugId && offRequested) {
          await this.setPlug(false); // with a plug, off is always safe to repeat
        }
        if (want.level !== have.level) {
          // Level picked while the heater is off: remembered for the next "on".
          // Without a plug it is also sent (harmless when off; starts heating if
          // the heater was actually in standby).
          if (!this.plugId) {
            await this.pressLevel(want.level);
          }
          have.level = want.level;
          this.log.info('Level set to %s while off; it will be used next time the heater turns on %s',
            this.levelNames[have.level - 1], took());
        }
      } else if (want.level !== have.level) {
        await this.pressLevel(want.level);
        have.level = want.level;
        this.log.info('Set to %s %s', this.levelNames[have.level - 1], took());
      }
    } catch (err) {
      this.log.error('Command failed: %s', (err as Error).message);
    } finally {
      this.busy = false;
      // Anything that didn't happen is rolled back so HomeKit shows reality.
      if (this.desired.on === want.on && this.desired.level === want.level) {
        this.desired = { ...this.state };
      }
      this.saveState();
      this.pushState();
      // The Home app sometimes re-applies its own value right after a write
      // (e.g. Level tapped on while off); push again so the tiles settle.
      clearTimeout(this.snapTimer);
      this.snapTimer = setTimeout(() => this.pushState(), 600);
      if (this.state.on) {
        this.armAutoOff();
      } else {
        clearTimeout(this.autoOffTimer ?? undefined);
        this.autoOffTimer = null;
      }
    }
  }

  armAutoOff() {
    if (!this.autoOffMinutes || this.autoOffTimer) {
      return;
    }
    this.autoOffTimer = setTimeout(() => {
      this.autoOffTimer = null;
      this.log.info('Auto-off after %s minutes.', this.autoOffMinutes);
      this.desired.on = false;
      this.schedule();
    }, this.autoOffMinutes * 60_000);
  }
}
