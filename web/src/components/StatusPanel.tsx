import { useCallback, useState } from 'react';

import { type Status } from '@wardogs/api';

import { describeError } from '../lib/format';
import { useWatcher } from '../lib/hooks/useWatcher';
import { renderResponse } from '../lib/renderers';
import { useSession } from '../lib/session';

/**
 * Live match state, one-shot or polled.
 *
 * The polling controls sit here rather than in a tab of their own because they
 * change what this panel is showing, and the two are read together: a snapshot
 * that has not moved in thirty seconds means something different when the loop
 * is stopped than when it is running.
 */
export function StatusPanel() {
  const session = useSession();
  const watcher = useWatcher();

  const [status, setStatus] = useState<Status | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  const loadOnce = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const next = await session.call(
        { method: 'GET', path: '/v1/status', label: 'status' },
        (client) => client.status.get(),
      );
      setStatus(next);
    } catch (failure) {
      setError(failure);
    } finally {
      setBusy(false);
    }
  }, [session]);

  const latest = watcher.snapshots[watcher.snapshots.length - 1];
  const current = latest?.status ?? status;
  const failure = error === null ? null : describeError(error);

  return (
    <section>
      <div className="row">
        <button type="button" onClick={() => void loadOnce()} disabled={busy}>
          {busy ? 'Loading…' : 'Load once'}
        </button>
        <button
          type="button"
          className={watcher.running ? '' : 'primary'}
          onClick={() => (watcher.running ? watcher.stop() : watcher.start())}
        >
          {watcher.running ? 'Stop polling' : 'Start polling'}
        </button>
        <label className="inline">
          Interval
          <input
            type="number"
            min={1}
            step={1}
            value={watcher.intervalMs / 1000}
            onChange={(event) => {
              const seconds = Number(event.target.value);
              if (Number.isFinite(seconds) && seconds > 0) {
                watcher.setIntervalMs(Math.round(seconds * 1000));
              }
            }}
          />
          s
        </label>
        <label className="inline">
          <input
            type="checkbox"
            checked={watcher.watchPlayers}
            onChange={(event) => watcher.setWatchPlayers(event.target.checked)}
          />
          Watch roster too
        </label>
      </div>

      <p className="hint">
        One tick costs one request. <code>GET /v1/status</code> already carries the player count,
        the faction scores and the rotation indices; watching the roster as well doubles the request
        count, which is why it is off by default. The reference notes the official panel refreshes
        every 3–5 seconds.
      </p>

      {failure !== null && (
        <div className="failure">
          <strong>{failure.title}</strong>
          {failure.detail !== undefined && <p>{failure.detail}</p>}
          {failure.hint !== undefined && <p className="hint">{failure.hint}</p>}
        </div>
      )}

      {watcher.running && (
        <p className="note">
          tick {latest?.tick ?? 0} · {watcher.snapshots.length} snapshots held
          {watcher.lastChange !== null &&
            ` · last change: ${watcher.lastChange.changed.join(', ') || 'none'}`}
        </p>
      )}

      {watcher.errors.length > 0 && (
        <div className="failure">
          <strong>Failed ticks</strong>
          <ul className="plain">
            {watcher.errors.map((message, index) => (
              <li key={index}>{message}</li>
            ))}
          </ul>
          <p className="hint">
            A failed tick does not end the loop: it is reported and retried on a growing backoff, up
            to 8× the interval.
          </p>
        </div>
      )}

      {watcher.lastDelta !== null &&
        (watcher.lastDelta.joined.length > 0 || watcher.lastDelta.left.length > 0) && (
          <p className="note">
            roster: {watcher.lastDelta.joined.map((player) => `+${player.name}`).join(' ')}
            {watcher.lastDelta.joined.length > 0 && watcher.lastDelta.left.length > 0 ? ' ' : ''}
            {watcher.lastDelta.left.map((player) => `−${player.name}`).join(' ')}
          </p>
        )}

      {current === undefined ? (
        <p className="empty">No status yet. Load once, or start polling.</p>
      ) : (
        renderResponse('GET /v1/status', current)
      )}
    </section>
  );
}
