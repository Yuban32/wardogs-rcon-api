import { useState } from 'react';

import { describeEntry, useSession } from '../lib/session';
import { describeError, formatBytes, formatDuration } from '../lib/format';

/**
 * Every request the panel has made, newest first.
 *
 * Useful next to the server's own audit log: `GET /v1/audit` says what the
 * server did, this says what this page asked for — including the failures the
 * audit log never saw, because they never got that far.
 */
export function RequestLog({ onClear }: { onClear(): void }) {
  const session = useSession();
  const [expanded, setExpanded] = useState<number | null>(null);

  if (session.log.length === 0) {
    return <p className="empty">No requests yet.</p>;
  }

  return (
    <section>
      <div className="row">
        <button type="button" onClick={onClear}>
          Clear
        </button>
      </div>

      <ul className="log">
        {session.log.map((entry) => {
          const isOpen = expanded === entry.id;
          const failure = entry.error === undefined ? null : describeError(entry.error);
          return (
            <li key={entry.id} className={entry.outcome === 'ok' ? 'log-ok' : 'log-error'}>
              <button
                type="button"
                className="log-line"
                onClick={() => setExpanded(isOpen ? null : entry.id)}
              >
                <span className={entry.outcome === 'ok' ? 'ok' : 'err'}>
                  {entry.outcome === 'ok' ? '✓' : '✗'}
                </span>
                <span>{describeEntry(entry)}</span>
                <span className="dim">
                  {formatDuration(entry.durationMs)}
                  {entry.bytes > 0 && ` · ${formatBytes(entry.bytes)}`}
                </span>
              </button>

              {isOpen && (
                <div className="log-detail">
                  {failure !== null && (
                    <>
                      <p>
                        <strong>{failure.title}</strong>
                        {failure.code !== undefined && ` · ${failure.code}`}
                      </p>
                      {failure.detail !== undefined && <p>{failure.detail}</p>}
                      {failure.hint !== undefined && <p className="hint">{failure.hint}</p>}
                    </>
                  )}
                  <p className="hint">
                    {entry.label} · {entry.method} {entry.path}
                  </p>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
