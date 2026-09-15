/**
 * What every panel shares: the connected client, its capability probe, the
 * read-only guard, and the request log.
 *
 * `call()` is the single funnel. Every request the panel makes goes through it,
 * which is what makes the log complete — and what makes the timing, the status
 * decoding and the error capture consistent instead of re-implemented per
 * panel.
 */

import { createContext, useContext } from 'react';

import { WardogsHttpError, type CapabilitiesProbe, type WardogsClient } from '@wardogs/api';

import { byteLength, describeError, formatClock, stringify } from './format';

export interface LogEntry {
  id: number;
  at: number;
  method: string;
  path: string;
  /** Human label: a route id, or what the panel was doing. */
  label: string;
  outcome: 'ok' | 'error';
  /** HTTP status. `0` when no response arrived at all. */
  status: number;
  durationMs: number;
  bytes: number;
  /** The error's headline, for the log line. The error itself is kept too. */
  summary?: string;
  error?: unknown;
}

export interface CallInfo {
  method: string;
  path: string;
  label?: string;
}

export interface Session {
  client: WardogsClient;
  caps: CapabilitiesProbe;
  /** When true — the default — mutating routes are refused in the UI. */
  readOnly: boolean;
  log: readonly LogEntry[];
  /** Runs a client call, timing and logging it, then rethrows on failure. */
  call<T>(info: CallInfo, run: (client: WardogsClient) => Promise<T>): Promise<T>;
  clearLog(): void;
}

export const SessionContext = createContext<Session | null>(null);

export function useSession(): Session {
  const session = useContext(SessionContext);
  if (session === null) {
    throw new Error('useSession() was called outside the panel session provider.');
  }
  return session;
}

/**
 * The status a successful call carries.
 *
 * Every documented success response in this API is `200`, and anything else
 * arrives as a thrown `WardogsHttpError` carrying the real status — so a
 * resolved promise means 200 without the panel having to tap the transport.
 */
export const SUCCESS_STATUS = 200;

export function entryFromError(info: CallInfo, error: unknown, durationMs: number): LogEntry {
  const view = describeError(error);
  return {
    id: 0, // assigned by the log
    at: Date.now(),
    method: info.method,
    path: info.path,
    label: info.label ?? `${info.method} ${info.path}`,
    outcome: 'error',
    status: error instanceof WardogsHttpError ? error.status : 0,
    durationMs,
    bytes: 0,
    summary: view.title,
    error,
  };
}

export function entryFromSuccess(info: CallInfo, data: unknown, durationMs: number): LogEntry {
  return {
    id: 0,
    at: Date.now(),
    method: info.method,
    path: info.path,
    label: info.label ?? `${info.method} ${info.path}`,
    outcome: 'ok',
    status: SUCCESS_STATUS,
    durationMs,
    // The size of what the panel is about to render. Not the wire length —
    // the response has already been parsed and discarded by this point — but
    // for "is this payload unexpectedly large" it answers the same question.
    bytes: byteLength(stringify(data)),
  };
}

/** One line for the log list. */
export function describeEntry(entry: LogEntry): string {
  const when = formatClock(entry.at);
  const status = entry.outcome === 'ok' ? String(entry.status) : (entry.summary ?? 'failed');
  return `${when}  ${entry.method.padEnd(6)} ${entry.path}  ${status}`;
}
