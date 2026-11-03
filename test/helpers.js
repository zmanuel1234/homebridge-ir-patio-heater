'use strict';

// Minimal stand-ins for the Homebridge API and the Tuya cloud, enough to drive PatioHeater.

class FakeCharacteristic {
  constructor(name) {
    this.name = name;
    this.value = null;
    this.getHandler = null;
    this.setHandler = null;
    this.props = {};
  }

  onGet(fn) {
    this.getHandler = fn;
    return this;
  }

  onSet(fn) {
    this.setHandler = fn;
    return this;
  }

  setProps(props) {
    Object.assign(this.props, props);
    return this;
  }
}

class FakeService {
  constructor(type, name) {
    this.UUID = type.UUID;
    this.displayName = name;
    this.characteristics = new Map();
  }

  getCharacteristic(type) {
    if (!this.characteristics.has(type)) {
      this.characteristics.set(type, new FakeCharacteristic(type));
    }
    return this.characteristics.get(type);
  }

  setCharacteristic(type, value) {
    this.getCharacteristic(type).value = value;
    return this;
  }

  updateCharacteristic(type, value) {
    this.getCharacteristic(type).value = value;
    return this;
  }
}

const serviceType = (name) => ({ UUID: name });
const Service = {
  AccessoryInformation: serviceType('AccessoryInformation'),
  Switch: serviceType('Switch'),
  Fanv2: serviceType('Fanv2'),
};
const Characteristic = {
  On: 'On',
  Active: 'Active',
  RotationSpeed: 'RotationSpeed',
  Manufacturer: 'Manufacturer',
  Model: 'Model',
  SerialNumber: 'SerialNumber',
};

function fakeAccessory(name, context = {}) {
  const services = [new FakeService(Service.AccessoryInformation, name)];
  return {
    displayName: name,
    context,
    services,
    getService: (type) => services.find((s) => s.UUID === type.UUID),
    addService: (type, svcName) => {
      const svc = new FakeService(type, svcName);
      services.push(svc);
      return svc;
    },
    removeService: (svc) => services.splice(services.indexOf(svc), 1),
  };
}

function fakeCloud({ failOn = null } = {}) {
  const sent = [];
  return {
    sent,
    async getRemoteKeys() {
      return {
        category_id: 5,
        remote_index: 1,
        key_list: [
          { key: 'power', key_id: 1, key_name: 'power' },
          { key: 'l1', key_id: 2, key_name: '500W' },
          { key: 'l2', key_id: 3, key_name: '1000W' },
          { key: 'l3', key_id: 4, key_name: '1500W' },
        ],
      };
    },
    async pressKey(blasterId, remoteId, remote, key) {
      if (failOn === key.key_name) {
        throw new Error('simulated Tuya failure');
      }
      sent.push(key.key_name);
    },
    async sendCommands(deviceId, commands) {
      sent.push(`plug:${commands[0].value ? 'on' : 'off'}`);
    },
    async getStatus() {
      return [{ code: 'switch_1', value: true }];
    },
  };
}

function fakePlatform(cloud) {
  const logs = [];
  const record = (level) => (msg, ...args) => logs.push({ level, msg, args });
  return {
    logs,
    cloud,
    log: { info: record('info'), warn: record('warn'), error: record('error'), debug: record('debug') },
    api: {
      hap: { Service, Characteristic },
      updatePlatformAccessories: () => {},
    },
  };
}

// Short delays so tests run fast; the logic is the same as with the defaults.
const FAST = { keyDelayMs: 1, levelRepeatDelayMs: 1, debounceMs: 1, plugPowerUpDelayMs: 1 };

/** Waits for the debounce timer to fire and the command queue to drain. */
async function settle(heater) {
  await new Promise((resolve) => setTimeout(resolve, 20));
  await heater.queue;
}

module.exports = { Service, Characteristic, fakeAccessory, fakeCloud, fakePlatform, FAST, settle };
