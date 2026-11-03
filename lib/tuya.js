'use strict';

const crypto = require('crypto');

// Response codes that mean "your token is no longer valid, get a new one".
const TOKEN_ERRORS = new Set([1010, 1011, 1012]);

const HINTS = {
  1004: 'Check accessId / accessKey and the endpoint (data center).',
  1106: 'Permission denied. Make sure the devices are linked to the cloud project (Tuya IoT Platform -> Cloud -> Project -> Devices -> Link App Account).',
  1114: 'Check accessId / accessKey and the endpoint (data center).',
  28841002: 'API subscription expired. Renew it in the Tuya IoT Platform.',
  28841101: 'API not subscribed. In the Tuya IoT Platform, authorize "IoT Core" and "IR Control Hub Open Service" for the project.',
  28841105: 'API not subscribed. In the Tuya IoT Platform, authorize "IoT Core" and "IR Control Hub Open Service" for the project.',
};

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class TuyaError extends Error {
  constructor(path, code, msg) {
    const hint = HINTS[code] ? ` ${HINTS[code]}` : '';
    super(`Tuya API ${path} failed: code=${code}, msg=${msg}.${hint}`);
    this.code = code;
  }
}

/**
 * Minimal Tuya OpenAPI client using the project-level token (simple mode,
 * grant_type=1). It does not log in with the app account, so it never
 * invalidates the session of a Tuya plugin using the same cloud project.
 */
class TuyaCloud {
  constructor({ endpoint, accessId, accessKey, log }) {
    this.endpoint = (endpoint || 'https://openapi.tuyaus.com').replace(/\/+$/, '');
    this.accessId = accessId;
    this.accessKey = accessKey;
    this.log = log;
    this.token = '';
    this.tokenExpiry = 0;
    this.tokenPromise = null;
  }

  static signUrl(path, query) {
    if (!query || Object.keys(query).length === 0) {
      return path;
    }
    const kv = Object.keys(query).sort()
      .filter((k) => query[k] !== undefined && query[k] !== null)
      .map((k) => `${k}=${query[k]}`);
    return `${path}?${kv.join('&')}`;
  }

  sign(method, path, query, bodyStr, t, nonce, token) {
    const stringToSign = [
      method.toUpperCase(),
      sha256(bodyStr),
      `client_id:${this.accessId}\n`,
      TuyaCloud.signUrl(path, query),
    ].join('\n');
    const message = [this.accessId, token, t, nonce, stringToSign].join('');
    return crypto.createHmac('sha256', this.accessKey).update(message).digest('hex').toUpperCase();
  }

  async ensureToken() {
    if (this.token && Date.now() < this.tokenExpiry - 60_000) {
      // Renew in the background well before expiry, so a button press never
      // has to wait for a login round trip.
      if (Date.now() > this.tokenExpiry - 15 * 60_000 && !this.tokenPromise) {
        this.fetchToken().catch((err) => this.log.debug('Background token refresh failed: %s', err.message));
      }
      return;
    }
    await this.fetchToken();
  }

  async fetchToken() {
    if (!this.tokenPromise) {
      this.tokenPromise = (async () => {
        const res = await this.raw('GET', '/v1.0/token', { grant_type: 1 }, undefined, true);
        if (!res.success) {
          throw new TuyaError('/v1.0/token', res.code, res.msg);
        }
        this.token = res.result.access_token;
        this.tokenExpiry = Date.now() + res.result.expire_time * 1000;
        this.log.debug('Got Tuya access token, valid for %ss.', res.result.expire_time);
      })().finally(() => {
        this.tokenPromise = null;
      });
    }
    return this.tokenPromise;
  }

  async raw(method, path, query, body, isTokenRequest = false) {
    const bodyStr = body === undefined ? '' : JSON.stringify(body);
    const t = String(Date.now());
    const nonce = crypto.randomUUID();
    const token = isTokenRequest ? '' : this.token;
    const headers = {
      't': t,
      'client_id': this.accessId,
      'nonce': nonce,
      'Signature-Headers': 'client_id',
      'sign': this.sign(method, path, query, bodyStr, t, nonce, token),
      'sign_method': 'HMAC-SHA256',
      'lang': 'en',
      'Content-Type': 'application/json',
    };
    if (!isTokenRequest) {
      headers['access_token'] = token;
    }
    const qs = query && Object.keys(query).length ? '?' + new URLSearchParams(query).toString() : '';

    // Only reads are retried. A POST that timed out may already have reached the
    // blaster, and pressing Power (a toggle) twice would invert the heater.
    const attempts = method === 'GET' ? 3 : 1;
    let lastErr;
    for (let attempt = 1; attempt <= attempts; attempt++) {
      try {
        const resp = await fetch(this.endpoint + path + qs, {
          method,
          headers,
          body: bodyStr || undefined,
          signal: AbortSignal.timeout(15_000),
        });
        if (!resp.ok) {
          throw new Error(`HTTP ${resp.status} ${resp.statusText}`);
        }
        return await resp.json();
      } catch (err) {
        lastErr = err;
        if (attempt < attempts) {
          await sleep(500 * attempt);
        }
      }
    }
    throw new Error(`Network error calling Tuya ${path}: ${lastErr.message}`);
  }

  async request(method, path, { query, body } = {}) {
    await this.ensureToken();
    let res = await this.raw(method, path, query, body);
    if (!res.success && TOKEN_ERRORS.has(res.code)) {
      this.token = '';
      await this.ensureToken();
      res = await this.raw(method, path, query, body);
    }
    if (!res.success) {
      throw new TuyaError(path, res.code, res.msg);
    }
    return res.result;
  }

  /** Remote keys, with DIY learned codes attached when the remote is a DIY remote. */
  async getRemoteKeys(blasterId, remoteId) {
    const keys = await this.request('GET', `/v2.0/infrareds/${blasterId}/remotes/${remoteId}/keys`);
    if (keys.category_id === 999) {
      const codes = await this.request('GET', `/v2.0/infrareds/${blasterId}/remotes/${remoteId}/learning-codes`);
      for (const key of keys.key_list || []) {
        const item = (codes || []).find((c) => c.id === key.key_id && c.key === key.key);
        if (item) {
          key.learning_code = item.code;
        }
      }
    }
    return keys;
  }

  async pressKey(blasterId, remoteId, remote, key) {
    if (key.learning_code) {
      return this.request('POST', `/v2.0/infrareds/${blasterId}/remotes/${remoteId}/learning-codes`,
        { body: { code: key.learning_code } });
    }
    return this.request('POST', `/v2.0/infrareds/${blasterId}/remotes/${remoteId}/raw/command`, {
      body: {
        category_id: remote.category_id,
        remote_index: remote.remote_index,
        key: key.key,
        key_id: key.key_id,
      },
    });
  }

  async getStatus(deviceId) {
    return this.request('GET', `/v1.0/devices/${deviceId}/status`);
  }

  async sendCommands(deviceId, commands) {
    return this.request('POST', `/v1.0/devices/${deviceId}/commands`, { body: { commands } });
  }
}

module.exports = { TuyaCloud, TuyaError, sleep };
