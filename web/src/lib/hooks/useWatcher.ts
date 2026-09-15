/**
 * Polling, as a React hook.
 *
 * There is no push channel in this API, so live data means polling — and the
 * library's `createWatcher` already implements the loop, the diffing and the
 * backoff. This hook only owns the React lifecycle around it: the watcher is
 * created by an effect and torn down by that effect's cleanup, so changing the
 * interval or the roster toggle while running restarts the loop rather than
 * leaving a stale one behind.
 *
 * The watcher's own requests deliberately do **not** go through the session's
 * logged `call()`. A poll every five seconds would bury every deliberate
 * request in the log within a minute.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import {
  createWatcher,
  type PlayerListDelta,
  type StatusChange,
  type WardogsWatcher,
  type WatchSnapshot,
} from '@wardogs/api';

import { describeError } from '../format';
import { useSession } from '../session';

/** Enough history to see a pattern, bounded so a long session stays cheap. */
const SNAPSHOT_LIMIT = 60;
const ERROR_LIMIT = 5;

export interface WatcherHandle {
  running: boolean;
  snapshots: readonly WatchSnapshot[];
  lastChange: StatusChange | null;
  lastDelta: PlayerListDelta | null;
  errors: readonly string[];
  intervalMs: number;
  watchPlayers: boolean;
  setIntervalMs(value: number): void;
  setWatchPlayers(value: boolean): void;
  start(): void;
  stop(): void;
}

export function useWatcher(): WatcherHandle {
  const { client } = useSession();

  const [running, setRunning] = useState(false);
  const [snapshots, setSnapshots] = useState<WatchSnapshot[]>([]);
  const [lastChange, setLastChange] = useState<StatusChange | null>(null);
  const [lastDelta, setLastDelta] = useState<PlayerListDelta | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [intervalMs, setIntervalMs] = useState(5_000);
  const [watchPlayers, setWatchPlayers] = useState(false);

  const watcherRef = useRef<WardogsWatcher | null>(null);

  useEffect(() => {
    if (!running) return;

    const watcher = createWatcher(client, {
      intervalMs,
      watchPlayers,
      // One request per tick unless the roster is watched too — `GET /v1/status`
      // already carries the counts, the scores and the rotation indices.
      immediate: true,
    });
    watcherRef.current = watcher;

    const unsubscribe = [
      watcher.on('snapshot', (snapshot) => {
        setSnapshots((previous) => [...previous, snapshot].slice(-SNAPSHOT_LIMIT));
      }),
      watcher.on('change', (change) => {
        setLastChange(change);
      }),
      watcher.on('players', (delta) => {
        setLastDelta(delta);
      }),
      watcher.on('error', (error) => {
        const view = describeError(error);
        setErrors((previous) =>
          [
            `${view.title}${view.detail === undefined ? '' : ` — ${view.detail}`}`,
            ...previous,
          ].slice(0, ERROR_LIMIT),
        );
      }),
    ];

    watcher.start();

    return () => {
      for (const off of unsubscribe) off();
      watcherRef.current = null;
      // `stop()` waits for any in-flight request, which is what keeps a
      // re-render from leaving a request behind pointed at a dead watcher.
      void watcher.stop();
    };
  }, [client, running, intervalMs, watchPlayers]);

  const start = useCallback(() => {
    setErrors([]);
    setSnapshots([]);
    setLastChange(null);
    setLastDelta(null);
    setRunning(true);
  }, []);

  const stop = useCallback(() => {
    setRunning(false);
  }, []);

  return {
    running,
    snapshots,
    lastChange,
    lastDelta,
    errors,
    intervalMs,
    watchPlayers,
    setIntervalMs,
    setWatchPlayers,
    start,
    stop,
  };
}
