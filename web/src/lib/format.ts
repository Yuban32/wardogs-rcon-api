/**
 * Presentation helpers: sizes, durations, and turning an error into something
 * worth reading.
 *
 * The error mapping is the part that earns its place. This library throws a
 * typed hierarchy, and a panel that rendered `String(error)` would throw that
 * away — a 412 (stale config revision, recoverable) would look exactly like a
 * 401 (wrong password, not recoverable) and like a refused connection.
 */

import {
  WardogsAbortError,
  WardogsError,
  WardogsHttpError,
  WardogsNetworkError,
  WardogsParseError,
  WardogsTimeoutError,
  isWardogsError,
} from '@wardogs/api';

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} kB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export function formatDuration(ms: number): string {
  return ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(2)} s`;
}

/** Pretty JSON, falling back rather than throwing on anything unserializable. */
export function stringify(value: unknown): string {
  if (value === undefined) return '(no content)';
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

/** Byte count of what the panel is about to display. */
export function byteLength(text: string): number {
  return new TextEncoder().encode(text).length;
}

export function formatClock(at: number): string {
  return new Date(at).toLocaleTimeString(undefined, { hour12: false });
}

export interface ErrorView {
  /** Short headline, e.g. `HTTP 412 · revision_mismatch`. */
  title: string;
  /** The server's own message, when there is one. */
  detail?: string;
  /** What to do about it. */
  hint?: string;
  status?: number;
  code?: string;
}

/**
 * Turns anything thrown into a headline, a detail and a next step.
 *
 * The order of the checks matters: `WardogsHttpError` before the transport
 * errors, because a failed request that reached the server is a different
 * problem from one that never arrived, and only the first one has a status
 * code to show.
 */
export function describeError(error: unknown): ErrorView {
  if (error instanceof WardogsHttpError) {
    const view: ErrorView = {
      title: `HTTP ${error.status} · ${error.code}`,
      detail: error.message,
      status: error.status,
      code: error.code,
    };

    if (error.isRevisionConflict) {
      view.hint =
        'The document changed since you read it. Re-read the config, re-apply your change, then send again.';
    } else if (error.isAuthError) {
      view.hint = 'The token was rejected. Check the token, or let the proxy inject it instead.';
    } else if (error.isRetryable) {
      view.hint = 'A failing GET is retried automatically; this one exhausted its budget.';
    }
    return view;
  }

  if (error instanceof WardogsTimeoutError) {
    return {
      title: 'Timed out',
      detail: error.message,
      hint: 'The server accepted the connection and then went quiet.',
    };
  }

  if (error instanceof WardogsAbortError) {
    return { title: 'Cancelled', detail: error.message, hint: 'The request was aborted.' };
  }

  if (error instanceof WardogsNetworkError) {
    return {
      title: 'No response',
      detail: error.message,
      hint: 'Nothing answered. Check the base URL, the port — the RCON listener defaults to 7776 — and that the server is running.',
    };
  }

  if (error instanceof WardogsParseError) {
    return {
      title: 'Unparseable response',
      detail: error.message,
      hint: 'A 2xx promised JSON. Something between here and the server is rewriting the body.',
    };
  }

  if (error instanceof WardogsError) {
    return { title: error.name, detail: error.message };
  }

  // Everything below never reached the library's error mapping, which in a
  // browser almost always means the request was blocked before it was sent.
  // A bare `TypeError: Failed to fetch` with an empty response is the signature
  // of exactly that, and saying so beats showing the TypeError.
  if (error instanceof TypeError) {
    return {
      title: 'The browser blocked the request',
      detail: error.message,
      hint: 'No response reached the page. That is normally missing CORS headers on the server, or a plaintext http:// listener called from an https:// page. Use the proxy transport.',
    };
  }

  return {
    title: isWardogsError(error) ? error.name : 'Unexpected failure',
    detail: error instanceof Error ? error.message : String(error),
  };
}
