/**
 * The default transport: pass every request straight to `fetch`.
 *
 * This is what the client uses when no `fetch` option is supplied. It exists
 * as a named export anyway so the default path is explicit and testable, and
 * so {@link createProxyFetch} has a documented thing to delegate to.
 */

import { NO_FETCH_HINT } from '../core/errors.js';
import type { FetchLike } from '../core/http.js';

export interface DirectFetchOptions {
  /** Override the global `fetch` (a polyfill, `undici`, a tracing wrapper). */
  fetch?: FetchLike;
}

/**
 * Returns a {@link FetchLike} that calls `fetch` directly.
 *
 * Resolution order is the provided implementation, then `globalThis.fetch`.
 * The lookup happens per request rather than once at construction, so a test
 * that installs a polyfill after importing the library still works, and
 * `createClient` stays free of surprise failures at import time.
 */
export function createDirectFetch(options: DirectFetchOptions = {}): FetchLike {
  const { fetch: provided } = options;

  return async (url, init) => {
    const impl = provided ?? (globalThis as { fetch?: FetchLike }).fetch;

    if (typeof impl !== 'function') {
      throw new Error(NO_FETCH_HINT);
    }

    return impl(url, init);
  };
}
