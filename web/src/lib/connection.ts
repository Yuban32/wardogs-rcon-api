/**
 * Connection settings, and turning them into a client.
 *
 * Two things here are deliberate and worth not "simplifying" later:
 *
 * 1. **The token is never persisted.** It is a full-access admin password with
 *    no read-only variant — it can kick, ban, replace the config and end a
 *    match. Writing it to `localStorage` would put it in reach of any script on
 *    this origin, and of anything that later reads the profile. Proxy mode,
 *    which is the default, needs no token in the browser at all.
 * 2. **Plaintext HTTP is permitted only for loopback.** The library refuses
 *    `http://` to a remote host outright, and the escape hatch it offers exists
 *    for the case where a plaintext tunnel terminates in front of the server.
 *    This panel is not that case, so it opts in only where the check would have
 *    passed anyway.
 */

import { createClient, createProxyFetch, type FetchLike, type WardogsClient } from '@wardogs/api';

export type TransportMode = 'proxy' | 'direct';

export interface ConnectionSettings {
  /** The RCON listener, e.g. `http://127.0.0.1:7777`. */
  baseUrl: string;
  /** Proxy keeps the token on a backend; direct calls the server from the page. */
  mode: TransportMode;
  /** Same-origin endpoint that forwards, in proxy mode. */
  proxyEndpoint: string;
}

export const DEFAULT_SETTINGS: ConnectionSettings = {
  baseUrl: 'http://127.0.0.1:7777',
  mode: 'proxy',
  proxyEndpoint: '/rcon-proxy',
};

/**
 * What the client sends when no token was typed in proxy mode.
 *
 * `createClient` requires a non-empty token and always emits an
 * `Authorization` header from it — there is no "no credential" state. The
 * transport below deletes that header again before it reaches the proxy, so
 * this value never leaves the page. It exists to satisfy the constructor, not
 * to authenticate anything.
 */
export const PROXY_PLACEHOLDER_TOKEN = 'held-by-the-proxy';

const STORAGE_KEY = 'wardogs-panel:connection:v1';

/** The slice of `localStorage` this module uses, so tests can supply their own. */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function browserStorage(): StorageLike | null {
  try {
    return (globalThis as { localStorage?: StorageLike }).localStorage ?? null;
  } catch {
    // Reading `localStorage` throws outright when a browser has storage
    // disabled. A local tool still has to load in that configuration.
    return null;
  }
}

/**
 * Validates anything that came back from storage.
 *
 * Exported because it is the only interesting part of loading, and because the
 * stored blob is just as untrusted as any other input — it is writable by any
 * script on this origin, and by hand.
 */
export function normalizeSettings(value: unknown): ConnectionSettings {
  if (value === null || typeof value !== 'object') return { ...DEFAULT_SETTINGS };
  const candidate = value as Record<string, unknown>;

  const baseUrl =
    typeof candidate['baseUrl'] === 'string' && candidate['baseUrl'].trim() !== ''
      ? candidate['baseUrl'].trim()
      : DEFAULT_SETTINGS.baseUrl;

  // Anything that is not exactly 'direct' falls back to the safer transport.
  const mode: TransportMode = candidate['mode'] === 'direct' ? 'direct' : 'proxy';

  const proxyEndpoint =
    typeof candidate['proxyEndpoint'] === 'string' && candidate['proxyEndpoint'].trim() !== ''
      ? candidate['proxyEndpoint'].trim()
      : DEFAULT_SETTINGS.proxyEndpoint;

  return { baseUrl, mode, proxyEndpoint };
}

export function loadSettings(storage: StorageLike | null = browserStorage()): ConnectionSettings {
  if (storage === null) return { ...DEFAULT_SETTINGS };
  try {
    const raw = storage.getItem(STORAGE_KEY);
    return raw === null ? { ...DEFAULT_SETTINGS } : normalizeSettings(JSON.parse(raw));
  } catch {
    // A corrupt entry is not worth an error dialog; the defaults are usable.
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(
  settings: ConnectionSettings,
  storage: StorageLike | null = browserStorage(),
): void {
  if (storage === null) return;
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Quota, or storage disabled mid-session. The panel works without it.
  }
}

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

/** Mirrors the library's own rule: loopback is the one case plaintext is real. */
export function isLoopback(baseUrl: string): boolean {
  try {
    const host = new URL(baseUrl).hostname.toLowerCase();
    return LOOPBACK_HOSTS.has(host) || /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host);
  } catch {
    return false;
  }
}

/**
 * Plaintext, and not loopback — the combination the library refuses by default.
 *
 * Exported because the panel says different things about it depending on the
 * transport, and both of them are about what the *proxy* will have to allow.
 */
export function isPlaintextRemote(baseUrl: string): boolean {
  try {
    return new URL(baseUrl).protocol === 'http:' && !isLoopback(baseUrl);
  } catch {
    return false;
  }
}

/**
 * The origin of a base URL, which is what a proxy allow-lists.
 *
 * A proxy compares origins, never string prefixes — `startsWith('https://my-
 * server')` is satisfied by `https://my-server.attacker.example`. Showing the
 * origin is how the panel avoids teaching the wrong habit.
 */
export function originOf(baseUrl: string): string {
  try {
    return new URL(baseUrl).origin;
  } catch {
    return baseUrl;
  }
}

/** Drops any `Authorization` header, whatever its casing. */
function withoutAuthorization(headers: Record<string, string>): Record<string, string> {
  const next: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() !== 'authorization') next[key] = value;
  }
  return next;
}

/**
 * The proxy transport.
 *
 * The client emits an `Authorization` header on every request, built from
 * whatever token it was constructed with. In proxy mode that header is either
 * the placeholder or a token the user typed — and it has to be removed before
 * the request leaves, because the proxy adapter passes unknown headers through.
 * Forwarding the placeholder would replace a working credential with a broken
 * one; the example proxy only injects its own token when it was given one, and
 * otherwise forwards whatever the browser sent.
 *
 * So: strip it here, and let the adapter attach the real one when there is one.
 */
function createProxyTransport(endpoint: string, token: string): FetchLike {
  const typed = token.trim();
  const inner = createProxyFetch({
    endpoint,
    ...(typed !== '' ? { token: typed } : {}),
  });

  return (url, init) =>
    inner(url, {
      ...init,
      headers: withoutAuthorization(init?.headers ?? {}),
    });
}

/** Per-connection switches that are deliberately not persisted. See below. */
export interface ConnectOptions {
  /**
   * Direct mode only: override the library's refusal of plaintext to a remote
   * host.
   *
   * Not part of {@link ConnectionSettings}, and so not stored — it lifts a
   * safety check, and anything that lifts a safety check starts off, every time
   * the page loads. The read-only switch works the same way, and the token is
   * not stored for the same class of reason.
   */
  allowPlaintext?: boolean;
}

/**
 * Builds a client, or throws the library's own configuration error.
 *
 * `createClient` validates at construction rather than at the first request, so
 * a typo in the base URL surfaces here — which is where the panel shows it,
 * next to the field that caused it.
 */
export function createConnectedClient(
  settings: ConnectionSettings,
  token: string,
  options: ConnectOptions = {},
): WardogsClient {
  const transport: FetchLike | undefined =
    settings.mode === 'proxy' ? createProxyTransport(settings.proxyEndpoint, token) : undefined;

  return createClient({
    baseUrl: settings.baseUrl,
    // In proxy mode the browser holds no credential of its own, so the client
    // gets this placeholder — which the transport above removes again.
    token: settings.mode === 'proxy' ? PROXY_PLACEHOLDER_TOKEN : token,
    /*
     * The plaintext guard, and who gets to overrule it.
     *
     * `createClient` refuses `http://` to a non-loopback host, on the grounds
     * that a network-exposed listener cannot start without TLS, so the
     * connection could never succeed. That reasoning holds when this client is
     * the one connecting — and in proxy mode it is not. The browser talks to
     * the proxy endpoint; `baseUrl` only travels as a header describing the
     * request the backend should make.
     *
     * The check then belongs at the backend, which is the only party that knows
     * whether a plaintext tunnel terminates in front of the game server. The
     * example proxy already makes it, with a better message and its own gate
     * (origin allow-list, plus WARDOGS_ALLOW_INSECURE for a remote plaintext
     * target). Blocking here would make that unreachable.
     *
     * In direct mode the page really is the client, so the guard stands by
     * default — but `allowPlaintext` lifts it, because only the operator knows
     * whether their server terminates TLS elsewhere. That is the same escape
     * hatch the library documents; the panel surfaces it rather than deciding.
     */
    allowInsecureHttp:
      settings.mode === 'proxy' || isLoopback(settings.baseUrl) || options.allowPlaintext === true,
    timeoutMs: 15_000,
    ...(transport !== undefined ? { fetch: transport } : {}),
  });
}
