// The platform on Homebridge's own HAP library: which accessories it registers, keeps and removes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import type { API, Logging, PlatformAccessory, PlatformConfig } from 'homebridge';
import type * as HapNodejs from '@homebridge/hap-nodejs';

import { PatioHeaterPlatform } from '../src/platform.js';
import { PLATFORM_NAME, PLUGIN_NAME } from '../src/settings.js';

type Hap = typeof HapNodejs;
const require = createRequire(import.meta.url);
let hap: Hap | null = null;
let loadError = '';
try {
  hap = require('@homebridge/hap-nodejs') as Hap;
} catch (err) {
  loadError = (err as Error).message.split('\n')[0];
}

if (!hap) {
  test('platform tests', { skip: `HAP library doesn't load on Node ${process.version}: ${loadError}` }, () => {});
} else {
  defineTests(hap);
}

function defineTests(hap: Hap): void {
  const realFetch = globalThis.fetch;
  test.before(() => {
    // A Tuya cloud that knows one remote with the default keys.
    const ok = (result: unknown) => ({ ok: true, json: async () => ({ success: true, result }) });
    globalThis.fetch = (async (url: string) => {
      const path = new URL(url).pathname;
      if (path === '/v1.0/token') return ok({ access_token: 'T', expire_time: 7200 });
      if (path.endsWith('/keys')) {
        return ok({ category_id: 5, remote_index: 1, key_list: ['power', '500W', '1000W', '1500W'].map((name, i) => ({ key: name, key_id: i, key_name: name })) });
      }
      return ok(true);
    }) as unknown as typeof fetch;
  });
  test.after(() => {
    globalThis.fetch = realFetch;
  });
  /** Lets the heaters finish starting (loading their remote's keys) before the test ends. */
  const started = () => new Promise((resolve) => setTimeout(resolve, 20));

  function homebridge(config: Record<string, unknown>) {
    const api = new EventEmitter() as EventEmitter & Record<string, unknown>;
    const calls = { registered: [] as PlatformAccessory[], unregistered: [] as PlatformAccessory[] };
    const errors: string[] = [];
    api.hap = hap;
    api.platformAccessory = function (name: string, uuid: string): PlatformAccessory {
      return Object.assign(new hap!.Accessory(name, uuid), { context: {} }) as unknown as PlatformAccessory;
    };
    api.registerPlatformAccessories = (plugin: string, platform: string, list: PlatformAccessory[]) => {
      assert.equal(plugin, PLUGIN_NAME);
      assert.equal(platform, PLATFORM_NAME);
      calls.registered.push(...list);
    };
    api.updatePlatformAccessories = () => {};
    api.unregisterPlatformAccessories = (_p: string, _n: string, list: PlatformAccessory[]) => calls.unregistered.push(...list);
    const log = {
      info: () => {}, warn: () => {}, debug: () => {},
      error: (msg: string) => errors.push(msg),
    } as unknown as Logging;
    const start = (cached: PlatformAccessory[] = []) => {
      const platform = new PatioHeaterPlatform(log, { platform: PLATFORM_NAME, ...config } as PlatformConfig, api as unknown as API);
      cached.forEach((a) => platform.configureAccessory(a));
      api.emit('didFinishLaunching');
      return platform;
    };
    return { api, calls, errors, start };
  }

  const settings = {
    accessId: 'id',
    accessKey: 'key',
    heaters: [
      { name: 'Left', blasterId: 'B', remoteId: 'R1' },
      { name: 'Right', blasterId: 'B', remoteId: 'R2', levelName: 'Right Power', showSyncButton: false },
    ],
  };

  test('each heater gets its tiles: Heater, Level and (unless turned off) Out of Sync', async (t) => {
    const { api, calls, start } = homebridge(settings);
    const platform = start();
    t.after(() => api.emit('shutdown'));
    await started();
    assert.ok(platform.heaters.every((h) => h.keys), 'the remote keys were loaded');
    assert.deepEqual(calls.registered.map((a) => a.displayName), ['Left', 'Left Level', 'Left Out of Sync', 'Right', 'Right Power']);
    // The ids the accessories have always had, so HomeKit keeps them (and their rooms and automations).
    assert.equal(calls.registered[0].UUID, hap.uuid.generate('patio-heater:R1'));
    assert.equal(calls.registered[1].UUID, hap.uuid.generate('patio-heater:R1:level'));
    assert.equal(calls.registered[2].UUID, hap.uuid.generate('patio-heater:R1:sync'));
    const level = calls.registered[1] as unknown as HapNodejs.Accessory;
    const speed = level.getService(hap.Service.Fanv2)?.getCharacteristic(hap.Characteristic.RotationSpeed);
    assert.deepEqual([speed?.props.minValue, speed?.props.maxValue, speed?.props.minStep], [0, 3, 1]);
    assert.equal(platform.heaters.length, 2);
  });

  test('a restart keeps the cached tiles and removes those no longer in the settings', async (t) => {
    const first = homebridge(settings);
    first.start();
    await started();
    first.api.emit('shutdown');
    const gone = new hap.Accessory('Old', hap.uuid.generate('patio-heater:R9')) as unknown as PlatformAccessory;
    Object.assign(gone, { context: {} });

    const { api, calls, start } = homebridge(settings);
    start([...first.calls.registered, gone]);
    t.after(() => api.emit('shutdown'));
    await started();
    assert.deepEqual(calls.registered, []);
    assert.deepEqual(calls.unregistered.map((a) => a.displayName), ['Old']);
  });

  test('without the Tuya project keys, nothing is set up and the log says why', () => {
    const { calls, errors, start } = homebridge({ heaters: settings.heaters });
    const platform = start();
    assert.deepEqual(calls.registered, []);
    assert.equal(platform.heaters.length, 0);
    assert.match(errors[0], /accessId and accessKey are required/);
  });

  test('a heater without its ids is skipped, with an error; the others are set up', async (t) => {
    const { api, calls, errors, start } = homebridge({ ...settings, heaters: [{ name: 'No ids' }, settings.heaters[0]] });
    start();
    t.after(() => api.emit('shutdown'));
    await started();
    assert.deepEqual(calls.registered.map((a) => a.displayName), ['Left', 'Left Level', 'Left Out of Sync']);
    assert.match(errors[0], /Each heater needs name, blasterId and remoteId/);
  });
}
