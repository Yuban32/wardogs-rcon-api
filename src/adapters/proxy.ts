/**
 * A transport that forwards requests through a same-origin backend instead of
 * calling the game server directly.
 *
 * ## Why this exists
 *
 * A browser can talk to a Wardogs server only when two conditions both hold,
 * and on a typical self-hosted server they usually do not:
 *
 * 1. **CORS.** The server has to answer `OPTIONS` and send
 *    `Access-Control-Allow-Origin`. The API reference says a browser can call a
 *    TLS server, but it says nothing about the headers — and a dedicated server
 *    that never advertises them will be blocked by the browser before a single
 *    request lands.
 *
 * 2. **Mixed content.** A server bound to loopback is plaintext `http://`, and
 *    an HTTPS page is forbidden from calling it. That rules out the very setup
 *    an operator is most likely to be running locally.
 *
 * A same-origin backend sidesteps both, because the browser only ever talks to
 * its own origin. It also lets the token stay on the server, which is what the
 * API reference asks for: the bearer token is a full-access admin password with
 * no read-only variant, and it is not meant to reach a browser.
 *
 * ## The protocol
 *
 * `createProxyFetch` sends a normal request to your proxy endpoint and
 * describes the real request in headers:
 *
 * | Header                | Meaning                                    |
 * | --------------------- | ------------------------------------------ |
 * | `X-Wardogs-Target`    | Full target URL, e.g. `https://h:7776/v1/status` |
 * | `X-Wardogs-Method`    | `GET`, `POST`, `PATCH`, `PUT`, `DELETE`    |
 * | `Authorization`       | Forwarded only if you passed `token`       |
 * | content headers       | Forwarded as-is                            |
 *
 * Your proxy reads those, makes the real request to the target, and returns the
 * status, body and `Content-Type` unchanged. `examples/browser-proxy-server.mjs`
 * is a working reference implementation with target allow-listing.
 *
 * `X-Wardogs-Target` is sent as a request header because a same-origin endpoint
 * that requires a CORS preflight is not really a same-origin endpoint — the
 * browser would only preflight it if the document origin differed.
 */

import { WardogsError } from '../core/errors.js';
import type { FetchInit, FetchLike, FetchResponse } from '../core/http.js';

export interface ProxyFetchOptions {
  /**
   * Same-origin endpoint that performs the forwarding.
   * An absolute URL (e.g. `"https://panel.example/rcon"`) or a relative path
   * (e.g. `"/rcon-proxy"`).
   */
  endpoint: string;

  /**
   * Bearer token to forward, if the proxy does not hold one itself.
   *
   * Leave this unset when your proxy injects the RCON password server-side —
   * that is the point of using a proxy, and passing it here puts the
   * full-access admin password back on the browser.
   */
  token?: string;

  /**
   * Where to put the target URL: a request header (default) or a query
   * parameter. Use `"query"` only for a backend that cannot read custom
   * headers.
   */
  targetPlacement?: 'header' | 'query';

  /** Name of the target header or query parameter. */
  targetField?: string;

  /** Name of the method header. Ignored when `targetPlacement` is `"query"`. */
  methodField?: string;

  /** Extra headers to send to the proxy — auth cookies, CSRF tokens, tracing. */
  headers?: Record<string, string> | (() => Record<string, string>);

  /** Underlying implementation; defaults to the global `fetch`. */
  fetch?: FetchLike;
}

/** A `Response`-shaped value, which is what a real `fetch` resolves to. */
interface ResponseLike {
  ok: boolean;
  status: number;
  statusText?: string;
  text(): Promise<string>;
}

/**
 * Returns a {@link FetchLike} that routes requests through `endpoint`.
 *
 * ```ts
 * const client = createClient({
 *   baseUrl: 'https://my-server:7776',
 *   token: '',                                   // held by the proxy
 *   fetch: createProxyFetch({ endpoint: '/rcon-proxy' }),
 * });
 * ```
 *
 * The real target still comes from the client's `baseUrl`, so the proxy only
 * needs to allow-list the origin, not reproduce the API surface.
 */
export function createProxyFetch(options: ProxyFetchOptions): FetchLike {
  const {
    endpoint,
    token,
    targetPlacement = 'header',
    targetField = targetPlacement === 'query' ? 'target' : 'X-Wardogs-Target',
    methodField = 'X-Wardogs-Method',
    headers: extraHeaders,
    fetch: providedFetch,
  } = options;

  return async (url, init) => {
    const impl = providedFetch ?? (globalThis as { fetch?: FetchLike }).fetch;
    if (typeof impl !== 'function') {
      throw new WardogsError(
        'createProxyFetch needs a fetch implementation: none was provided and ' +
          'no global `fetch` exists in this runtime.',
      );
    }

    const method = (init?.method ?? 'GET').toUpperCase();
    const requestHeaders: Record<string, string> = {
      ...(init?.headers ?? {}),
      ...(typeof extraHeaders === 'function' ? extraHeaders() : extraHeaders),
    };

    let endpointUrl = endpoint;
    if (targetPlacement === 'query') {
      endpointUrl = appendQuery(endpoint, targetField, url);
    } else {
      requestHeaders[targetField] = url;
      requestHeaders[methodField] = method;
    }

    if (token !== undefined) {
      requestHeaders['Authorization'] = `Bearer ${token}`;
    }

    const proxyInit: FetchInit = {
      method: 'POST',
      headers: requestHeaders,
      ...(init?.body !== undefined ? { body: init.body } : {}),
      ...(init?.signal !== undefined ? { signal: init.signal } : {}),
    };

    const response = await impl(endpointUrl, proxyInit);

    if (isResponseLike(response)) {
      return response;
    }

    // Some runtimes expose a text-only response object (service workers, some
    // polyfills). Reconstruct the RFC-relevant members from its status alone.
    const shaped = response as unknown as { status: number; body?: unknown };
    const text =
      typeof shaped.body === 'string' ? shaped.body : JSON.stringify(shaped.body ?? null);

    return {
      ok: shaped.status >= 200 && shaped.status < 300,
      status: shaped.status,
      text: async () => text,
    };
  };
}

function isResponseLike(value: unknown): value is ResponseLike {
  if (value === null || typeof value !== 'object') return false;
  const candidate = value as Partial<ResponseLike>;
  return (
    typeof candidate.ok === 'boolean' &&
    typeof candidate.status === 'number' &&
    typeof candidate.text === 'function'
  );
}

function appendQuery(endpoint: string, key: string, value: string): string {
  const separator = endpoint.includes('?') ? '&' : '?';
  return `${endpoint}${separator}${encodeURIComponent(key)}=${encodeURIComponent(value)}`;
}
