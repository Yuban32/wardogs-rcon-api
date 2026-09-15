/**
 * Polling watcher.
 *
 * The API has no push channel — it is plain request/response HTTP, so live
 * data means polling. The reference notes there is no published rate limit and
 * that the official panel refreshes on a 3–5 second cadence, which is where
 * the default interval comes from.
 *
 * A tick costs exactly one request. `GET /v1/status` already carries the
 * player count, the faction scores and the rotation indices, so a status
 * watcher never needs a second call. Roster diffing does, which is why it is
 * opt-in rather than automatic.
 */

import type { WardogsClient } from '../core/client.js';
import { WardogsHttpError } from '../core/errors.js';
import type { Player, Status } from '../core/types.js';
import { AsyncQueue, Emitter } from './emitter.js';

/* -------------------------------------------------------------------------- */
/* Public shapes                                                               */
/* -------------------------------------------------------------------------- */

/** One observation of the server. */
export interface WatchSnapshot {
  status: Status;
  /** Present only when `watchPlayers` is enabled. */
  players?: Player[];
  /** Milliseconds since the watcher started. */
  readonly elapsedMs: number;
  /** 1-based tick number. */
  readonly tick: number;
}

/** What changed between two snapshots. */
export interface StatusChange {
  snapshot: WatchSnapshot;
  previous: WatchSnapshot;
  /**
   * Names of the top-level fields that differ.
   *
   * Convenience only — it covers the documented fields and will not see
   * anything a server adds beyond them. Do not branch on it for correctness.
   */
  changed: string[];
}

/** Roster difference carried by a `players` event. */
export interface PlayerListDelta {
  joined: Player[];
  left: Player[];
  /** Players whose stats or team differ from the previous tick. */
  updated: Player[];
  players: Player[];
}

export interface WatcherEvents {
  /** Every successful tick, whether or not anything changed. */
  snapshot: WatchSnapshot;
  /** Only when the status actually differs from the previous tick. */
  change: StatusChange;
  /** Roster difference. Requires `watchPlayers`. */
  players: PlayerListDelta;
  /** A failed tick. The loop continues unless the failure is terminal. */
  error: unknown;
}

export interface WatcherOptions {
  /**
   * Milliseconds between ticks. Default `5000`.
   *
   * The reference asks for gentle polling and notes the official panel uses a
   * 3–5 second cadence. Going much below 3000 buys little and risks being
   * throttled by a proxy in front of the server.
   */
  intervalMs?: number;

  /**
   * Poll `GET /v1/players` alongside status, to emit roster differences.
   * Default `false`. Doubles the request count per tick.
   */
  watchPlayers?: boolean;

  /** Fetch once immediately rather than waiting one interval. Default `true`. */
  immediate?: boolean;

  /**
   * Stop the watcher when this signal aborts.
   *
   * `stop()` remains the explicit shutdown path; this is for tying a watcher
   * to a page or request lifetime.
   */
  signal?: AbortSignal;

  /**
   * Cap on unconsumed snapshots held for `for await` consumers. Default `100`.
   * Once full, the oldest is dropped so a stalled consumer cannot exhaust
   * memory — a watcher's value is its latest state, not its history.
   */
  maxBuffer?: number;

  /**
   * How to react to a failed tick.
   *
   * `"backoff"` (default) retries on a growing delay, up to 8× `intervalMs`,
   * resetting on the first success. `"stop"` ends the watcher on any error
   * other than a cancellation.
   */
  onError?: 'backoff' | 'stop';

  /** Per-request timeout, forwarded to the client. */
  timeoutMs?: number;
}

export interface WardogsWatcher extends AsyncIterable<WatchSnapshot> {
  start(): void;
  /** Stops polling and resolves once any in-flight request has settled. */
  stop(): Promise<void>;
  readonly isRunning: boolean;
  on<K extends keyof WatcherEvents>(
    event: K,
    listener: (payload: WatcherEvents[K]) => void,
  ): () => void;
  off<K extends keyof WatcherEvents>(event: K, listener: (payload: WatcherEvents[K]) => void): void;
  /** The most recent successful snapshot, without issuing a request. */
  getLast(): WatchSnapshot | null;
  /** Parsed status from the most recent snapshot. */
  getStatus(): Status | null;
  /** Roster from the most recent snapshot; empty unless `watchPlayers`. */
  getPlayers(): Player[];
}

/* -------------------------------------------------------------------------- */
/* Comparison                                                                  */
/* -------------------------------------------------------------------------- */

function arraysEqual(a: readonly unknown[], b: readonly unknown[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

const STATUS_SCALARS = [
  'serverName',
  'map',
  'lighting',
  'alternator',
  'scoreCap',
  'matchSeconds',
] as const;

function sameFactionScores(a: Status, b: Status): boolean {
  const left = a.factionScores ?? [];
  const right = b.factionScores ?? [];
  if (left.length !== right.length) return false;

  return left.every((entry, index) => {
    const other = right[index];
    if (other === undefined) return false;
    // Documented fields only — servers may add per-faction extras that churn
    // without carrying meaning.
    return entry.name === other.name && entry.colorHex === other.colorHex;
  });
}

/**
 * Compares two status payloads over the documented fields.
 *
 * Returns the names of the fields that differ, so a consumer can log *what*
 * changed rather than just that something did.
 */
export function diffStatusFields(a: Status, b: Status): string[] {
  const changed: string[] = [];

  for (const field of STATUS_SCALARS) {
    if (a[field] !== b[field]) changed.push(field);
  }

  if (!arraysEqual(a.experiences, b.experiences)) changed.push('experiences');

  if (a.players?.current !== b.players?.current || a.players?.max !== b.players?.max) {
    changed.push('players');
  }

  if (
    a.scoreTick?.current !== b.scoreTick?.current ||
    a.scoreTick?.min !== b.scoreTick?.min ||
    a.scoreTick?.max !== b.scoreTick?.max
  ) {
    changed.push('scoreTick');
  }

  if (
    a.rotation?.nowIndex !== b.rotation?.nowIndex ||
    a.rotation?.nextIndex !== b.rotation?.nextIndex
  ) {
    changed.push('rotation');
  }

  if (!sameFactionScores(a, b)) changed.push('factionScores');

  return changed;
}

/** Compares two rosters by SteamID64. */
export function diffPlayers(
  previous: readonly Player[],
  current: readonly Player[],
): PlayerListDelta {
  const previousById = new Map(previous.map((player) => [player.steamId, player]));
  const currentById = new Map(current.map((player) => [player.steamId, player]));

  const joined: Player[] = [];
  const left: Player[] = [];
  const updated: Player[] = [];

  for (const [steamId, player] of currentById) {
    const before = previousById.get(steamId);
    if (before === undefined) {
      joined.push(player);
      continue;
    }
    if (
      before.kills !== player.kills ||
      before.deaths !== player.deaths ||
      before.cash !== player.cash ||
      before.faction !== player.faction ||
      before.name !== player.name ||
      before.pingMs !== player.pingMs
    ) {
      updated.push(player);
    }
  }

  for (const [steamId, player] of previousById) {
    if (!currentById.has(steamId)) left.push(player);
  }

  return { joined, left, updated, players: [...current] };
}

/* -------------------------------------------------------------------------- */
/* Watcher                                                                     */
/* -------------------------------------------------------------------------- */

/** Upper bound on the error backoff, as a multiple of `intervalMs`. */
const MAX_BACKOFF_MULTIPLE = 8;

/**
 * Polls a server and reports changes.
 *
 * ```ts
 * const watcher = createWatcher(client, { intervalMs: 5000 });
 * watcher.on('change', ({ changed }) => console.log('changed:', changed));
 * watcher.on('players', ({ joined, left }) => {
 *   for (const p of joined) console.log(`${p.name} joined`);
 *   for (const p of left) console.log(`${p.name} left`);
 * });
 * watcher.start();
 * ```
 *
 * A failing tick is reported through the `error` event and, by default,
 * retried on a growing delay — a transient blip should not silently end
 * monitoring on a dashboard left running for days.
 *
 * The loop is a self-rescheduling `setTimeout`, not a `setInterval`: a slow
 * response must delay the next tick rather than stack requests on top of each
 * other.
 */
export function createWatcher(
  client: Pick<WardogsClient, 'status' | 'players'>,
  options: WatcherOptions = {},
): WardogsWatcher {
  const {
    intervalMs = 5_000,
    watchPlayers = false,
    immediate = true,
    signal,
    maxBuffer = 100,
    onError = 'backoff',
    timeoutMs,
  } = options;

  const emitter = new Emitter<WatcherEvents>();
  const queue = new AsyncQueue<WatchSnapshot>();
  const abortController = new AbortController();

  const startedAt = Date.now();
  let last: WatchSnapshot | null = null;
  let lastPlayers: Player[] = [];
  let tick = 0;
  let running = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let inFlight: Promise<void> | null = null;
  let consecutiveFailures = 0;

  const requestOptions = (): { signal: AbortSignal; timeoutMs?: number } => ({
    signal: abortController.signal,
    ...(timeoutMs !== undefined ? { timeoutMs } : {}),
  });

  const isCancellation = (error: unknown): boolean => {
    if (abortController.signal.aborted) return true;
    return error instanceof Error && error.name === 'WardogsAbortError';
  };

  /** Stops polling and waits for the in-flight tick, if any. */
  const stop = async (): Promise<void> => {
    const wasRunning = running || timer !== undefined || inFlight !== null;
    running = false;

    if (timer !== undefined) {
      clearTimeout(timer);
      timer = undefined;
    }
    if (wasRunning) abortController.abort();

    const pending = inFlight;
    inFlight = null;
    if (pending !== null) {
      try {
        await pending;
      } catch {
        // Already surfaced through the error event.
      }
    }

    queue.close();
    emitter.clear();
  };

  /** One poll. Never throws: failures are emitted as `error`. */
  const performTick = async (): Promise<void> => {
    try {
      const currentStatus = await client.status.get(requestOptions());
      if (!running) return;

      let currentPlayers: Player[] | undefined;
      let delta: PlayerListDelta | null = null;

      if (watchPlayers) {
        currentPlayers = await client.players.list(requestOptions());
        if (!running) return;
        delta = diffPlayers(lastPlayers, currentPlayers);
        lastPlayers = currentPlayers;
      }

      const snapshot: WatchSnapshot = {
        status: currentStatus,
        ...(currentPlayers !== undefined ? { players: currentPlayers } : {}),
        elapsedMs: Date.now() - startedAt,
        tick: ++tick,
      };

      const previous = last;
      last = snapshot;
      consecutiveFailures = 0;

      while (queue.size >= maxBuffer) queue.shift();
      queue.push(snapshot);
      emitter.emit('snapshot', snapshot);

      if (previous !== null) {
        const changed = diffStatusFields(previous.status, currentStatus);
        if (changed.length > 0) {
          emitter.emit('change', { snapshot, previous, changed });
        }
      }

      if (
        delta !== null &&
        (delta.joined.length > 0 || delta.left.length > 0 || delta.updated.length > 0)
      ) {
        emitter.emit('players', delta);
      }
    } catch (error) {
      if (isCancellation(error)) return;

      emitter.emit('error', error);

      // A rejected credential will not start working on its own; retrying it
      // forever is pure noise against a server that is already refusing us.
      const terminal =
        onError === 'stop' || (error instanceof WardogsHttpError && error.isAuthError);

      if (terminal) {
        void stop();
        return;
      }

      consecutiveFailures++;
    }
  };

  const schedule = (delay: number): void => {
    if (!running) return;

    timer = setTimeout(() => {
      timer = undefined;

      // A tick is still outstanding — an earlier one that outlived its own
      // cancellation, or a `stop()` that landed between the timer firing and
      // this callback. Starting another would stack requests on a server that
      // is already failing to answer, which is the opposite of the gentle
      // polling the reference asks for.
      if (inFlight !== null) {
        schedule(intervalMs);
        return;
      }

      const task = performTick().then(() => {
        inFlight = null;
        if (!running) return;

        const backoff =
          consecutiveFailures === 0
            ? intervalMs
            : Math.min(
                intervalMs * 2 ** (consecutiveFailures - 1),
                intervalMs * MAX_BACKOFF_MULTIPLE,
              );
        schedule(backoff);
      });
      inFlight = task;
    }, delay);
  };

  const start = (): void => {
    if (running) return;
    running = true;
    schedule(immediate ? 0 : intervalMs);
  };

  if (signal !== undefined) {
    if (signal.aborted) {
      queue.close();
    } else {
      signal.addEventListener(
        'abort',
        () => {
          void stop();
        },
        { once: true },
      );
    }
  }

  return {
    start,
    stop,
    get isRunning() {
      return running;
    },
    on: (event, listener) => emitter.on(event, listener),
    off: (event, listener) => emitter.off(event, listener),
    getLast: () => last,
    getStatus: () => last?.status ?? null,
    getPlayers: () => (last?.players !== undefined ? [...last.players] : []),
    [Symbol.asyncIterator]: () => queue[Symbol.asyncIterator](),
  };
}
