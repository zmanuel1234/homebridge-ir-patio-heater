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

// ─── Remotes, devices, errors and the token ───────────────────────────────

const ok = (result) => ({ ok: true, json: async () => ({ success: true, result }) });

test('a DIY remote gets its learned codes, and pressing a learned key sends its code', async () => {
  global.fetch = async (url, opts) => {
    calls.push(`${opts.method} ${new URL(url).pathname}`);
    if (url.endsWith('/keys')) return ok({ category_id: 999, key_list: [{ key: 'power', key_id: 1, key_name: 'Power' }, { key: 'x', key_id: 2 }] });
    if (url.endsWith('/learning-codes') && opts.method === 'GET') return ok([{ id: 1, key: 'power', code: 'IRCODE' }]);
    return ok(true);
  };
  const cloud = cloudWithToken();
  const keys = await cloud.getRemoteKeys('b', 'r');
  assert.equal(keys.key_list[0].learning_code, 'IRCODE');
  assert.equal(keys.key_list[1].learning_code, undefined, 'a key without a learned code');
  await cloud.pressKey('b', 'r', keys, keys.key_list[0]);
  assert.deepEqual(calls, [
    'GET /v2.0/infrareds/b/remotes/r/keys',
    'GET /v2.0/infrareds/b/remotes/r/learning-codes',
    'POST /v2.0/infrareds/b/remotes/r/learning-codes',
  ]);
});

test('a regular remote: no learned codes fetched; a press sends the key by id', async () => {
  let body;
  global.fetch = async (url, opts) => {
    calls.push(`${opts.method} ${new URL(url).pathname}`);
    if (opts.method === 'POST') body = JSON.parse(opts.body);
    return ok(url.endsWith('/keys') ? { category_id: 5, remote_index: 3, key_list: [{ key: 'power', key_id: 1 }] } : true);
  };
  const cloud = cloudWithToken();
  const keys = await cloud.getRemoteKeys('b', 'r');
  await cloud.pressKey('b', 'r', keys, keys.key_list[0]);
  assert.deepEqual(calls, ['GET /v2.0/infrareds/b/remotes/r/keys', 'POST /v2.0/infrareds/b/remotes/r/raw/command']);
  assert.deepEqual(body, { category_id: 5, remote_index: 3, key: 'power', key_id: 1 });
});

test('the plug: status and commands go to the device endpoints', async () => {
  global.fetch = async (url, opts) => {
    calls.push({ method: opts.method, path: new URL(url).pathname, body: opts.body && JSON.parse(opts.body) });
    return ok(opts.method === 'GET' ? [{ code: 'switch_1', value: true }] : true);
  };
  const cloud = cloudWithToken();
  assert.deepEqual(await cloud.getStatus('plug'), [{ code: 'switch_1', value: true }]);
  await cloud.sendCommands('plug', [{ code: 'switch_1', value: false }]);
  assert.deepEqual(calls, [
    { method: 'GET', path: '/v1.0/devices/plug/status', body: undefined },
    { method: 'POST', path: '/v1.0/devices/plug/commands', body: { commands: [{ code: 'switch_1', value: false }] } },
  ]);
});

test('a Tuya error names the call and code, with a hint for known codes', async () => {
  global.fetch = async () => ({ ok: true, json: async () => ({ success: false, code: 1106, msg: 'permission deny' }) });
  await assert.rejects(cloudWithToken().getStatus('dev'), (e) =>
    e.code === 1106 && /Tuya API \/v1.0\/devices\/dev\/status failed: code=1106, msg=permission deny\. Permission denied\./.test(e.message));
  global.fetch = async () => ({ ok: true, json: async () => ({ success: false, code: 5, msg: 'odd' }) });
  await assert.rejects(cloudWithToken().getStatus('dev'), (e) => e.message.endsWith('code=5, msg=odd.'));
});

test('an HTTP error is reported with its status', async () => {
  global.fetch = async () => ({ ok: false, status: 503, statusText: 'Service Unavailable' });
  const cloud = cloudWithToken();
  cloud.raw = cloud.raw.bind(cloud);
  await assert.rejects(cloud.sendCommands('plug', []), /Network error calling Tuya .*HTTP 503 Service Unavailable/);
});

test('a token close to expiry is renewed in the background; the request does not wait for it', async () => {
  let release;
  global.fetch = async (url) => {
    if (url.includes('/v1.0/token')) {
      calls.push('token');
      await new Promise((r) => { release = r; });
      return ok({ access_token: 'fresh', expire_time: 7200 });
    }
    calls.push('status');
    return ok([]);
  };
  const cloud = cloudWithToken();
  cloud.tokenExpiry = Date.now() + 10 * 60_000; // 10 min left: inside the 15-min renewal window
  await cloud.getStatus('dev');
  assert.deepEqual(calls, ['token', 'status'], 'renewal started, request done without it');
  assert.equal(cloud.token, 'token');
  release();
  await cloud.tokenPromise;
  assert.equal(cloud.token, 'fresh');
});

test('a failed token request is an error with the code', async () => {
  global.fetch = async () => ({ ok: true, json: async () => ({ success: false, code: 1004, msg: 'sign invalid' }) });
  const cloud = new TuyaCloud({ accessId: 'id', accessKey: 'key', log });
  await assert.rejects(cloud.getStatus('dev'), /\/v1.0\/token failed: code=1004.*Check accessId/);
});
