'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { PatioHeater } = require('../lib/heater');
const { Service, Characteristic, fakeAccessory, fakeCloud, fakePlatform, FAST, settle } = require('./helpers');

async function makeHeater({ cfg = {}, cloud = fakeCloud(), state } = {}) {
  const platform = fakePlatform(cloud);
  const main = fakeAccessory('Left Heater', state ? { state } : {});
  const level = fakeAccessory('Left Heater Level');
  const sync = fakeAccessory('Left Heater Out of Sync');
  const heater = new PatioHeater(platform, main, {
    name: 'Left Heater', blasterId: 'blaster', remoteId: 'remote', ...FAST, ...cfg,
  }, { level, sync });
  await heater.start();
  const on = main.getService(Service.Switch).getCharacteristic(Characteristic.On);
  const fan = level.getService(Service.Fanv2);
  const syncOn = sync.getService(Service.Switch).getCharacteristic(Characteristic.On);
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
