/**
 * The error hierarchy thrown by this library.
 *
 * Names are prefixed with `Wardogs` deliberately: a library that exports
 * `ApiError` or `TimeoutError` collides with the built-in `Error`, with DOM
 * globals, and with half the ecosystem. The prefix makes `instanceof` checks
 * unambiguous at a glance in a consumer's catch block.
 *
 * Every error carries the offending request's method and URL so a failure in
 * an async pipeline is diagnosable without extra logging. `cause` is populated
 * wherever there is an underlying error to preserve.
 */

/** Base class for everything this library throws. */
export class WardogsError extends Error {
  /**
   * The underlying error, when there was one.
   *
   * Declared rather than assigned because `useDefineForClassFields` (the ES2022
   * class-field semantics this target emits) would otherwise initialize it to
   * `undefined` on every construction, overwriting the prototype-level `cause`
   * that `Error` provides.
   */
  declare readonly cause?: unknown;

  /** The request method, e.g. `"GET"`, when the error came from a request. */
  readonly method?: string;
  /** The full request URL, when the error came from a request. */
  readonly url?: string;

  constructor(message: string, options: { method?: string; url?: string; cause?: unknown } = {}) {
    super(message);
    this.name = 'WardogsError';
    this.method = options.method;
    this.url = options.url;

    if (options.cause !== undefined) {
      Object.defineProperty(this, 'cause', {
        value: options.cause,
        enumerable: false,
        writable: true,
        configurable: true,
      });
    }

    // Preserve the prototype chain when the output is transpiled to ES5-style
    // constructor functions (some bundler configs still do this for UMD).
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** Narrowing helper that survives multiple copies of this module in a bundle. */
export function isWardogsError(value: unknown): value is WardogsError {
  return value instanceof WardogsError;
}

/**
 * The server answered with a non-2xx status.
 *
 * `code` comes from the response body's `error.code`. The API documents the
 * envelope but publishes no enumeration of codes, so it stays a `string` here
 * rather than a guess that would go stale. When the body is missing or not
 * the documented envelope, `code` falls back to `"http_<status>"` and
 * `message` to the HTTP status text — so a proxy's HTML error page still
 * produces a usable error object.
 */
export class WardogsHttpError extends WardogsError {
  /** HTTP status code. */
  readonly status: number;
  /** `error.code` from the body, or `"http_<status>"` when unavailable. */
  readonly code: string;
  /** The parsed response body, whatever it turned out to be. */
  readonly body: unknown;
  /** The HTTP status text, when the runtime provided one. */
  readonly statusText?: string;

  constructor(
    message: string,
    options: {
      status: number;
      code: string;
      body: unknown;
      method?: string;
      url?: string;
      statusText?: string;
      cause?: unknown;
    },
  ) {
    super(message, options);
    this.name = 'WardogsHttpError';
    this.status = options.status;
    this.code = options.code;
    this.body = options.body;
    this.statusText = options.statusText;
  }

  /**
   * Whether this is a config-document revision conflict (HTTP 412).
   *
   * The reference documents this specifically for `PUT /v1/config`: re-read
   * the document, re-apply your change to the fresh text, and retry.
   */
  get isRevisionConflict(): boolean {
    return this.status === 412;
  }

  /** Whether the failure is likely transient and worth retrying. */
  get isRetryable(): boolean {
    return this.status >= 500 || this.status === 429;
  }

  /** Whether the credentials were rejected (HTTP 401 / 403). */
  get isAuthError(): boolean {
    return this.status === 401 || this.status === 403;
  }
}

/** The request exceeded `timeoutMs` before the server answered. */
export class WardogsTimeoutError extends WardogsError {
  /** The configured timeout, in milliseconds. */
  readonly timeoutMs: number;

  constructor(
    message: string,
    options: {
      timeoutMs: number;
      method?: string;
      url?: string;
      cause?: unknown;
    },
  ) {
    super(message, options);
    this.name = 'WardogsTimeoutError';
    this.timeoutMs = options.timeoutMs;
  }
}

/**
 * The request never produced an HTTP response — DNS failure, connection
 * refused, TLS handshake failure, or a dropped socket.
 *
 * A TLS failure on a self-signed certificate surfaces here. This library
 * cannot accept an untrusted certificate on your behalf; see the
 * `TLS_CERTIFICATE_HINT` constant for how to supply your own fetch with a
 * custom dispatcher.
 */
export class WardogsNetworkError extends WardogsError {
  constructor(message: string, options: { method?: string; url?: string; cause?: unknown } = {}) {
    super(message, options);
    this.name = 'WardogsNetworkError';
  }
}

/** A response body could not be decoded as the content type it claimed. */
export class WardogsParseError extends WardogsError {
  /** The raw response body that failed to parse. */
  readonly body: string;

  constructor(
    message: string,
    options: {
      body: string;
      method?: string;
      url?: string;
      cause?: unknown;
    },
  ) {
    super(message, options);
    this.name = 'WardogsParseError';
    this.body = options.body;
  }
}

/**
 * The request was cancelled by a caller-supplied `AbortSignal`.
 *
 * Distinct from {@link WardogsTimeoutError} so cancellation and slowness do
 * not look alike in logs or in retry logic.
 */
export class WardogsAbortError extends WardogsError {
  constructor(message: string, options: { method?: string; url?: string; cause?: unknown } = {}) {
    super(message, options);
    this.name = 'WardogsAbortError';
  }
}

/* -------------------------------------------------------------------------- */
/* Diagnostics                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * How to reach a Wardogs server that presents a certificate your runtime does
 * not trust (commonly a self-signed one on a dedicated box).
 *
 * There is no option in this library to skip certificate verification — that
 * would be a footgun shipped as a convenience. Instead, pass a `fetch` that
 * carries your own policy:
 *
 * ```ts
 * import { Agent, fetch } from 'undici';
 * import { createClient } from '@yuban32/wardogs-rcon-api';
 *
 * const client = createClient({
 *   baseUrl: 'https://my-server:7776',
 *   token: process.env.WARDOGS_TOKEN!,
 *   fetch: (input, init) =>
 *     fetch(input, { ...init, dispatcher: new Agent({ connect: { ca: myCaPem } }) }),
 * });
 * ```
 *
 * `ca` pins your own certificate. Reaching for `rejectUnauthorized: false` is
 * possible but disables the protection TLS exists to provide, on a connection
 * that carries a full-access admin password.
 */
export const TLS_CERTIFICATE_HINT =
  'TLS verification failed. This library does not disable certificate checking. ' +
  'Pass your own `fetch` with a custom dispatcher/agent trusting your CA. ' +
  'Node: `undici.Agent({ connect: { ca } })`. See docs/adapters.md.';

/**
 * Guidance attached to the error raised when no `fetch` implementation can be
 * found, which in practice means a Node runtime older than 18.
 */
export const NO_FETCH_HINT =
  'No global `fetch` is available in this runtime (Node < 18, or a stripped ' +
  'environment). Upgrade to Node 18+, or pass an implementation explicitly: ' +
  '`createClient({ fetch: myFetch })`.';
