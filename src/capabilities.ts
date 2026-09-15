/**
 * Feature detection.
 *
 * Not every server exposes every route. The reference is emphatic about this
 * and says the admin panel gates its own UI on exactly this call: it offers
 * "change team" only when `PATCH /v1/players/{id}` is in `routes`, and the
 * config editor only when `config.writable` is true.
 *
 * This module wraps that call with caching and, more importantly, with
 * comparison that survives the parameter-naming mismatch between the spec and
 * the reference's examples — see {@link normalizeRoute}.
 */

import type { WardogsClient } from './core/client.js';
import type { Capabilities } from './core/types.js';
import { normalizeRoute, type RouteId } from './core/routes.js';

export interface CapabilitiesOptions {
  /**
   * How long a result stays fresh, in milliseconds. Default `30000`.
   *
   * Capabilities change when the server is reconfigured and restarted, so a
   * short cache is enough to keep a polling UI from re-fetching the same list
   * on every render, without hiding a real change for long.
   */
  ttlMs?: number;
  /** Force a fetch on construction. Default `false` — the first call loads. */
  eager?: boolean;
}

/** Cached capability lookup for one client. */
export interface CapabilitiesProbe {
  /** The capability payload, from cache when still fresh. */
  get(force?: boolean): Promise<Capabilities>;
  /** Whether the server exposes a given route. */
  supports(route: RouteId | string, force?: boolean): Promise<boolean>;
  /** Whether `PUT /v1/config` is available on this server. */
  configWritable(force?: boolean): Promise<boolean>;
  /** Drops the cache, so the next call re-fetches. */
  clear(): void;
  /** The last payload fetched, without triggering a request. */
  peek(): Capabilities | null;
}

/**
 * Creates a cached capability probe over a client.
 *
 * ```ts
 * const caps = createCapabilities(client);
 * if (await caps.supports('PATCH /v1/players/{steamId}')) {
 *   // offer the "change faction" control
 * }
 * ```
 */
export function createCapabilities(
  // Only `capabilities()` is ever called, so asking for exactly that keeps a
  // stub down to one method while a whole client stays assignable.
  client: { meta: Pick<WardogsClient['meta'], 'capabilities'> },
  options: CapabilitiesOptions = {},
): CapabilitiesProbe {
  const ttlMs = options.ttlMs ?? 30_000;

  let cached: Capabilities | null = null;
  let cachedAt = 0;
  let inFlight: Promise<Capabilities> | null = null;

  const load = async (): Promise<Capabilities> => {
    // Collapse concurrent misses onto one request: a dashboard with several
    // gated widgets mounts them all in the same tick.
    if (inFlight !== null) return inFlight;

    inFlight = client.meta
      .capabilities()
      .then((capabilities) => {
        cached = capabilities;
        cachedAt = Date.now();
        return capabilities;
      })
      .finally(() => {
        inFlight = null;
      });

    return inFlight;
  };

  const probe: CapabilitiesProbe = {
    async get(force = false) {
      if (!force && cached !== null && Date.now() - cachedAt < ttlMs) {
        return cached;
      }
      return load();
    },

    async supports(route, force = false) {
      const capabilities = await probe.get(force);
      const wanted = normalizeRoute(route);
      return (capabilities.routes ?? []).some((available) => normalizeRoute(available) === wanted);
    },

    async configWritable(force = false) {
      const capabilities = await probe.get(force);
      return capabilities.config?.writable === true;
    },

    clear() {
      cached = null;
      cachedAt = 0;
    },

    peek() {
      return cached;
    },
  };

  if (options.eager === true) {
    void load();
  }

  return probe;
}

/**
 * Finds capability entries that match a route, returning them verbatim.
 *
 * Where {@link CapabilitiesProbe.supports} answers yes or no, this returns the
 * server's own strings — handy when logging why a check failed, since the
 * mismatch is usually a renamed path parameter rather than a missing route.
 */
export function findRouteEntries(capabilities: Capabilities, route: RouteId | string): string[] {
  const wanted = normalizeRoute(route);
  return (capabilities.routes ?? []).filter((available) => normalizeRoute(available) === wanted);
}
