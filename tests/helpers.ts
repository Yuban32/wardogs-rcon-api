/**
 * A recording fetch double.
 *
 * The library routes every request through a single `FetchLike` seam, so
 * capturing what it actually sends is a matter of handing it one of these.
 * That covers all 42 operations without a network, and lets the assertions be
 * about the exact wire format — method, URL, headers, body — rather than about
 * an endpoint's return value.
 */

import type { FetchInit, FetchLike, FetchResponse } from '../src/core/http.js';

export interface RecordedRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string | undefined;
}

/** A programmatic response, or an error to throw, or a request that never settles. */
export type FetchStep =
  | {
      status?: number;
      body?: unknown;
      statusText?: string;
      /** Send this text verbatim instead of serializing `body`. */
      raw?: string;
    }
  | { throws: unknown }
  | { hang: true };

export interface RecordingFetch {
  fetch: FetchLike;
  requests: RecordedRequest[];
  /** Number of requests recorded so far. */
  readonly count: number;
  /** The most recent request. Throws when nothing has been sent. */
  last(): RecordedRequest;
  /** The `n`th request, 0-based, for asserting on a retry sequence. */
  at(index: number): RecordedRequest;
  /** Replace the queued responses. Clears nothing else. */
  setResponses(steps: FetchStep[]): void;
  /** Queue one more response. */
  pushResponse(step: FetchStep): void;
  reset(): void;
}

function toResponse(step: FetchStep): FetchResponse {
  if ('throws' in step) throw step.throws;

  const status = 'status' in step && step.status !== undefined ? step.status : 200;
  const statusText = 'statusText' in step ? (step.statusText ?? '') : '';

  const text =
    'raw' in step && step.raw !== undefined
      ? step.raw
      : 'body' in step && step.body !== undefined
        ? JSON.stringify(step.body)
        : '';

  return {
    ok: status >= 200 && status < 300,
    status,
    statusText,
    text: () => Promise.resolve(text),
  };
}

/**
 * Builds a fetch that records every request and replies from a queue.
 *
 * When the queue runs dry the last response repeats, so a test that polls in a
 * loop does not need to enumerate every tick.
 */
export function createRecordingFetch(initial: FetchStep[] = []): RecordingFetch {
  const requests: RecordedRequest[] = [];
  let responses = [...initial];

  const fetch: FetchLike = (url, init?: FetchInit) => {
    requests.push({
      url,
      method: (init?.method ?? 'GET').toUpperCase(),
      headers: { ...(init?.headers ?? {}) },
      body: init?.body,
    });

    const index = Math.min(requests.length - 1, responses.length - 1);
    const step = responses[index];
    if (step === undefined) {
      return Promise.reject(
        new Error(
          `createRecordingFetch: no response queued for request #${requests.length} (${init?.method ?? 'GET'} ${url})`,
        ),
      );
    }

    if ('hang' in step) {
      // Never settles unless the caller's signal aborts — the shape a real
      // fetch has when it is waiting on a dead server.
      return new Promise<FetchResponse>((_resolve, reject) => {
        init?.signal?.addEventListener(
          'abort',
          () => {
            const error = new Error('The operation was aborted.');
            error.name = 'AbortError';
            reject(error);
          },
          { once: true },
        );
      });
    }

    return Promise.resolve().then(() => toResponse(step));
  };

  return {
    fetch,
    requests,
    get count() {
      return requests.length;
    },
    last() {
      const request = requests[requests.length - 1];
      if (request === undefined) throw new Error('No request was recorded.');
      return request;
    },
    at(index) {
      const request = requests[index];
      if (request === undefined) {
        throw new Error(`No request at index ${index} (recorded ${requests.length}).`);
      }
      return request;
    },
    setResponses(steps) {
      responses = [...steps];
    },
    pushResponse(step) {
      responses.push(step);
    },
    reset() {
      requests.length = 0;
      responses = [];
    },
  };
}

/** Parsed view of a recorded request, for readable assertions. */
export function parseRequest(request: RecordedRequest): {
  url: URL;
  path: string;
  query: Record<string, string>;
  body: unknown;
} {
  const url = new URL(request.url);
  const query: Record<string, string> = {};
  for (const [key, value] of url.searchParams) query[key] = value;

  let body: unknown;
  if (request.body !== undefined) {
    try {
      body = JSON.parse(request.body) as unknown;
    } catch {
      body = request.body;
    }
  }

  return { url, path: url.pathname, query, body };
}

/** A minimal valid `Status` payload, for responses that need one. */
export function statusPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    serverName: 'Test Server',
    map: 'Kavkazi',
    experiences: ['Bakurani_KOTH_01'],
    lighting: 'DayClear',
    alternator: 'ZoneAlternator.Factory.Circle',
    scoreTick: { current: 12, min: 18, max: 30 },
    scoreCap: 500,
    matchSeconds: 613,
    players: { current: 3, max: 128 },
    factionScores: [
      { name: 'NATO', colorHex: '#3b82f6' },
      { name: 'RUS', colorHex: '#ef4444' },
    ],
    rotation: { nowIndex: 0, nextIndex: 1 },
    ...overrides,
  };
}

/** A minimal valid `Player` payload. */
export function playerPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    name: 'Recruit',
    steamId: '76561198000000001',
    faction: 'NATO',
    kills: 4,
    deaths: 2,
    cash: 1500,
    pingMs: 32,
    ...overrides,
  };
}

/**
 * One chat line for `GET /v1/chat` responses, transcribed from the live probe
 * of build `++Wardogs+Live-CL-533689`. Every value is synthetic — the chat
 * terms forbid storing or resharing real players' chat, so fixtures never
 * carry captured text.
 */
export function chatMessagePayload(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    seq: 101,
    sentUtc: '2026-11-20T12:00:00.000Z',
    channel: 'Team',
    faction: 'NATO',
    steamId: '76561198000000001',
    realName: 'Recruit',
    hiddenName: 'Maple',
    anonymous: false,
    text: 'moving to B',
    rawText: 'moving to B',
    ping: false,
    ...overrides,
  };
}

/** The `GET /v1/chat` envelope. */
export function chatPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const messages = (overrides.messages as unknown[]) ?? [chatMessagePayload()];
  return {
    latestSeq: 101,
    messages,
    count: messages.length,
    ...overrides,
  };
}

/** The `GET /v1/chat/terms` consent document. The text is synthetic. */
export function chatTermsPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    requiredVersion: 1,
    acceptedVersion: 1,
    accepted: true,
    text: 'Synthetic terms text for tests only.',
    ...overrides,
  };
}

/** The `GET /v1/feed` outbound-delivery status. The host is deliberately fake. */
export function feedStatusPayload(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    enabled: true,
    endpointCount: 1,
    anyUnhealthy: false,
    pausedForTerms: false,
    endpoints: [
      {
        index: 0,
        scheme: 'https',
        host: 'feed.example.invalid',
        healthy: true,
        queued: 0,
        inFlight: 0,
        consecutiveFailures: 0,
        sentTotal: 42,
        droppedTotal: 0,
        lastHttpStatus: 200,
        lastSuccessUnixSeconds: 1795106568,
      },
    ],
    ...overrides,
  };
}

/** The `GET /v1/version` build identity. */
export function serverVersionPayload(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    build: '++Wardogs+Live-CL-533689',
    engine: {
      major: 5,
      minor: 7,
      patch: 4,
      changelist: 533689,
      compatibleChangelist: 533126,
      branch: '//Wardogs/Live',
    },
    project: { name: 'Wardogs', version: 'v0.3.0' },
    ...overrides,
  };
}
