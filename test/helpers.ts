// Minimal stand-ins for the Homebridge API and the Tuya cloud, enough to drive PatioHeater.
import type { API, CharacteristicValue, PlatformAccessory } from 'homebridge';

import type { HeaterCloud, HeaterContext, HeaterHost, PatioHeater } from '../src/heater.js';
import type { Log, RemoteKey, RemoteKeys } from '../src/tuya.js';

type Handler = (value: CharacteristicValue) => unknown;

export class FakeCharacteristic {
  readonly name: string;
  value: CharacteristicValue | null = null;
  getHandler: (() => CharacteristicValue) | null = null;
  setHandler: Handler = () => {
    throw new Error('no onSet handler');
  };
  props: Record<string, unknown> = {};

  constructor(name: string) {
    this.name = name;
  }

  onGet(fn: () => CharacteristicValue) {
    this.getHandler = fn;
    return this;
  }

  onSet(fn: Handler) {
    this.setHandler = fn;
    return this;
  }

  setProps(props: Record<string, unknown>) {
    Object.assign(this.props, props);
    return this;
  }
}

interface ServiceType {
  UUID: string;
}

export class FakeService {
  readonly UUID: string;
  readonly displayName: string;
  readonly characteristics = new Map<string, FakeCharacteristic>();

  constructor(type: ServiceType, name: string) {
    this.UUID = type.UUID;
    this.displayName = name;
  }

  getCharacteristic(type: string) {
    let characteristic = this.characteristics.get(type);
    if (!characteristic) {
      characteristic = new FakeCharacteristic(type);
      this.characteristics.set(type, characteristic);
    }
    return characteristic;
  }

  setCharacteristic(type: string, value: CharacteristicValue) {
    this.getCharacteristic(type).value = value;
    return this;
  }

  updateCharacteristic(type: string, value: CharacteristicValue) {
    this.getCharacteristic(type).value = value;
    return this;
  }
}

const serviceType = (name: string): ServiceType => ({ UUID: name });
export const Service = {
  AccessoryInformation: serviceType('AccessoryInformation'),
  Switch: serviceType('Switch'),
  Fanv2: serviceType('Fanv2'),
};
export const Characteristic = {
  On: 'On',
  Active: 'Active',
  RotationSpeed: 'RotationSpeed',
  Manufacturer: 'Manufacturer',
  Model: 'Model',
  SerialNumber: 'SerialNumber',
};

export interface FakeAccessory {
  displayName: string;
  context: HeaterContext;
  services: FakeService[];
  getService(type: ServiceType): FakeService | undefined;
  addService(type: ServiceType, name: string): FakeService;
  removeService(svc: FakeService): void;
}

export function fakeAccessory(name: string, context: HeaterContext = {}): FakeAccessory {
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
    removeService: (svc) => {
      services.splice(services.indexOf(svc), 1);
    },
  };
}

/** The fake accessory, as the heater takes it. */
export const asAccessory = (a: FakeAccessory) => a as unknown as PlatformAccessory<HeaterContext>;

export type FakeCloud = HeaterCloud & { sent: string[] };

export function fakeCloud({ failOn = null }: { failOn?: string | null } = {}): FakeCloud {
  const sent: string[] = [];
  return {
    sent,
    async getRemoteKeys(): Promise<RemoteKeys> {
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
    async pressKey(blasterId: string, remoteId: string, remote: RemoteKeys, key: RemoteKey) {
      if (failOn === key.key_name) {
        throw new Error('simulated Tuya failure');
      }
      sent.push(String(key.key_name));
    },
    async sendCommands(deviceId: string, commands: { code: string; value: unknown }[]) {
      sent.push(`plug:${commands[0].value ? 'on' : 'off'}`);
    },
    async getStatus() {
      return [{ code: 'switch_1', value: true }];
    },
  };
}

export interface LogEntry {
  level: string;
  msg: string;
  args: unknown[];
}

export function fakePlatform(cloud: HeaterCloud): HeaterHost & { logs: LogEntry[] } {
  const logs: LogEntry[] = [];
  const record = (level: string) => (msg: string, ...args: unknown[]) => {
    logs.push({ level, msg, args });
  };
  const log: Log = { info: record('info'), warn: record('warn'), error: record('error'), debug: record('debug') };
  return {
    logs,
    cloud,
    log,
    api: {
      hap: { Service, Characteristic },
      updatePlatformAccessories: () => {},
    } as unknown as API,
  };
}

// Short delays so tests run fast; the logic is the same as with the defaults.
export const FAST = { keyDelayMs: 1, levelRepeatDelayMs: 1, debounceMs: 1, plugPowerUpDelayMs: 1 };

/** Waits for the debounce timer to fire and the command queue to drain. */
export async function settle(heater: PatioHeater) {
  await new Promise((resolve) => setTimeout(resolve, 20));
  await heater.queue;
}
