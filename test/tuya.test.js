'use strict';

const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');

const { TuyaCloud } = require('../lib/tuya');

const log = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };
const realFetch = global.fetch;
let calls;

beforeEach(() => {
  calls = [];
});

afterEach(() => {
  global.fetch = realFetch;
});

function cloudWithToken() {
  const cloud = new TuyaCloud({ accessId: 'id', accessKey: 'key', log });
  cloud.token = 'token';
  cloud.tokenExpiry = Date.now() + 3600_000;
  return cloud;
}

test('GET requests are retried after a network error', async () => {
  global.fetch = async (url, opts) => {
    calls.push(opts.method);
    if (calls.length < 3) {
      throw new Error('socket hang up');
    }
    return { ok: true, json: async () => ({ success: true, result: [] }) };
  };
  const result = await cloudWithToken().getStatus('dev');
  assert.deepEqual(result, []);
  assert.deepEqual(calls, ['GET', 'GET', 'GET']);
});

test('each retry is signed again with a new nonce', async () => {
  const seen = [];
  global.fetch = async (url, opts) => {
    seen.push({ nonce: opts.headers.nonce, sign: opts.headers.sign });
    if (seen.length < 3) {
      throw new Error('socket hang up');
    }
    return { ok: true, json: async () => ({ success: true, result: [] }) };
  };
  await cloudWithToken().getStatus('dev');
  assert.equal(seen.length, 3);
  assert.equal(new Set(seen.map((s) => s.nonce)).size, 3);
  assert.equal(new Set(seen.map((s) => s.sign)).size, 3);
});

test('POST requests are never retried, so Power is not pressed twice', async () => {
  global.fetch = async (url, opts) => {
    calls.push(opts.method);
    throw new Error('timeout');
  };
  const remote = { category_id: 5, remote_index: 1 };
  await assert.rejects(
    cloudWithToken().pressKey('blaster', 'remote', remote, { key: 'power', key_id: 1 }),
    /Network error/,
  );
  assert.deepEqual(calls, ['POST']);
});

test('an expired token is renewed once and the request repeated', async () => {
  global.fetch = async (url, opts) => {
    calls.push(url.includes('/v1.0/token') ? 'token' : opts.method);
    if (url.includes('/v1.0/token')) {
      return { ok: true, json: async () => ({ success: true, result: { access_token: 'new', expire_time: 7200 } }) };
    }
    const first = calls.filter((c) => c === 'GET').length === 1;
    return { ok: true, json: async () => (first ? { success: false, code: 1010, msg: 'token invalid' } : { success: true, result: 'ok' }) };
  };
  const result = await cloudWithToken().getStatus('dev');
  assert.equal(result, 'ok');
  assert.deepEqual(calls, ['GET', 'token', 'GET']);
});

test('signs requests with HMAC-SHA256 over the documented string', () => {
  const cloud = new TuyaCloud({ accessId: 'id', accessKey: 'key', log });
  const sign = cloud.sign('GET', '/v1.0/devices/x/status', { b: 2, a: 1 }, '', '1700000000000', 'nonce', 'token');
  assert.match(sign, /^[0-9A-F]{64}$/);
  assert.equal(TuyaCloud.signUrl('/p', { b: 2, a: 1 }), '/p?a=1&b=2');
});
