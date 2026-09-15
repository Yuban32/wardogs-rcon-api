/**
 * Connection settings are the one thing the panel persists, and the one thing
 * it deliberately does not.
 */

import { WardogsError, type FetchInit, type FetchLike, type FetchResponse } from '@wardogs/api';
import { describe, expect, it } from 'vitest';

import {
  DEFAULT_SETTINGS,
  PROXY_PLACEHOLDER_TOKEN,
  createConnectedClient,
  isLoopback,
  isPlaintextRemote,
  loadSettings,
  normalizeSettings,
  originOf,
  saveSettings,
  type StorageLike,
} from './connection';

function fakeStorage(initial: Record<string, string> = {}): StorageLike & {
  data: Record<string, string>;
} {
  const data = { ...initial };
  return {
    data,
    getItem: (key) => data[key] ?? null,
    setItem: (key, value) => {
      data[key] = value;
    },
  };
}

describe('normalizeSettings', () => {
  it('falls back to the defaults for anything unusable', () => {
    expect(normalizeSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(normalizeSettings('nonsense')).toEqual(DEFAULT_SETTINGS);
    expect(normalizeSettings({})).toEqual(DEFAULT_SETTINGS);
    expect(normalizeSettings({ baseUrl: '   ', mode: 'bogus', proxyEndpoint: '  ' })).toEqual(
      DEFAULT_SETTINGS,
    );
  });

  it('keeps a usable field even when its neighbours are junk', () => {
    // The fields are validated one at a time on purpose: one bad value should
    // not reset a form the user has been filling in.
    expect(normalizeSettings({ baseUrl: '', mode: 'direct', proxyEndpoint: '' })).toEqual({
      ...DEFAULT_SETTINGS,
      mode: 'direct',
    });
  });

  it('treats an unknown transport as the safer one', () => {
    expect(normalizeSettings({ mode: 'whatever' }).mode).toBe('proxy');
    expect(normalizeSettings({ mode: 'direct' }).mode).toBe('direct');
  });

  it('keeps what it recognises and trims it', () => {
    expect(
      normalizeSettings({ baseUrl: '  https://h:7776  ', mode: 'direct', proxyEndpoint: ' /p ' }),
    ).toEqual({ baseUrl: 'https://h:7776', mode: 'direct', proxyEndpoint: '/p' });
  });
});

describe('loadSettings / saveSettings', () => {
  it('returns the defaults when there is no storage at all', () => {
    expect(loadSettings(null)).toEqual(DEFAULT_SETTINGS);
  });

  it('returns the defaults when the stored entry is corrupt', () => {
    expect(loadSettings(fakeStorage({ 'wardogs-panel:connection:v1': '{not json' }))).toEqual(
      DEFAULT_SETTINGS,
    );
  });

  it('round-trips', () => {
    const storage = fakeStorage();
    const settings = { baseUrl: 'https://real:7776', mode: 'direct' as const, proxyEndpoint: '/p' };
    saveSettings(settings, storage);
    expect(loadSettings(storage)).toEqual(settings);
  });

  it('never stores a token', () => {
    const storage = fakeStorage();
    saveSettings(normalizeSettings({ mode: 'direct' }), storage);
    const written = JSON.stringify(storage.data);
    expect(written).not.toContain('token');
    expect(Object.keys(JSON.parse(written) as object)).toEqual(['wardogs-panel:connection:v1']);
  });
});

describe('isLoopback', () => {
  it('recognises every loopback spelling the library allows', () => {
    for (const host of ['127.0.0.1', '127.1.2.3', 'localhost', 'LOCALHOST', '[::1]']) {
      expect(isLoopback(`http://${host}:7776`), host).toBe(true);
    }
  });

  it('does not mistake a remote host for one', () => {
    expect(isLoopback('http://203.0.113.5:7776')).toBe(false);
    expect(isLoopback('https://my-server.example:7776')).toBe(false);
    expect(isLoopback('not a url')).toBe(false);
  });
});

describe('isPlaintextRemote', () => {
  it('flags the combination the library refuses by default', () => {
    expect(isPlaintextRemote('http://203.0.113.5:7777')).toBe(true);
    expect(isPlaintextRemote('http://game.example:7776')).toBe(true);
  });

  it('leaves loopback and TLS alone', () => {
    expect(isPlaintextRemote('http://127.0.0.1:7777')).toBe(false);
    expect(isPlaintextRemote('http://localhost:7777')).toBe(false);
    expect(isPlaintextRemote('https://203.0.113.5:7776')).toBe(false);
    expect(isPlaintextRemote('nonsense')).toBe(false);
  });
});

describe('originOf', () => {
  it('gives a proxy the form it allow-lists on', () => {
    // Origins, never string prefixes: `https://my-server.attacker.example`
    // passes a `startsWith('https://my-server')` check.
    expect(originOf('http://203.0.113.5:9121')).toBe('http://203.0.113.5:9121');
    expect(originOf('https://my-server.example:7776/v1')).toBe('https://my-server.example:7776');
  });

  it('falls back to the raw text rather than throwing', () => {
    expect(originOf('not a url')).toBe('not a url');
  });
});

describe('createConnectedClient', () => {
  it('builds in proxy mode without a token, because the backend holds it', () => {
    // The browser in proxy mode has no credential to give, and the proxy
    // injects its own. The client still requires a non-empty token, so the
    // panel supplies a placeholder — this asserts that path stays constructible.
    const client = createConnectedClient(
      { baseUrl: 'https://my-server.example:7776', mode: 'proxy', proxyEndpoint: '/rcon-proxy' },
      '',
    );
    expect(client.baseUrl).toBe('https://my-server.example:7776');
  });

  it('requires a token in direct mode', () => {
    expect(() => createConnectedClient({ ...DEFAULT_SETTINGS, mode: 'direct' }, '')).toThrow(
      WardogsError,
    );
  });

  it('allows plaintext to a remote host in proxy mode', () => {
    // The browser never opens a connection to this host — `baseUrl` travels as
    // a header describing what the backend should fetch. Whether plaintext is
    // acceptable there is the proxy's decision to make, and it has its own
    // allow-list and its own gate for it.
    const client = createConnectedClient(
      { baseUrl: 'http://203.0.113.5:7777', mode: 'proxy', proxyEndpoint: '/rcon-proxy' },
      '',
    );
    expect(client.baseUrl).toBe('http://203.0.113.5:7777');
  });

  it('still refuses plaintext to a remote host in direct mode', () => {
    // Here the page really is the client, and the connection would fail anyway.
    expect(() =>
      createConnectedClient(
        { baseUrl: 'http://203.0.113.5:7777', mode: 'direct', proxyEndpoint: '/p' },
        'token',
      ),
    ).toThrow(/TLS/);
  });

  it('lifts that refusal in direct mode when the operator says so', () => {
    // The library documents `allowInsecureHttp` as an escape hatch, and only the
    // operator knows whether something in front of the server terminates TLS.
    // The panel surfaces the switch rather than deciding on their behalf.
    const client = createConnectedClient(
      { baseUrl: 'http://203.0.113.5:7777', mode: 'direct', proxyEndpoint: '/p' },
      'token',
      { allowPlaintext: true },
    );
    expect(client.baseUrl).toBe('http://203.0.113.5:7777');
  });

  it('leaves loopback alone regardless of the switch', () => {
    const client = createConnectedClient({ ...DEFAULT_SETTINGS, mode: 'direct' }, 'token', {
      allowPlaintext: false,
    });
    expect(client.baseUrl).toBe(DEFAULT_SETTINGS.baseUrl);
  });

  it('surfaces a malformed base URL at construction, not at first request', () => {
    expect(() =>
      createConnectedClient({ ...DEFAULT_SETTINGS, baseUrl: 'host:7776' }, 'token'),
    ).toThrow(WardogsError);
  });

  it('uses a placeholder the proxy never forwards', () => {
    expect(PROXY_PLACEHOLDER_TOKEN.length).toBeGreaterThan(0);
  });
});

/**
 * What actually leaves the browser in proxy mode.
 *
 * The client emits an `Authorization` header on every request, built from the
 * token it was constructed with — there is no "no credential" state. Since the
 * proxy adapter passes unrecognised headers straight through, a placeholder
 * sent by accident replaces whatever credential the backend would have used.
 * These two tests are the difference between that working and not.
 */
describe('proxy transport headers', () => {
  async function captureProxyRequest(token: string): Promise<Record<string, string>> {
    const sent: FetchInit[] = [];
    const original = globalThis.fetch;

    const stub: FetchLike = (url, init): Promise<FetchResponse> => {
      sent.push({ ...init, url: String(url) } as FetchInit);
      return Promise.resolve({
        ok: true,
        status: 200,
        statusText: 'OK',
        text: () => Promise.resolve('{}'),
      });
    };

    (globalThis as { fetch?: FetchLike }).fetch = stub;
    try {
      const client = createConnectedClient(
        { baseUrl: 'https://my-server.example:7776', mode: 'proxy', proxyEndpoint: '/rcon-proxy' },
        token,
      );
      await client.status.get();
    } finally {
      (globalThis as { fetch?: FetchLike }).fetch = original;
    }

    const init = sent[0];
    if (init?.headers === undefined) throw new Error('No request was sent.');
    return init.headers;
  }

  it('sends no Authorization at all when the backend holds the token', async () => {
    const headers = await captureProxyRequest('');
    expect(headers['Authorization']).toBeUndefined();
    expect(Object.keys(headers).map((key) => key.toLowerCase())).not.toContain('authorization');
    // The real request is described in headers, which is the whole protocol.
    expect(headers['X-Wardogs-Target']).toBe('https://my-server.example:7776/v1/status');
    expect(headers['X-Wardogs-Method']).toBe('GET');
  });

  it('forwards a typed token when the proxy expects one from the browser', async () => {
    const headers = await captureProxyRequest('rcon-password');
    expect(headers['Authorization']).toBe('Bearer rcon-password');
  });
});
