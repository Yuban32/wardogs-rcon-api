/**
 * The transport layer: URL construction, request execution, timeout, retry and
 * body decoding.
 *
 * Every endpoint in the library funnels through {@link request} here. Keeping
 * the transport in one place is what makes the behavior uniform — the
 * `http://`-to-a-remote-host guard, the timeout wiring, the retry policy and
 * the error mapping are implemented once and cannot drift per endpoint.
 */

import {
  NO_FETCH_HINT,
  WardogsAbortError,
  WardogsError,
  WardogsHttpError,
  WardogsNetworkError,
  WardogsParseError,
  WardogsTimeoutError,
} from './errors.js';

/* -------------------------------------------------------------------------- */
/* Fetch abstraction                                                           */
/* -------------------------------------------------------------------------- */

/**
 * The subset of a `fetch` request that this library uses.
 *
 * Types are declared locally rather than borrowed from `lib.dom` or
 * `@types/node` so the library compiles and behaves identically in both, and
 * so a consumer can supply any implementation — the global `fetch`,
 * `undici`, `node-fetch`, `cross-fetch` — as long as it accepts a URL string
 * and this init object.
 */
export interface FetchInit {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  signal?: AbortSignal | null;
}

/** The subset of a `fetch` response that this library uses. */
export interface FetchResponse {
  readonly ok: boolean;
  readonly status: number;
  readonly statusText?: string;
  text(): Promise<string>;
}

/**
 * A `fetch`-shaped function.
 *
 * The global `fetch` satisfies this structurally. Passing a custom one is how
 * you supply a TLS policy, a corporate proxy, request tracing, or a polyfill
 * on an old runtime.
 */
export type FetchLike = (url: string, init?: FetchInit) => Promise<FetchResponse>;

/** Resolves the fetch implementation: explicit, then global, else fail loudly. */
function resolveFetch(provided: FetchLike | undefined): FetchLike {
  if (provided !== undefined) return provided;

  const globalFetch = (globalThis as { fetch?: unknown }).fetch;
  if (typeof globalFetch === 'function') {
    return globalFetch as FetchLike;
  }

  throw new WardogsError(NO_FETCH_HINT);
}

/* -------------------------------------------------------------------------- */
/* URL construction                                                            */
/* -------------------------------------------------------------------------- */

/** Hosts that may legitimately be spoken to over plaintext HTTP. */
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]', '0:0:0:0:0:0:0:1']);

function isLoopbackHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  if (LOOPBACK_HOSTS.has(host)) return true;
  // 127.0.0.0/8 is loopback in its entirety.
  return /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host);
}

/**
 * Validates a base URL and returns it in normal form (no trailing slash).
 *
 * Plaintext `http://` is rejected unless the host is loopback. This is not
 * pedantry: a Wardogs server bound to the network refuses to start without a
 * TLS certificate, so a remote `http://` base URL can never work. Catching it
 * here turns a confusing connection error into a sentence that says what to
 * fix.
 *
 * @throws {WardogsError} when the URL is unusable.
 */
export function normalizeBaseUrl(
  baseUrl: string,
  options: { allowInsecureHttp?: boolean } = {},
): string {
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    throw new WardogsError(
      `Invalid baseUrl: ${JSON.stringify(baseUrl)}. Expected an absolute URL ` +
        'such as "https://my-server.example:7776".',
    );
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new WardogsError(
      `Unsupported baseUrl protocol ${JSON.stringify(url.protocol)}; expected ` +
        '"http:" or "https:".',
    );
  }

  if (url.protocol === 'http:' && !isLoopbackHost(url.hostname)) {
    if (options.allowInsecureHttp !== true) {
      throw new WardogsError(
        `Refusing plaintext http:// to non-loopback host ${JSON.stringify(url.hostname)}. ` +
          'A network-exposed Wardogs RCON listener requires TLS, so this connection ' +
          'cannot succeed — use https:// (the default RCON port is 7776). Pass ' +
          '`allowInsecureHttp: true` only if a plaintext proxy or tunnel sits in front.',
      );
    }
  }

  // Strip trailing slashes so joining a "/v1/..." path never doubles up.
  return url.origin + url.pathname.replace(/\/+$/, '');
}

/** Query values accepted by {@link buildUrl}. */
export type QueryValue = string | number | boolean | undefined | null;

/**
 * Joins a base URL, a path and query parameters into a request URL.
 *
 * `undefined` and `null` query values are omitted entirely, so callers can
 * pass optional parameters straight through without conditional spreads.
 */
export function buildUrl(
  baseUrl: string,
  path: string,
  query?: Record<string, QueryValue>,
): string {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  const url = new URL(baseUrl + normalizedPath);

  if (query !== undefined) {
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined || value === null) continue;
      url.searchParams.set(key, String(value));
    }
  }

  return url.toString();
}

/* -------------------------------------------------------------------------- */
/* Request                                                                     */
/* -------------------------------------------------------------------------- */

/** Header values or a (possibly async) producer of them. */
export type HeadersOption =
  Record<string, string> | (() => Record<string, string> | Promise<Record<string, string>>);

export interface RequestOptions {
  method: string;
  /** Normalized base URL, from {@link normalizeBaseUrl}. */
  baseUrl: string;
  /** Path below the base URL, e.g. `"/v1/status"`. */
  path: string;
  query?: Record<string, QueryValue>;
  /** Serialized request body. */
  body?: string;
  /** Value for `Content-Type`. Omitted for bodyless requests. */
  contentType?: string;
  /** Sent as `Authorization: Bearer <token>`. */
  token?: string;
  /** Extra headers, merged last so they can override the defaults. */
  headers?: HeadersOption;
  /** Caller cancellation. */
  signal?: AbortSignal;
  timeoutMs?: number;
  /** Retry attempts for idempotent requests that fail transiently. */
  retries?: number;
  fetch?: FetchLike;
  /** Decides which methods may be retried; defaults to GET-only. */
  isRetryable?: (method: string) => boolean;
}

export interface RequestResult {
  /** Decoded body, or `undefined` for a genuinely empty response. */
  data: unknown;
  /** Raw body text, before decoding. */
  text: string;
  status: number;
  headers?: unknown;
}

const DEFAULT_TIMEOUT_MS = 15_000;
const RETRY_BASE_DELAY_MS = 250;
const RETRY_MAX_DELAY_MS = 4_000;

/**
 * Retry policy: only methods that are safe to repeat.
 *
 * GET is retried; everything else is not. A retried `POST /v1/players/{id}/kick`
 * could kick twice, a retried `POST /v1/bans` could append a duplicate entry.
 * A transport-level failure does not tell you whether the server acted, so the
 * only safe default is to surface the error and let the caller decide.
 */
function defaultIsRetryable(method: string): boolean {
  return method.toUpperCase() === 'GET';
}

/** Sentinel used to tell a timeout apart from a caller-requested cancellation. */
const TIMEOUT_REASON = Symbol('wardogs.timeout');

function createTimeoutSignal(
  timeoutMs: number,
  external: AbortSignal | undefined,
): { signal: AbortSignal | undefined; clear: () => void } {
  const controller = new AbortController();

  if (external !== undefined && typeof AbortSignal.any === 'function') {
    // Node 20+ / modern browsers: combine cancellation sources natively.
    const combined = AbortSignal.any(
      timeoutMs > 0 ? [external, AbortSignal.timeout(timeoutMs)] : [external],
    );
    return { signal: combined, clear: () => {} };
  }

  let timer: ReturnType<typeof setTimeout> | undefined;
  const onExternalAbort = (): void => controller.abort(external?.reason);

  if (external !== undefined) {
    if (external.aborted) {
      controller.abort(external.reason);
    } else {
      external.addEventListener('abort', onExternalAbort, { once: true });
    }
  }

  if (timeoutMs > 0) {
    timer = setTimeout(() => controller.abort(TIMEOUT_REASON), timeoutMs);
  }

  return {
    signal: controller.signal,
    clear: () => {
      if (timer !== undefined) clearTimeout(timer);
      external?.removeEventListener('abort', onExternalAbort);
    },
  };
}

function isAbortNamed(error: unknown, names: readonly string[]): boolean {
  if (error === null || typeof error !== 'object') return false;
  const name = (error as { name?: unknown }).name;
  return typeof name === 'string' && names.includes(name);
}

/**
 * Unwraps the abort reason through the layers a fetch polyfill may add.
 *
 * `node-fetch` and some WinterCG shims nest the real cause one or two levels
 * deep, which is where the message worth reading usually lives.
 */
function abortRootCause(error: unknown): unknown {
  let current: unknown = error;
  for (let depth = 0; depth < 4 && current !== null && typeof current === 'object'; depth++) {
    const cause = (current as { cause?: unknown }).cause;
    if (cause === undefined) break;
    current = cause;
  }
  return current;
}

/**
 * Maps a thrown transport error onto this library's error vocabulary.
 *
 * The classification order matters. A caller cancellation is checked **before**
 * the timeout, because a caller may legitimately abort with a `TimeoutError` of
 * their own — and more simply, because the caller's own signal being aborted is
 * direct evidence, while the error's name is only a hint. Getting this backwards
 * reports a deliberate cancellation as a configuration problem.
 */
function toTransportError(
  error: unknown,
  options: {
    method: string;
    url: string;
    timeoutMs: number;
    timedOut: boolean;
    externalSignal: AbortSignal | undefined;
  },
): WardogsError {
  const { method, url, timeoutMs, timedOut, externalSignal } = options;
  const abortedByCaller = externalSignal?.aborted === true;

  if (!abortedByCaller && timedOut) {
    return new WardogsTimeoutError(`${method} ${url} timed out after ${timeoutMs}ms.`, {
      timeoutMs,
      method,
      url,
      cause: error,
    });
  }

  if (abortedByCaller) {
    return new WardogsAbortError(`${method} ${url} was cancelled.`, {
      method,
      url,
      cause: error,
    });
  }

  // `AbortSignal.timeout()` rejects with a DOMException named `TimeoutError`
  // even though it is not a caller cancellation, so this comes last.
  if (isAbortNamed(error, ['TimeoutError'])) {
    return new WardogsTimeoutError(`${method} ${url} timed out after ${timeoutMs}ms.`, {
      timeoutMs,
      method,
      url,
      cause: error,
    });
  }

  if (isAbortNamed(error, ['AbortError'])) {
    return new WardogsAbortError(`${method} ${url} was cancelled.`, {
      method,
      url,
      cause: error,
    });
  }

  return new WardogsNetworkError(
    `${method} ${url} failed before a response was received: ${describeError(error)}`,
    { method, url, cause: error },
  );
}

function describeError(error: unknown): string {
  if (error instanceof Error) {
    const root = abortRootCause(error);
    if (root !== error && root instanceof Error) {
      return `${error.message} (${root.message})`;
    }
    return error.message;
  }
  return String(error);
}

/** Parses the documented error envelope, tolerating anything else. */
function describeHttpFailure(
  status: number,
  statusText: string | undefined,
  data: unknown,
  raw: string,
): { code: string; message: string } {
  if (data !== null && typeof data === 'object') {
    const nested = (data as { error?: unknown }).error;
    if (nested !== null && typeof nested === 'object') {
      const code = (nested as { code?: unknown }).code;
      const message = (nested as { message?: unknown }).message;
      if (typeof code === 'string' || typeof message === 'string') {
        return {
          code: typeof code === 'string' ? code : `http_${status}`,
          message: typeof message === 'string' ? message : (statusText ?? `HTTP ${status}`),
        };
      }
    }
    // A JSON body that is not the documented envelope — some proxies do this.
    const fallbackMessage = (data as { message?: unknown }).message;
    if (typeof fallbackMessage === 'string') {
      return { code: `http_${status}`, message: fallbackMessage };
    }
  }

  // Not JSON at all. An HTML error page from a gateway still has a first line
  // worth reading, and passing it through beats reporting only a status code.
  const snippet = firstMeaningfulLine(raw);
  if (snippet !== undefined) {
    return { code: `http_${status}`, message: snippet };
  }

  return {
    code: `http_${status}`,
    message: statusText !== undefined && statusText !== '' ? statusText : `HTTP ${status}`,
  };
}

/** Strips HTML tags to find a readable line inside a gateway error page. */
function firstMeaningfulLine(raw: string): string | undefined {
  const text = raw.includes('<') ? raw.replace(/<[^>]*>/g, ' ') : raw;
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed !== '') return trimmed.slice(0, 300);
  }
  return undefined;
}

async function resolveHeaders(headers: HeadersOption | undefined): Promise<Record<string, string>> {
  if (headers === undefined) return {};
  const resolved = typeof headers === 'function' ? await headers() : headers;
  return { ...resolved };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * Executes one request and decodes the response.
 *
 * Retries cover transport failures, timeouts and retryable HTTP statuses, but
 * only for methods {@link RequestOptions.isRetryable} approves — GET by
 * default. Delays use exponential backoff with jitter so a fleet of pollers
 * recovering from a restart does not resynchronize into a thundering herd.
 *
 * @throws {WardogsTimeoutError} on timeout.
 * @throws {WardogsAbortError} when the caller's signal aborts.
 * @throws {WardogsNetworkError} when no response arrives.
 * @throws {WardogsHttpError} on a non-2xx status.
 * @throws {WardogsParseError} when a claimed-JSON body does not parse.
 */
export async function request(options: RequestOptions): Promise<RequestResult> {
  const {
    method,
    baseUrl,
    path,
    query,
    body,
    contentType,
    token,
    headers,
    signal: externalSignal,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    retries = 0,
    fetch: providedFetch,
  } = options;

  const fetchImpl = resolveFetch(providedFetch);
  const url = buildUrl(baseUrl, path, query);
  const upperMethod = method.toUpperCase();
  const mayRetry = retries > 0 && (options.isRetryable ?? defaultIsRetryable)(upperMethod);

  const baseHeaders = await resolveHeaders(headers);
  const requestHeaders: Record<string, string> = {
    Accept: 'application/json',
    ...baseHeaders,
  };
  if (token !== undefined) {
    requestHeaders['Authorization'] = `Bearer ${token}`;
  }
  if (contentType !== undefined) {
    requestHeaders['Content-Type'] = contentType;
  }

  const maxAttempts = mayRetry ? retries + 1 : 1;
  let lastError: WardogsError | undefined;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (attempt > 0) {
      const ceiling = Math.min(RETRY_BASE_DELAY_MS * 2 ** (attempt - 1), RETRY_MAX_DELAY_MS);
      // Jitter at 50–100% of the ceiling.
      await sleep(Math.round(ceiling * (0.5 + Math.random() * 0.5)));
    }

    const { signal, clear } = createTimeoutSignal(timeoutMs, externalSignal);
    let timedOut = false;
    const noticeTimeout = (): void => {
      timedOut = true;
    };
    signal?.addEventListener('abort', noticeTimeout, { once: true });

    try {
      const response = await fetchImpl(url, {
        method: upperMethod,
        headers: requestHeaders,
        ...(body !== undefined ? { body } : {}),
        ...(signal !== undefined ? { signal } : {}),
      });

      const text = await response.text();

      if (!response.ok) {
        // Decode leniently here. A 5xx from a reverse proxy is HTML, not the
        // documented JSON envelope, and failing to parse it would replace a
        // clear "HTTP 502" with a confusing "not valid JSON" — hiding the one
        // detail that identifies the problem. The strict decoder is for success
        // responses, where a JSON body is contractually guaranteed.
        const body = decodeLeniently(text);
        const { code, message } = describeHttpFailure(
          response.status,
          response.statusText,
          body,
          text,
        );
        const error = new WardogsHttpError(
          `${upperMethod} ${url} failed: HTTP ${response.status} — ${message}`,
          {
            status: response.status,
            code,
            body,
            method: upperMethod,
            url,
            statusText: response.statusText,
          },
        );

        if (mayRetry && error.isRetryable) {
          lastError = error;
          continue;
        }
        throw error;
      }

      return { data: decodeBody(text, url, upperMethod), text, status: response.status };
    } catch (error) {
      clear();

      if (error instanceof WardogsError && !(error instanceof WardogsTimeoutError)) {
        // Already mapped, and not something retrying would fix (an HTTP status
        // we chose to surface, a parse failure, or a caller cancellation).
        throw error;
      }

      const mapped = toTransportError(error, {
        method: upperMethod,
        url,
        timeoutMs,
        timedOut,
        externalSignal,
      });

      if (!mayRetry) throw mapped;
      lastError = mapped;
    } finally {
      clear();
    }
  }

  throw (
    lastError ??
    new WardogsNetworkError(`${upperMethod} ${url} failed with no attempts made.`, {
      method: upperMethod,
      url,
    })
  );
}

/**
 * Decodes a response body, requiring valid JSON.
 *
 * An empty body is `undefined`, not an error: a 204, or a proxy that strips a
 * bodyless response, both land here. A non-empty body that fails to parse
 * throws rather than silently returning a string, because every caller of this
 * function requested the JSON channel and a string here would flow onward as a
 * wrong-but-plausible value.
 */
function decodeBody(text: string, url: string, method: string): unknown {
  const trimmed = text.trim();
  if (trimmed === '') return undefined;
  try {
    return JSON.parse(trimmed) as unknown;
  } catch (error) {
    throw new WardogsParseError(`${method} ${url} returned a body that is not valid JSON.`, {
      body: text,
      method,
      url,
      cause: error,
    });
  }
}

/**
 * Decodes a response body without requiring JSON.
 *
 * Used for error responses, where the body is diagnostic rather than
 * contractual — an HTML gateway page should still yield a usable error object.
 */
function decodeLeniently(text: string): unknown {
  const trimmed = text.trim();
  if (trimmed === '') return undefined;
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return trimmed;
  }
}
