import { test } from 'node:test';
import assert from 'node:assert/strict';

import { PatioHeater, type HeaterConfig, type HeaterState } from '../src/heater.js';
import type { StatusItem } from '../src/tuya.js';
import { Service, Characteristic, asAccessory, fakeAccessory, fakeCloud, fakePlatform, FAST, settle, type FakeAccessory, type FakeCloud } from './helpers.js';

/** A service the heater must have added. */
function service(accessory: FakeAccessory, type: { UUID: string }) {
  const svc = accessory.getService(type);
  assert.ok(svc, `${accessory.displayName} has no ${type.UUID} service`);
  return svc;
}

async function makeHeater({ cfg = {}, cloud = fakeCloud(), state }: { cfg?: Partial<HeaterConfig>; cloud?: FakeCloud; state?: HeaterState } = {}) {
  const platform = fakePlatform(cloud);
  const main = fakeAccessory('Left Heater', state ? { state } : {});
  const level = fakeAccessory('Left Heater Level');
  const sync = fakeAccessory('Left Heater Out of Sync');
  const heater = new PatioHeater(platform, asAccessory(main), {
    name: 'Left Heater', blasterId: 'blaster', remoteId: 'remote', ...FAST, ...cfg,
  }, { level: asAccessory(level), sync: asAccessory(sync) });
  await heater.start();
  const on = service(main, Service.Switch).getCharacteristic(Characteristic.On);
  const fan = service(level, Service.Fanv2);
  const syncOn = service(sync, Service.Switch).getCharacteristic(Characteristic.On);
  return {
    heater, cloud, platform, on, syncOn,
    active: fan.getCharacteristic(Characteristic.Active),
    speed: fan.getCharacteristic(Characteristic.RotationSpeed),
  };
}

test('turning on sends Power, then the last level twice', async () => {
  const { heater, cloud, on } = await makeHeater();
  on.setHandler(true);
  await settle(heater);
  assert.deepEqual(cloud.sent, ['power', '1500W', '1500W']);
  assert.equal(heater.state.on, true);
  assert.equal(on.value, true);
});

test('on + level from the Home app in one gesture is one sequence', async () => {
  const { heater, cloud, on, speed } = await makeHeater();
  on.setHandler(true);
  speed.setHandler(1);
  await settle(heater);
  assert.deepEqual(cloud.sent, ['power', '500W', '500W']);
  assert.equal(heater.state.level, 1);
});

test('changing the level while on sends only the level', async () => {
  const { heater, cloud, speed } = await makeHeater({ state: { on: true, level: 3 } });
  speed.setHandler(2);
  await settle(heater);
  assert.deepEqual(cloud.sent, ['1000W', '1000W']);
  assert.equal(heater.state.level, 2);
});

test('turning off without a plug sends Power once', async () => {
  const { heater, cloud, on } = await makeHeater({ state: { on: true, level: 3 } });
  on.setHandler(false);
  await settle(heater);
  assert.deepEqual(cloud.sent, ['power']);
  assert.equal(heater.state.on, false);
});

test('Level slider to zero is the same as off', async () => {
  const { heater, cloud, speed } = await makeHeater({ state: { on: true, level: 2 } });
  speed.setHandler(0);
  await settle(heater);
  assert.deepEqual(cloud.sent, ['power']);
  assert.equal(heater.state.on, false);
});

test('the Level tile never turns the heater on', async () => {
  const { heater, cloud, active } = await makeHeater();
  active.setHandler(1);
  await settle(heater);
  assert.deepEqual(cloud.sent, []);
  assert.equal(heater.state.on, false);
  assert.equal(active.value, 0);
});

test('a level picked while off is remembered for the next on', async () => {
  const { heater, cloud, speed, on } = await makeHeater();
  speed.setHandler(1);
  await settle(heater);
  assert.equal(heater.state.on, false);
  cloud.sent.length = 0;
  on.setHandler(true);
  await settle(heater);
  assert.deepEqual(cloud.sent, ['power', '500W', '500W']);
});

test('a failed Power press leaves HomeKit showing off', async () => {
  const { heater, on } = await makeHeater({ cloud: fakeCloud({ failOn: 'power' }) });
  on.setHandler(true);
  await settle(heater);
  assert.equal(heater.state.on, false);
  assert.equal(on.value, false);
});

test('a failed level press after Power still shows on (Power did happen)', async () => {
  const { heater, on } = await makeHeater({ cloud: fakeCloud({ failOn: '1500W' }) });
  on.setHandler(true);
  await settle(heater);
  assert.equal(heater.state.on, true);
  assert.equal(on.value, true);
});

test('Out of Sync flips what HomeKit shows and sends nothing', async () => {
  const { heater, cloud, syncOn, on } = await makeHeater({ state: { on: true, level: 3 } });
  syncOn.setHandler(true);
  await settle(heater);
  assert.deepEqual(cloud.sent, []);
  assert.equal(heater.state.on, false);
  assert.equal(on.value, false);
  heater.stop();
});

test('with a plug, off cuts the plug instead of pressing Power', async () => {
  const { heater, cloud, on } = await makeHeater({ cfg: { plugId: 'plug' }, state: { on: true, level: 3 } });
  on.setHandler(false);
  await settle(heater);
  assert.deepEqual(cloud.sent, ['plug:off']);
  assert.equal(heater.state.on, false);
  heater.stop();
});

test('with a plug, on powers the plug first', async () => {
  const { heater, cloud, on } = await makeHeater({ cfg: { plugId: 'plug' } });
  on.setHandler(true);
  await settle(heater);
  assert.deepEqual(cloud.sent, ['plug:on', 'power', '1500W', '1500W']);
  heater.stop();
});

test('autoOffMinutes without a plug is ignored with a warning', async () => {
  const { heater, platform } = await makeHeater({ cfg: { autoOffMinutes: 30 } });
  assert.equal(heater.autoOffMinutes, 0);
  assert.ok(platform.logs.some((l) => l.level === 'warn' && /autoOffMinutes/.test(l.msg)));
});

// ─── The plug, auto-off and the remote's keys ─────────────────────────────

const plugCloud = (status: () => StatusItem[]) => Object.assign(fakeCloud(), { getStatus: async () => status() });

test('the plug reported off while the heater is on: HomeKit shows it off', async (t) => {
  let plugOn = true;
  const { heater, platform, on } = await makeHeater({ cfg: { plugId: 'plug' }, cloud: plugCloud(() => [{ code: 'switch_1', value: plugOn }]), state: { on: true, level: 2 } });
  t.after(() => heater.stop());
  plugOn = false;
  await heater.pollPlug();
  assert.equal(heater.state.on, false);
  assert.equal(on.value, false);
  assert.ok(platform.logs.some((l) => l.level === 'info' && /Plug is off/.test(l.msg)));
});

test('the plug turned back on does not turn the heater on (it stays off after power returns)', async (t) => {
  const { heater } = await makeHeater({ cfg: { plugId: 'plug' }, cloud: plugCloud(() => [{ code: 'switch_1', value: true }]) });
  t.after(() => heater.stop());
  await heater.pollPlug();
  assert.equal(heater.state.on, false, 'still off');
});

test('a plug without the configured status code is reported once per poll', async (t) => {
  const { heater, platform } = await makeHeater({ cfg: { plugId: 'plug', plugCode: 'switch_2' }, cloud: plugCloud(() => [{ code: 'switch_1', value: true }]) });
  t.after(() => heater.stop());
  assert.ok(platform.logs.some((l) => l.level === 'warn' && /no "%s" status code/.test(l.msg) && l.args.includes('switch_2')));
});

test('a failed plug poll changes nothing (debug log only)', async (t) => {
  const cloud = Object.assign(fakeCloud(), { getStatus: async () => { throw new Error('offline'); } });
  const { heater, platform } = await makeHeater({ cfg: { plugId: 'plug' }, cloud, state: { on: true, level: 1 } });
  t.after(() => heater.stop());
  assert.equal(heater.state.on, true);
  assert.ok(platform.logs.some((l) => l.level === 'debug' && /Plug poll failed/.test(l.msg)));
  assert.ok(!platform.logs.some((l) => l.level === 'error' || l.level === 'warn'));
});

test('auto-off: with a plug, the heater turns off by itself after autoOffMinutes', async (t) => {
  const { heater, cloud, on, platform } = await makeHeater({ cfg: { plugId: 'plug', autoOffMinutes: 0.001 } }); // 60 ms
  t.after(() => heater.stop());
  on.setHandler(true);
  await settle(heater);
  assert.equal(heater.state.on, true);
  await new Promise((r) => setTimeout(r, 120));
  await settle(heater);
  assert.equal(heater.state.on, false);
  assert.equal(cloud.sent.at(-1), 'plug:off');
  assert.ok(platform.logs.some((l) => /Auto-off after/.test(l.msg)));
});

test('a remote without the configured keys: an error naming them, and presses are refused', async (t) => {
  const cloud = Object.assign(fakeCloud(), {
    getRemoteKeys: async () => ({ category_id: 5, remote_index: 1, key_list: [{ key: 'power', key_id: 1, key_name: 'power' }] }),
  });
  const { heater, platform, on } = await makeHeater({ cloud });
  t.after(() => heater.stop());
  const missing = platform.logs.find((l) => l.level === 'error' && /Remote has no key named/.test(l.msg));
  assert.ok(missing);
  assert.match(String(missing.args[0]), /500W, 1000W, 1500W/);
  on.setHandler(true);
  await settle(heater);
  assert.deepEqual(cloud.sent, [], 'nothing pressed');
  assert.equal(heater.state.on, false, 'still shown off');
  assert.ok(platform.logs.some((l) => l.level === 'error' && /remote keys not loaded yet/.test(String(l.args.join(' ')) + l.msg)));
});

test('keys that fail to load are retried later', async (t) => {
  let fail = true;
  const real = fakeCloud();
  const cloud = Object.assign(real, { getRemoteKeys: async () => { if (fail) throw new Error('Tuya down'); return fakeCloud().getRemoteKeys('blaster', 'remote'); } });
  const { heater, platform } = await makeHeater({ cloud });
  t.after(() => heater.stop());
  assert.ok(platform.logs.some((l) => l.level === 'error' && /retrying in 60s/.test(l.msg)));
  assert.ok(heater.retryTimer, 'a retry is scheduled');
  fail = false;
  await heater.loadKeys(); // the retry
  assert.ok(heater.keys, 'loaded on the retry');
});

test('a failed repeat of the level press is only a warning: the first press went through', async (t) => {
  const cloud = fakeCloud();
  const realPress = cloud.pressKey;
  let presses = 0;
  cloud.pressKey = async (...args: Parameters<FakeCloud['pressKey']>) => {
    if (args[3].key_name === '1500W' && ++presses === 2) throw new Error('timeout');
    return realPress(...args);
  };
  const { heater, platform, on } = await makeHeater({ cloud });
  t.after(() => heater.stop());
  on.setHandler(true);
  await settle(heater);
  assert.equal(heater.state.on, true);
  assert.ok(platform.logs.some((l) => l.level === 'warn' && /Repeat of %s failed/.test(l.msg)));
});

test('the Level tile turned off (Active 0) turns the heater off', async (t) => {
  const { heater, cloud, on, active } = await makeHeater({ state: { on: true, level: 2 } });
  t.after(() => heater.stop());
  active.setHandler(0);
  await settle(heater);
  assert.equal(heater.state.on, false);
  assert.equal(on.value, false);
  assert.deepEqual(cloud.sent, ['power']);
});
