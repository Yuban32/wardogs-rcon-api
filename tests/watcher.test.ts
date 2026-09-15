/**
 * Polling watcher: change detection, roster diffing, retry behaviour and clean
 * shutdown.
 *
 * Polling is the part of this library most likely to be left running for days,
 * so the failure modes that matter are the ones that only show up over time —
 * a loop that dies on one bad tick, a buffer that grows without bound, a
 * `stop()` that leaves a request in flight.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createClient,
  createWatcher,
  diffPlayers,
  diffStatusFields,
  type Player,
  type Status,
  type WardogsWatcher,
} from '../src/index.js';
import {
  createRecordingFetch,
  playerPayload,
  statusPayload,
  type RecordingFetch,
} from './helpers.js';

const BASE = 'https://my-server.example:7776';
const TOKEN = 'tok';

let rec: RecordingFetch;
let watcher: WardogsWatcher | undefined;

/** Resolves after `n` microtask turns, so chained promises settle. */
async function flush(turns = 8): Promise<void> {
  for (let i = 0; i < turns; i++) await Promise.resolve();
}

/**
 * Lets pending microtasks settle, then fires a timer queued for "now".
 *
 * `start()` schedules the immediate tick with a zero delay. Neither
 * `advanceTimersToNextTimerAsync` nor a 1 ms relative advance reliably consumes
 * it, so this flushes first and then steps past zero.
 */
async function flushOrAdvance(): Promise<void> {
  await flush(50);
  await vi.advanceTimersByTimeAsync(0);
  await flush(50);
}

/**
 * Runs the immediate first tick, if the watcher is configured for one.
 *
 * `start()` schedules it with a zero delay, which `advanceTimersToNextTimerAsync`
 * does not reliably consume — so this stays separate from {@link tick} rather
 * than being folded in. On a watcher with `immediate: false` it is a no-op.
 */
async function boot(): Promise<void> {
  await flushOrAdvance();
}

/**
 * Runs exactly one further tick and lets it settle.
 *
 * `advanceTimersToNextTimerAsync` is the only primitive that fires exactly one
 * timer: it jumps the clock to the next due timer and runs it. Measured against
 * this watcher it produces one tick per call at whatever delay was scheduled,
 * which is what makes the backoff sequence assertable.
 *
 * `advanceTimersByTimeAsync(intervalMs)` is the trap — it fires every timer due
 * within the window, including ones the tick schedules for itself, so a single
 * call costs an unpredictable number of ticks.
 */
async function tick(): Promise<void> {
  await vi.advanceTimersToNextTimerAsync();
  await flush(50);
}

async function waitFor(predicate: () => boolean, label: string, timeoutMs = 2000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

beforeEach(() => {
  rec = createRecordingFetch();
});

afterEach(async () => {
  await watcher?.stop();
  watcher = undefined;
  vi.useRealTimers();
});

function clientWith(selection: { watchPlayers?: boolean } = {}) {
  rec.reset();
  rec.pushResponse({ body: statusPayload() });
  if (selection.watchPlayers === true) {
    rec.pushResponse({ body: { players: [playerPayload()] } });
  }
  return createClient({ baseUrl: BASE, token: TOKEN, fetch: rec.fetch, retries: 0 });
}

/* -------------------------------------------------------------------------- */
/* Pure diffing                                                                */
/* -------------------------------------------------------------------------- */

describe('diffStatusFields', () => {
  const base = statusPayload() as unknown as Status;

  it('reports no change for an identical payload', () => {
    expect(diffStatusFields(base, { ...base })).toEqual([]);
  });

  it('reports a changed scalar', () => {
    expect(diffStatusFields(base, { ...base, map: 'Europe' })).toEqual(['map']);
  });

  it('reports the player count collapsing to one field', () => {
    expect(diffStatusFields(base, { ...base, players: { current: 9, max: 128 } })).toEqual([
      'players',
    ]);
  });

  it('reports a changed experiences list', () => {
    expect(diffStatusFields(base, { ...base, experiences: ['Other_KOTH_01'] })).toEqual([
      'experiences',
    ]);
  });

  it('reports score tick changes', () => {
    expect(
      diffStatusFields(base, {
        ...base,
        scoreTick: { current: 30, min: 18, max: 30 },
      }),
    ).toEqual(['scoreTick']);
  });

  it('reports a rotation advance', () => {
    expect(diffStatusFields(base, { ...base, rotation: { nowIndex: 1, nextIndex: 2 } })).toEqual([
      'rotation',
    ]);
  });

  it('reports faction score changes', () => {
    expect(
      diffStatusFields(base, {
        ...base,
        factionScores: [{ name: 'NATO', colorHex: '#3b82f6' }],
      }),
    ).toEqual(['factionScores']);
  });

  it('ignores undocumented per-faction extras', () => {
    // Servers add fields to faction rows; a value that churns without meaning
    // must not register as a state change on every tick.
    const withExtra = {
      ...base,
      factionScores: base.factionScores.map((row, index) => ({
        ...row,
        ...(index === 0 ? { someCounter: 99 } : {}),
      })),
    } as unknown as Status;

    expect(diffStatusFields(base, withExtra)).toEqual([]);
  });

  it('treats a null rotation as distinct from a present one', () => {
    expect(diffStatusFields(base, { ...base, rotation: null })).toEqual(['rotation']);
  });

  it('reports several changes at once', () => {
    const changed = diffStatusFields(base, {
      ...base,
      map: 'Europe',
      matchSeconds: 999,
    });
    expect(changed.sort()).toEqual(['map', 'matchSeconds']);
  });
});

describe('diffPlayers', () => {
  const a = playerPayload({ steamId: '76561198000000001', name: 'Alpha' }) as unknown as Player;
  const b = playerPayload({ steamId: '76561198000000002', name: 'Bravo' }) as unknown as Player;
  const c = playerPayload({ steamId: '76561198000000003', name: 'Charlie' }) as unknown as Player;

  it('detects a join', () => {
    const delta = diffPlayers([a], [a, b]);
    expect(delta.joined.map((p) => p.steamId)).toEqual([b.steamId]);
    expect(delta.left).toEqual([]);
  });

  it('detects a leave', () => {
    const delta = diffPlayers([a, b], [a]);
    expect(delta.left.map((p) => p.steamId)).toEqual([b.steamId]);
    expect(delta.joined).toEqual([]);
  });

  it('detects a stat change on an existing player', () => {
    const delta = diffPlayers([a], [{ ...a, kills: 99 }]);
    expect(delta.updated.map((p) => p.steamId)).toEqual([a.steamId]);
    expect(delta.joined).toEqual([]);
    expect(delta.left).toEqual([]);
  });

  it('detects a faction change, which is the interesting one for moderation', () => {
    const delta = diffPlayers([a], [{ ...a, faction: 'RUS' }]);
    expect(delta.updated).toHaveLength(1);
  });

  it('ignores a rename when nothing else changed', () => {
    const delta = diffPlayers([a], [a]);
    expect(delta.updated).toEqual([]);
  });

  it('reports all three kinds at once', () => {
    const delta = diffPlayers([a, b], [{ ...a, kills: 1 }, c]);
    expect(delta.joined.map((p) => p.steamId)).toEqual([c.steamId]);
    expect(delta.left.map((p) => p.steamId)).toEqual([b.steamId]);
    expect(delta.updated.map((p) => p.steamId)).toEqual([a.steamId]);
  });

  it('handles an empty roster on both sides', () => {
    const delta = diffPlayers([], []);
    expect(delta).toEqual({ joined: [], left: [], updated: [], players: [] });
  });
});

/* -------------------------------------------------------------------------- */
/* Lifecycle                                                                   */
/* -------------------------------------------------------------------------- */

describe('lifecycle', () => {
  it('does not poll until started', async () => {
    watcher = createWatcher(clientWith());
    await flush();
    expect(rec.count).toBe(0);
  });

  it('polls once on start when immediate is on', async () => {
    vi.useFakeTimers();
    watcher = createWatcher(clientWith());
    watcher.start();

    await boot();
    expect(rec.count).toBe(1);
  });

  it('waits one interval before the first poll when immediate is off', async () => {
    vi.useFakeTimers();
    watcher = createWatcher(clientWith(), { immediate: false, intervalMs: 1000 });
    watcher.start();

    await vi.advanceTimersByTimeAsync(999);
    expect(rec.count).toBe(0);

    await vi.advanceTimersByTimeAsync(1);
    expect(rec.count).toBe(1);
  });

  it('polls again after the interval', async () => {
    vi.useFakeTimers();
    watcher = createWatcher(clientWith(), { intervalMs: 1000 });
    watcher.start();

    await boot();
    expect(rec.count).toBe(1);

    await vi.advanceTimersByTimeAsync(1000);
    expect(rec.count).toBe(2);
  });

  it('does not stack requests when a tick outlasts the interval', async () => {
    // A self-rescheduling timeout rather than setInterval: a slow response must
    // delay the next tick, not pile requests on top of it.
    vi.useFakeTimers();
    rec.reset();
    rec.pushResponse({ hang: true });

    // Built here rather than via `clientWith`, which resets the response queue
    // and would replace the hang with a valid payload.
    const client = createClient({ baseUrl: BASE, token: TOKEN, fetch: rec.fetch, retries: 0 });

    // A timeout far longer than the test window, so the tick stays genuinely
    // in flight rather than being resolved by the client's own timeout.
    watcher = createWatcher(client, { intervalMs: 100, timeoutMs: 60_000 });
    watcher.start();

    await vi.advanceTimersByTimeAsync(1_000);
    expect(rec.count).toBe(1);

    await vi.advanceTimersByTimeAsync(5_000);
    expect(rec.count).toBe(1);
  });

  it('start is idempotent', async () => {
    vi.useFakeTimers();
    watcher = createWatcher(clientWith(), { intervalMs: 1000 });
    watcher.start();
    watcher.start();
    watcher.start();

    await boot();
    expect(rec.count).toBe(1);
  });

  it('stops polling after stop()', async () => {
    vi.useFakeTimers();
    watcher = createWatcher(clientWith(), { intervalMs: 1000 });
    watcher.start();

    await boot();
    await watcher.stop();

    await vi.advanceTimersByTimeAsync(10_000);
    expect(rec.count).toBe(1);
  });

  it('reports isRunning', async () => {
    vi.useFakeTimers();
    watcher = createWatcher(clientWith(), { intervalMs: 1000 });

    expect(watcher.isRunning).toBe(false);
    watcher.start();
    expect(watcher.isRunning).toBe(true);
    await watcher.stop();
    expect(watcher.isRunning).toBe(false);
  });

  it('stop() is safe to call twice, and before start', async () => {
    watcher = createWatcher(clientWith());
    await expect(watcher.stop()).resolves.toBeUndefined();
    await expect(watcher.stop()).resolves.toBeUndefined();
  });

  it('stops when an external signal aborts', async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    watcher = createWatcher(clientWith(), {
      intervalMs: 1000,
      signal: controller.signal,
    });
    watcher.start();
    await boot();

    controller.abort();
    await flush();

    const countAfterAbort = rec.count;
    await vi.advanceTimersByTimeAsync(10_000);
    expect(rec.count).toBe(countAfterAbort);
  });
});

/* -------------------------------------------------------------------------- */
/* Events                                                                      */
/* -------------------------------------------------------------------------- */

describe('events', () => {
  it('emits a snapshot per tick', async () => {
    vi.useFakeTimers();
    watcher = createWatcher(clientWith(), { intervalMs: 1000 });
    const seen = vi.fn();
    watcher.on('snapshot', seen);

    watcher.start();
    await boot();
    await vi.advanceTimersByTimeAsync(1000);

    expect(seen).toHaveBeenCalledTimes(2);
    expect(seen.mock.calls[1]?.[0]).toMatchObject({ tick: 2 });
  });

  it('emits change only when the payload actually differs', async () => {
    vi.useFakeTimers();
    rec.reset();
    rec.pushResponse({ body: statusPayload() });
    const client = createClient({ baseUrl: BASE, token: TOKEN, fetch: rec.fetch, retries: 0 });

    watcher = createWatcher(client, { intervalMs: 1000 });
    const changed = vi.fn();
    watcher.on('change', changed);

    watcher.start();
    await boot();
    // Identical payloads: the first tick establishes a baseline and the second
    // changes nothing, so neither should fire.
    await vi.advanceTimersByTimeAsync(1000);

    expect(changed).not.toHaveBeenCalled();
  });

  it('emits change with the field names that moved', async () => {
    vi.useFakeTimers();
    rec.reset();
    rec.pushResponse({ body: statusPayload() });
    rec.pushResponse({ body: statusPayload({ map: 'Europe', matchSeconds: 5 }) });
    const client = createClient({ baseUrl: BASE, token: TOKEN, fetch: rec.fetch, retries: 0 });

    watcher = createWatcher(client, { intervalMs: 1000 });
    const changed = vi.fn();
    watcher.on('change', changed);

    watcher.start();
    await boot();
    await vi.advanceTimersByTimeAsync(1000);

    expect(changed).toHaveBeenCalledTimes(1);
    const payload = changed.mock.calls[0]?.[0] as { changed: string[] };
    expect(payload.changed.sort()).toEqual(['map', 'matchSeconds']);
  });

  it('emits a players delta when watchPlayers is on', async () => {
    // Driven with real timers: the point is the event, not the schedule, and a
    // fake-timer advance would run an unpredictable number of ticks.
    rec.reset();
    rec.pushResponse({ body: statusPayload() });
    rec.pushResponse({ body: { players: [] } });
    rec.pushResponse({ body: statusPayload() });
    rec.pushResponse({
      body: { players: [playerPayload({ steamId: '76561198000000001', name: 'Alpha' })] },
    });
    rec.pushResponse({ body: statusPayload() });
    rec.pushResponse({
      body: {
        players: [
          playerPayload({ steamId: '76561198000000001', name: 'Alpha' }),
          playerPayload({ steamId: '76561198000000002', name: 'Bravo' }),
        ],
      },
    });

    const client = createClient({ baseUrl: BASE, token: TOKEN, fetch: rec.fetch, retries: 0 });
    watcher = createWatcher(client, { intervalMs: 10, watchPlayers: true });

    const players = vi.fn();
    watcher.on('players', players);
    watcher.start();

    // The queue repeats its last response once exhausted, so every delta from
    // here on reports the same join. Wait for the specific one rather than the
    // first, which is Alpha appearing in an otherwise empty roster.
    await waitFor(() => {
      const latest = players.mock.calls[players.mock.calls.length - 1]?.[0] as
        { joined: Player[] } | undefined;
      return latest?.joined.some((p) => p.name === 'Bravo') === true;
    }, 'a delta reporting Bravo joining');

    const delta = players.mock.calls[players.mock.calls.length - 1]?.[0] as { joined: Player[] };
    expect(delta.joined.map((p) => p.name)).toEqual(['Bravo']);
  });

  it('does not poll players unless asked', async () => {
    vi.useFakeTimers();
    watcher = createWatcher(clientWith(), { intervalMs: 1000 });
    watcher.start();
    await boot();

    expect(rec.count).toBe(1);
    expect(rec.last().url).toContain('/v1/status');
  });

  it('keeps serving other listeners when one throws', async () => {
    // One broken UI callback must not stop the others from receiving the same
    // event, nor kill the polling loop.
    vi.useFakeTimers();
    watcher = createWatcher(clientWith(), { intervalMs: 1000 });

    const bad = vi.fn(() => {
      throw new Error('listener blew up');
    });
    const good = vi.fn();
    watcher.on('snapshot', bad);
    watcher.on('snapshot', good);

    watcher.start();
    await boot();

    expect(bad).toHaveBeenCalled();
    expect(good).toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1000);
    expect(rec.count).toBe(2);
  });

  it('unsubscribes with the returned function', async () => {
    vi.useFakeTimers();
    watcher = createWatcher(clientWith(), { intervalMs: 1000 });
    const seen = vi.fn();
    const off = watcher.on('snapshot', seen);

    watcher.start();
    await boot();
    off();
    await vi.advanceTimersByTimeAsync(1000);

    expect(seen).toHaveBeenCalledTimes(1);
  });
});

/* -------------------------------------------------------------------------- */
/* Failure handling                                                            */
/* -------------------------------------------------------------------------- */

describe('failure handling', () => {
  it('emits error and keeps polling', async () => {
    vi.useFakeTimers();
    rec.reset();
    rec.pushResponse({ throws: new TypeError('fetch failed') });
    rec.pushResponse({ body: statusPayload() });
    const client = createClient({ baseUrl: BASE, token: TOKEN, fetch: rec.fetch, retries: 0 });

    watcher = createWatcher(client, { intervalMs: 1000 });
    const errors = vi.fn();
    watcher.on('error', errors);

    watcher.start();
    await boot();
    expect(errors).toHaveBeenCalledTimes(1);

    // Backoff is 2× after one failure, so the retry is one timer away.
    await tick();
    expect(rec.count).toBe(2);
    expect(watcher.isRunning).toBe(true);
  });

  it('backs off progressively and caps the delay', async () => {
    vi.useFakeTimers();
    rec.reset();
    rec.pushResponse({ throws: new TypeError('fetch failed') });
    const client = createClient({ baseUrl: BASE, token: TOKEN, fetch: rec.fetch, retries: 0 });

    watcher = createWatcher(client, { intervalMs: 100 });
    watcher.start();

    // t=0
    await tick();
    expect(rec.count).toBe(1);

    // t=100: 2× after one failure.
    await tick();
    expect(rec.count).toBe(2);

    // t=300: 4×.
    await tick();
    expect(rec.count).toBe(3);

    // t=700: 8×, the cap for a 100ms interval.
    await tick();
    expect(rec.count).toBe(4);

    // t=1500 (still 800, not 1600).
    await tick();
    expect(rec.count).toBe(5);

    // Confirm the cap holds: four more backoffs, four more ticks — 800ms apart,
    // not doubling.
    for (let i = 0; i < 4; i++) await tick();
    expect(rec.count).toBe(9);
  });

  it('resets the backoff after a success', async () => {
    vi.useFakeTimers();
    rec.reset();
    rec.pushResponse({ throws: new TypeError('fetch failed') });
    rec.pushResponse({ body: statusPayload() });
    const client = createClient({ baseUrl: BASE, token: TOKEN, fetch: rec.fetch, retries: 0 });

    watcher = createWatcher(client, { intervalMs: 100 });
    watcher.start();

    await boot();
    expect(rec.count).toBe(1);

    // The retry succeeds, so the failure streak ends here.
    await tick();
    expect(rec.count).toBe(2);

    // Back to the plain 100ms interval rather than a doubled delay.
    await tick();
    expect(rec.count).toBe(3);
  });

  it('stops on an auth failure instead of hammering a refused credential', async () => {
    vi.useFakeTimers();
    rec.reset();
    rec.pushResponse({
      status: 401,
      body: { error: { code: 'unauthorized', message: 'bad token' } },
    });
    const client = createClient({ baseUrl: BASE, token: TOKEN, fetch: rec.fetch, retries: 0 });

    watcher = createWatcher(client, { intervalMs: 100 });
    const errors = vi.fn();
    watcher.on('error', errors);

    watcher.start();
    await boot();
    await flush();

    expect(errors).toHaveBeenCalledTimes(1);
    expect(watcher.isRunning).toBe(false);

    await vi.advanceTimersByTimeAsync(10_000);
    expect(rec.count).toBe(1);
  });

  it('honours onError: stop for any failure', async () => {
    vi.useFakeTimers();
    rec.reset();
    rec.pushResponse({ throws: new TypeError('fetch failed') });
    const client = createClient({ baseUrl: BASE, token: TOKEN, fetch: rec.fetch, retries: 0 });

    watcher = createWatcher(client, { intervalMs: 100, onError: 'stop' });
    watcher.start();

    await boot();
    await flush();

    expect(watcher.isRunning).toBe(false);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(rec.count).toBe(1);
  });

  it('does not emit an error for a cancellation it caused itself', async () => {
    vi.useFakeTimers();
    rec.reset();
    rec.pushResponse({ hang: true });
    const client = createClient({ baseUrl: BASE, token: TOKEN, fetch: rec.fetch, retries: 0 });

    watcher = createWatcher(client, { intervalMs: 100 });
    const errors = vi.fn();
    watcher.on('error', errors);

    watcher.start();
    await boot();
    await watcher.stop();

    expect(errors).not.toHaveBeenCalled();
  });
});

/* -------------------------------------------------------------------------- */
/* Accessors and iteration                                                     */
/* -------------------------------------------------------------------------- */

describe('accessors', () => {
  it('exposes the last snapshot without issuing a request', async () => {
    vi.useFakeTimers();
    watcher = createWatcher(clientWith());
    expect(watcher.getLast()).toBeNull();
    expect(watcher.getStatus()).toBeNull();
    expect(watcher.getPlayers()).toEqual([]);

    watcher.start();
    await boot();

    expect(rec.count).toBe(1);
    expect(watcher.getStatus()?.map).toBe('Kavkazi');
  });

  it('returns a copy of the roster, so callers cannot mutate internal state', async () => {
    vi.useFakeTimers();
    watcher = createWatcher(clientWith({ watchPlayers: true }), { watchPlayers: true });
    watcher.start();
    await boot();

    watcher.getPlayers().push({} as Player);
    expect(watcher.getPlayers()).toHaveLength(1);
  });
});

describe('async iteration', () => {
  it('yields snapshots', async () => {
    vi.useFakeTimers();
    watcher = createWatcher(clientWith(), { intervalMs: 1000 });

    const received: number[] = [];
    const done = (async () => {
      for await (const snapshot of watcher!) {
        received.push(snapshot.tick);
        if (received.length === 2) break;
      }
    })();

    watcher.start();
    await boot();
    await vi.advanceTimersByTimeAsync(1000);
    await done;

    expect(received).toEqual([1, 2]);
  });

  it('completes the iteration when the watcher stops', async () => {
    vi.useFakeTimers();
    watcher = createWatcher(clientWith(), { intervalMs: 1000 });

    const ticks: number[] = [];
    const done = (async () => {
      for await (const snapshot of watcher!) ticks.push(snapshot.tick);
    })();

    watcher.start();
    await boot();
    await watcher.stop();
    await done;

    expect(ticks).toEqual([1]);
  });

  it('drops the oldest snapshots when a consumer falls behind', async () => {
    // The buffer is bounded so a stalled consumer cannot exhaust memory; the
    // watcher's value is its latest state, not its history. Real timers again —
    // the assertion is about the buffer, not the schedule.
    rec.reset();
    rec.pushResponse({ body: statusPayload() });

    watcher = createWatcher(clientWith(), { intervalMs: 5, maxBuffer: 3 });

    const seen: number[] = [];
    watcher.on('snapshot', (snapshot) => seen.push(snapshot.tick));
    watcher.start();

    await waitFor(() => seen.length >= 6, 'enough ticks to overfill the buffer');
    await watcher.stop();

    const drained: number[] = [];
    for await (const snapshot of watcher) drained.push(snapshot.tick);

    // At most maxBuffer retained, and they are the most recent ones.
    expect(drained.length).toBeLessThanOrEqual(3);
    expect(drained.length).toBeGreaterThan(0);
    expect(drained).toEqual([...drained].sort((a, b) => a - b));
    expect(drained[drained.length - 1]).toBe(seen[seen.length - 1]);
  });
});
