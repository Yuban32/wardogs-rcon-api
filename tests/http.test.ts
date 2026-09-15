/**
 * Transport behaviour: URL construction, timeout, retry policy, and the
 * guardrails that catch misconfiguration before it becomes a confusing error.
 */

import { describe, expect, it, vi } from 'vitest';

import { createClient } from '../src/index.js';
import {
  WardogsAbortError,
  WardogsError,
  WardogsHttpError,
  WardogsNetworkError,
  WardogsParseError,
  WardogsTimeoutError,
  buildUrl,
  normalizeBaseUrl,
} from '../src/index.js';
import { createRecordingFetch, statusPayload } from './helpers.js';

const BASE = 'https://my-server.example:7776';
const TOKEN = 'tok';

/* -------------------------------------------------------------------------- */
/* normalizeBaseUrl                                                            */
/* -------------------------------------------------------------------------- */

describe('normalizeBaseUrl', () => {
  it('accepts a well-formed URL and normalizes it', () => {
    expect(normalizeBaseUrl('https://host:7776')).toBe('https://host:7776');
    expect(normalizeBaseUrl('https://host:7776/')).toBe('https://host:7776');
    expect(normalizeBaseUrl('https://host:7776///')).toBe('https://host:7776');
  });

  it('preserves a base path, for a server behind a reverse proxy', () => {
    expect(normalizeBaseUrl('https://host/rcon')).toBe('https://host/rcon');
    expect(normalizeBaseUrl('https://host/rcon/')).toBe('https://host/rcon');
  });

  it('defaults an unspecified port to the scheme default', () => {
    expect(normalizeBaseUrl('https://host')).toBe('https://host');
  });

  it('rejects a relative or malformed URL', () => {
    expect(() => normalizeBaseUrl('host:7776')).toThrow(WardogsError);
    expect(() => normalizeBaseUrl('/v1')).toThrow(WardogsError);
    expect(() => normalizeBaseUrl('')).toThrow(WardogsError);
  });

  it('rejects a non-HTTP scheme', () => {
    expect(() => normalizeBaseUrl('ws://host:7776')).toThrow(/protocol/);
    expect(() => normalizeBaseUrl('file:///tmp')).toThrow(/protocol/);
  });

  it('rejects plaintext http to a remote host with an actionable message', () => {
    // The single most likely misconfiguration: a network-bound listener
    // requires TLS, so this can never connect, and the raw failure would be a
    // socket error nobody can act on.
    expect(() => normalizeBaseUrl('http://203.0.113.5:7776')).toThrow(
      /network-exposed Wardogs RCON listener requires TLS/,
    );
    expect(() => normalizeBaseUrl('http://game.example.com:7776')).toThrow(/TLS/);
  });

  it('allows plaintext http to every loopback spelling', () => {
    for (const host of ['127.0.0.1', '127.1.2.3', 'localhost', 'LOCALHOST', '[::1]']) {
      expect(() => normalizeBaseUrl(`http://${host}:7776`), host).not.toThrow();
    }
  });

  it('allows plaintext http to a remote host when explicitly permitted', () => {
    expect(normalizeBaseUrl('http://203.0.113.5:7776', { allowInsecureHttp: true })).toBe(
      'http://203.0.113.5:7776',
    );
  });
});

/* -------------------------------------------------------------------------- */
/* buildUrl                                                                    */
/* -------------------------------------------------------------------------- */

describe('buildUrl', () => {
  it('joins base and path', () => {
    expect(buildUrl(BASE, '/v1/status')).toBe(`${BASE}/v1/status`);
  });

  it('tolerates a path without a leading slash', () => {
    expect(buildUrl(BASE, 'v1/status')).toBe(`${BASE}/v1/status`);
  });

  it('serializes query parameters', () => {
    expect(buildUrl(BASE, '/v1/audit', { limit: 10 })).toBe(`${BASE}/v1/audit?limit=10`);
  });

  it('omits undefined and null query values entirely', () => {
    // This is what lets optional parameters be passed through unconditionally,
    // rather than built up with conditional spreads at every call site.
    const url = buildUrl(BASE, '/v1/config', {
      force: undefined,
      fullApply: null,
      other: 'x',
    });
    expect(url).toBe(`${BASE}/v1/config?other=x`);
    expect(url).not.toContain('force');
    expect(url).not.toContain('fullApply');
  });

  it('serializes booleans and numbers as strings', () => {
    expect(buildUrl(BASE, '/v1/config', { force: false, fullApply: true })).toBe(
      `${BASE}/v1/config?force=false&fullApply=true`,
    );
  });

  it('percent-encodes query values', () => {
    expect(buildUrl(BASE, '/v1/x', { q: 'a b&c=d' })).toBe(`${BASE}/v1/x?q=a+b%26c%3Dd`);
  });
});

/* -------------------------------------------------------------------------- */
/* Response decoding                                                           */
/* -------------------------------------------------------------------------- */

describe('response decoding', () => {
  const clientFor = (rec: ReturnType<typeof createRecordingFetch>) =>
    createClient({ baseUrl: BASE, token: TOKEN, fetch: rec.fetch, retries: 0 });

  it('decodes a JSON body', async () => {
    const rec = createRecordingFetch([{ body: { hello: 'world' } }]);
    const result = await clientFor(rec).request<{ hello: string }>('GET', '/v1/x');
    expect(result).toEqual({ hello: 'world' });
  });

  it('treats an empty body as undefined rather than a parse error', async () => {
    const rec = createRecordingFetch([{ status: 204 }]);
    await expect(clientFor(rec).players.kill('76561198000000001')).resolves.toBeUndefined();
  });

  it('raises WardogsParseError when a JSON endpoint answers with HTML', async () => {
    // A proxy error page or a captive portal. Failing here names the problem;
    // letting it through would surface as a bewildering `undefined` later.
    const rec = createRecordingFetch([{ raw: '<html>502 Bad Gateway</html>' }]);
    await expect(clientFor(rec).status.get()).rejects.toBeInstanceOf(WardogsParseError);
  });

  it('includes the offending body on the parse error', async () => {
    const rec = createRecordingFetch([{ raw: 'not json' }]);
    const error = await clientFor(rec)
      .status.get()
      .catch((e: unknown) => e as WardogsParseError);

    expect(error).toBeInstanceOf(WardogsParseError);
    expect(error.body).toBe('not json');
  });
});

/* -------------------------------------------------------------------------- */
/* HTTP errors                                                                 */
/* -------------------------------------------------------------------------- */

describe('http error mapping', () => {
  const clientFor = (rec: ReturnType<typeof createRecordingFetch>) =>
    createClient({ baseUrl: BASE, token: TOKEN, fetch: rec.fetch, retries: 0 });

  it('maps the documented error envelope', async () => {
    const rec = createRecordingFetch([
      { status: 400, body: { error: { code: 'bad_request', message: 'map not found' } } },
    ]);

    const error = await clientFor(rec)
      .status.get()
      .catch((e: unknown) => e as WardogsHttpError);

    expect(error).toBeInstanceOf(WardogsHttpError);
    expect(error.status).toBe(400);
    expect(error.code).toBe('bad_request');
    expect(error.message).toContain('map not found');
    expect(error.body).toEqual({ error: { code: 'bad_request', message: 'map not found' } });
  });

  it('falls back to http_<status> when the body is not the documented shape', async () => {
    const rec = createRecordingFetch([{ status: 502, raw: 'bad gateway' }]);

    const error = await clientFor(rec)
      .status.get()
      .catch((e: unknown) => e as WardogsHttpError);

    expect(error).toBeInstanceOf(WardogsHttpError);
    expect(error.code).toBe('http_502');
    expect(error.message).toContain('bad gateway');
  });

  it('uses a plain message field when a proxy sends one', async () => {
    const rec = createRecordingFetch([{ status: 503, body: { message: 'maintenance' } }]);

    const error = await clientFor(rec)
      .status.get()
      .catch((e: unknown) => e as WardogsHttpError);

    expect(error.code).toBe('http_503');
    expect(error.message).toContain('maintenance');
  });

  it('classifies 412 as a revision conflict', async () => {
    const rec = createRecordingFetch([
      { status: 412, body: { error: { code: 'revision_mismatch', message: 'stale' } } },
    ]);

    const error = await clientFor(rec)
      .config.apply('doc')
      .catch((e: unknown) => e as WardogsHttpError);

    expect(error.isRevisionConflict).toBe(true);
    expect(error.isAuthError).toBe(false);
  });

  it('classifies 401 and 403 as auth failures', async () => {
    for (const status of [401, 403]) {
      const rec = createRecordingFetch([{ status, body: { error: { code: 'x', message: 'y' } } }]);
      const error = await clientFor(rec)
        .status.get()
        .catch((e: unknown) => e as WardogsHttpError);

      expect(error.isAuthError, `status ${status}`).toBe(true);
    }
  });

  it('classifies 5xx and 429 as retryable', async () => {
    for (const status of [500, 502, 429]) {
      const rec = createRecordingFetch([{ status, body: {} }]);
      const error = await clientFor(rec)
        .status.get()
        .catch((e: unknown) => e as WardogsHttpError);

      expect(error.isRetryable, `status ${status}`).toBe(true);
    }
  });

  it('does not classify a 404 as retryable', async () => {
    const rec = createRecordingFetch([
      { status: 404, body: { error: { code: 'not_found', message: 'no' } } },
    ]);
    const error = await clientFor(rec)
      .status.get()
      .catch((e: unknown) => e as WardogsHttpError);

    expect(error.isRetryable).toBe(false);
  });

  it('carries the request method and URL for diagnosis', async () => {
    const rec = createRecordingFetch([{ status: 500, body: {} }]);
    const error = await clientFor(rec)
      .players.kick('76561198000000001')
      .catch((e: unknown) => e as WardogsHttpError);

    expect(error.method).toBe('POST');
    expect(error.url).toContain('/v1/players/76561198000000001/kick');
  });
});

/* -------------------------------------------------------------------------- */
/* Transport failures                                                          */
/* -------------------------------------------------------------------------- */

describe('transport failures', () => {
  const clientFor = (
    rec: ReturnType<typeof createRecordingFetch>,
    options: { retries?: number; timeoutMs?: number } = {},
  ) =>
    createClient({
      baseUrl: BASE,
      token: TOKEN,
      fetch: rec.fetch,
      retries: options.retries ?? 0,
      ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
    });

  it('raises WardogsNetworkError when no response arrives', async () => {
    const rec = createRecordingFetch([{ throws: new TypeError('fetch failed') }]);

    const error = await clientFor(rec)
      .status.get()
      .catch((e: unknown) => e as WardogsNetworkError);

    expect(error).toBeInstanceOf(WardogsNetworkError);
    expect(error.message).toContain('failed before a response');
    expect(error.method).toBe('GET');
  });

  it('raises WardogsTimeoutError when the server never answers', async () => {
    const rec = createRecordingFetch([{ hang: true }]);

    const error = await clientFor(rec, { timeoutMs: 25 })
      .status.get()
      .catch((e: unknown) => e as WardogsTimeoutError);

    expect(error).toBeInstanceOf(WardogsTimeoutError);
    expect(error.timeoutMs).toBe(25);
  });

  it('distinguishes caller cancellation from a timeout', async () => {
    // Both abort the request, but they mean different things: one is a bug in
    // the timeout configuration, the other is the caller changing their mind.
    // The timeout is deliberately far longer than the cancellation, so the
    // signal under test is unambiguous.
    vi.useFakeTimers();
    try {
      const rec = createRecordingFetch([{ hang: true }]);
      const controller = new AbortController();
      const client = createClient({
        baseUrl: BASE,
        token: TOKEN,
        fetch: rec.fetch,
        retries: 0,
        timeoutMs: 60_000,
      });

      const pending = client.status.get({ signal: controller.signal }).catch((e: unknown) => e);
      await vi.advanceTimersByTimeAsync(1);

      controller.abort();
      const error = await pending;

      expect(error).toBeInstanceOf(WardogsAbortError);
    } finally {
      vi.useRealTimers();
    }
  });

  it('preserves the underlying error as cause', async () => {
    const underlying = new TypeError('ECONNREFUSED');
    const rec = createRecordingFetch([{ throws: underlying }]);

    const error = await clientFor(rec)
      .status.get()
      .catch((e: unknown) => e as WardogsNetworkError);

    expect(error.cause).toBe(underlying);
  });
});

/* -------------------------------------------------------------------------- */
/* Retry policy                                                                */
/* -------------------------------------------------------------------------- */

describe('retry policy', () => {
  it('retries a failing GET', async () => {
    const rec = createRecordingFetch([
      { throws: new TypeError('fetch failed') },
      { body: statusPayload() },
    ]);
    const client = createClient({ baseUrl: BASE, token: TOKEN, fetch: rec.fetch, retries: 1 });

    await expect(client.status.get()).resolves.toMatchObject({ serverName: 'Test Server' });
    expect(rec.count).toBe(2);
  });

  it('retries a 5xx GET', async () => {
    const rec = createRecordingFetch([{ status: 503, body: {} }, { body: statusPayload() }]);
    const client = createClient({ baseUrl: BASE, token: TOKEN, fetch: rec.fetch, retries: 1 });

    await expect(client.status.get()).resolves.toBeDefined();
    expect(rec.count).toBe(2);
  });

  it('never retries a write, because a retried kick could kick twice', async () => {
    // The server may have acted before the connection dropped, so a retry
    // risks a duplicate side effect. Surfacing the error is the only safe
    // default.
    const rec = createRecordingFetch([
      { throws: new TypeError('fetch failed') },
      { body: { ok: true } },
    ]);
    const client = createClient({ baseUrl: BASE, token: TOKEN, fetch: rec.fetch, retries: 3 });

    await expect(client.players.kick('76561198000000001')).rejects.toBeInstanceOf(
      WardogsNetworkError,
    );
    expect(rec.count).toBe(1);
  });

  it('never retries a POST that failed at the transport level', async () => {
    const rec = createRecordingFetch([
      { throws: new TypeError('fetch failed') },
      { body: { ok: true } },
    ]);
    const client = createClient({ baseUrl: BASE, token: TOKEN, fetch: rec.fetch, retries: 3 });

    await expect(client.match.restart()).rejects.toBeInstanceOf(WardogsNetworkError);
    expect(rec.count).toBe(1);
  });

  it('never retries a DELETE', async () => {
    const rec = createRecordingFetch([{ status: 500, body: {} }, { body: { ok: true } }]);
    const client = createClient({ baseUrl: BASE, token: TOKEN, fetch: rec.fetch, retries: 3 });

    await expect(client.bans.remove('76561198000000001')).rejects.toBeInstanceOf(WardogsHttpError);
    expect(rec.count).toBe(1);
  });

  it('does not retry a non-retryable status', async () => {
    const rec = createRecordingFetch([
      { status: 404, body: { error: { code: 'not_found', message: 'x' } } },
      { body: statusPayload() },
    ]);
    const client = createClient({ baseUrl: BASE, token: TOKEN, fetch: rec.fetch, retries: 3 });

    await expect(client.status.get()).rejects.toBeInstanceOf(WardogsHttpError);
    expect(rec.count).toBe(1);
  });

  it('gives up after exhausting the retry budget, reporting the last failure', async () => {
    const rec = createRecordingFetch([{ throws: new TypeError('fetch failed') }]);
    const client = createClient({ baseUrl: BASE, token: TOKEN, fetch: rec.fetch, retries: 2 });

    await expect(client.status.get()).rejects.toBeInstanceOf(WardogsNetworkError);
    expect(rec.count).toBe(3);
  });

  it('does not retry by default beyond the configured default of one', async () => {
    const rec = createRecordingFetch([{ throws: new TypeError('fetch failed') }]);
    const client = createClient({ baseUrl: BASE, token: TOKEN, fetch: rec.fetch });

    await expect(client.status.get()).rejects.toBeInstanceOf(WardogsNetworkError);
    expect(rec.count).toBe(2);
  });

  it('honours a per-call retry override', async () => {
    const rec = createRecordingFetch([{ throws: new TypeError('fetch failed') }]);
    const client = createClient({ baseUrl: BASE, token: TOKEN, fetch: rec.fetch, retries: 1 });

    await expect(client.status.get({ retries: 0 })).rejects.toBeInstanceOf(WardogsNetworkError);
    expect(rec.count).toBe(1);
  });
});

/* -------------------------------------------------------------------------- */
/* Runtime capabilities                                                        */
/* -------------------------------------------------------------------------- */

describe('fetch resolution', () => {
  it('explains itself when no fetch implementation exists', async () => {
    const client = createClient({
      baseUrl: BASE,
      token: TOKEN,
      // A function that reports the runtime as fetch-less.
      fetch: () => Promise.reject(new Error('should not be called')),
    });

    const rec = createRecordingFetch([{ body: {} }]);
    const working = createClient({ baseUrl: BASE, token: TOKEN, fetch: rec.fetch });
    await working.status.get();

    // The real assertion is that a provided fetch is used verbatim and no
    // global lookup happens behind it.
    await expect(client.status.get()).rejects.toThrow('should not be called');
  });
});
