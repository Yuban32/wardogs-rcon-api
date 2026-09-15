/**
 * Capability probing: cache behaviour and, most importantly, route comparison
 * across the parameter-naming mismatch between the spec and the reference.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Capabilities } from '../src/index.js';
import { createCapabilities, findRouteEntries } from '../src/index.js';

function capabilitiesPayload(routes: string[], writable = true): Capabilities {
  return { routes, config: { writable } };
}

/**
 * Builds a probe over a stubbed `meta.capabilities`, counting invocations.
 *
 * The probe needs exactly one method from the client, so a stub is both
 * simpler than wiring a whole client and more precise: the call count *is* the
 * thing under test.
 */
function probeWith(
  responder: () => Promise<Capabilities> | Capabilities,
  options: Parameters<typeof createCapabilities>[1] = {},
): { probe: ReturnType<typeof createCapabilities>; calls: () => number } {
  let calls = 0;
  const probe = createCapabilities(
    {
      meta: {
        capabilities: () => {
          calls++;
          return Promise.resolve(responder());
        },
      },
    },
    options,
  );
  return { probe, calls: () => calls };
}

afterEach(() => {
  vi.useRealTimers();
});

/* -------------------------------------------------------------------------- */
/* Caching                                                                     */
/* -------------------------------------------------------------------------- */

describe('caching', () => {
  it('fetches once and serves from cache', async () => {
    const { probe, calls } = probeWith(() => capabilitiesPayload(['GET /v1/status']));

    await probe.get();
    await probe.get();
    await probe.get();

    expect(calls()).toBe(1);
  });

  it('refetches after the TTL expires', async () => {
    vi.useFakeTimers();
    const { probe, calls } = probeWith(() => capabilitiesPayload(['GET /v1/status']), {
      ttlMs: 1000,
    });

    await probe.get();
    vi.advanceTimersByTime(1001);
    await probe.get();

    expect(calls()).toBe(2);
  });

  it('refetches when forced, regardless of the TTL', async () => {
    const { probe, calls } = probeWith(() => capabilitiesPayload(['GET /v1/status']));

    await probe.get();
    await probe.get(true);

    expect(calls()).toBe(2);
  });

  it('collapses concurrent misses onto one request', async () => {
    // A dashboard mounting several gated widgets in the same tick would
    // otherwise fire one capabilities request per widget.
    let resolve: ((value: Capabilities) => void) | undefined;
    const { probe, calls } = probeWith(
      () =>
        new Promise<Capabilities>((r) => {
          resolve = r;
        }),
    );

    const inflight = [probe.get(), probe.get(), probe.get()];
    expect(calls()).toBe(1);

    resolve?.(capabilitiesPayload(['GET /v1/status']));
    await Promise.all(inflight);

    expect(calls()).toBe(1);
  });

  it('drops the cache on clear()', async () => {
    const { probe, calls } = probeWith(() => capabilitiesPayload([]));

    await probe.get();
    probe.clear();
    await probe.get();

    expect(calls()).toBe(2);
  });

  it('exposes the last payload without fetching', async () => {
    const { probe, calls } = probeWith(() => capabilitiesPayload(['GET /v1/status']));

    expect(probe.peek()).toBeNull();
    await probe.get();

    expect(probe.peek()?.routes).toEqual(['GET /v1/status']);
    expect(calls()).toBe(1);
  });

  it('does not fetch on construction unless eager', async () => {
    const lazy = probeWith(() => capabilitiesPayload([]));
    expect(lazy.calls()).toBe(0);
  });

  it('starts the fetch on construction when eager', async () => {
    const eager = probeWith(() => capabilitiesPayload(['GET /v1/status']), { eager: true });

    expect(eager.calls()).toBe(1);
    await eager.probe.get();
    // One fetch total: the eager load is the one `get()` then reads.
    expect(eager.calls()).toBe(1);
  });

  it('keeps serving the cached value until the TTL lapses', async () => {
    let version = 1;
    const { probe } = probeWith(() => capabilitiesPayload([`GET /v1/status?v=${version}`]));

    await probe.get();
    version = 2;

    expect((await probe.get()).routes).toEqual(['GET /v1/status?v=1']);
  });
});

/* -------------------------------------------------------------------------- */
/* Route comparison                                                            */
/* -------------------------------------------------------------------------- */

describe('route comparison', () => {
  it('matches across the spec/prose parameter naming mismatch', async () => {
    // The capability list is documented with `{id}`; the spec uses `{steamId}`.
    // A naive string compare reports this route as unsupported, which would
    // hide a working feature behind a feature flag.
    const { probe } = probeWith(() =>
      capabilitiesPayload([
        'GET /v1/status',
        'PATCH /v1/players/{id}',
        'DELETE /v1/rotation/entries/{i}',
      ]),
    );

    await expect(probe.supports('PATCH /v1/players/{steamId}')).resolves.toBe(true);
    await expect(probe.supports('DELETE /v1/rotation/entries/{i}')).resolves.toBe(true);
  });

  it('reports a genuinely absent route as unsupported', async () => {
    const { probe } = probeWith(() => capabilitiesPayload(['GET /v1/status']));

    await expect(probe.supports('PATCH /v1/players/{steamId}')).resolves.toBe(false);
  });

  it('compares case-insensitively on the method', async () => {
    const { probe } = probeWith(() => capabilitiesPayload(['get /v1/status']));
    await expect(probe.supports('GET /v1/status')).resolves.toBe(true);
  });

  it('tolerates a trailing slash on either side', async () => {
    const { probe } = probeWith(() => capabilitiesPayload(['GET /v1/status/']));
    await expect(probe.supports('GET /v1/status')).resolves.toBe(true);
  });

  it('handles an empty routes array', async () => {
    const { probe } = probeWith(() => ({ routes: [], config: { writable: false } }));
    await expect(probe.supports('GET /v1/status')).resolves.toBe(false);
  });

  it('handles a missing routes field without throwing', async () => {
    const { probe } = probeWith(() => ({ config: { writable: false } }) as Capabilities);
    await expect(probe.supports('GET /v1/status')).resolves.toBe(false);
  });

  it('forces a refresh when asked', async () => {
    const { probe, calls } = probeWith(() => capabilitiesPayload(['GET /v1/status']));

    await probe.supports('GET /v1/status');
    await probe.supports('GET /v1/status', true);

    expect(calls()).toBe(2);
  });
});

/* -------------------------------------------------------------------------- */
/* Config writability                                                          */
/* -------------------------------------------------------------------------- */

describe('config writability', () => {
  it('reflects the config.writable flag', async () => {
    const { probe } = probeWith(() => capabilitiesPayload([], true));
    await expect(probe.configWritable()).resolves.toBe(true);
  });

  it('is false when the server says the config is read-only', async () => {
    const { probe } = probeWith(() => capabilitiesPayload([], false));
    await expect(probe.configWritable()).resolves.toBe(false);
  });

  it('is false when the flag is absent, rather than assumed true', async () => {
    // Erring toward "not writable" is the safe direction: offering an editor
    // that cannot save is a worse failure than hiding one that could.
    const { probe } = probeWith(() => ({ routes: [] }) as unknown as Capabilities);
    await expect(probe.configWritable()).resolves.toBe(false);
  });
});

/* -------------------------------------------------------------------------- */
/* Diagnostics                                                                 */
/* -------------------------------------------------------------------------- */

describe('findRouteEntries', () => {
  it('returns the server strings that matched, for diagnostics', () => {
    const capabilities = capabilitiesPayload(['GET /v1/status', 'PATCH /v1/players/{id}']);

    // The returned string is the server's own spelling, which is what you need
    // when the check failed and you are comparing by eye.
    expect(findRouteEntries(capabilities, 'PATCH /v1/players/{steamId}')).toEqual([
      'PATCH /v1/players/{id}',
    ]);
    expect(findRouteEntries(capabilities, 'POST /v1/bans')).toEqual([]);
  });

  it('returns nothing for a malformed capability entry rather than matching it', () => {
    const capabilities = capabilitiesPayload(['garbage', 'GET /v1/status']);
    expect(findRouteEntries(capabilities, 'GET /v1/status')).toEqual(['GET /v1/status']);
  });
});
