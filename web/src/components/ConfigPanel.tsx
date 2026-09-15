import { useCallback, useState, type ReactNode } from 'react';

import {
  SESSION_SECTION,
  WardogsHttpError,
  createConfigDocument,
  type Config,
  type ConfigResult,
} from '@wardogs/api';

import { describeError } from '../lib/format';
import { useSession } from '../lib/session';

/**
 * Read, edit, validate and apply `ServerSettings.ini`.
 *
 * This is the one panel that cannot go through the generic explorer, for a
 * reason worth stating: `PUT /v1/config` and `POST /v1/config/validate` take
 * the document as `text/plain`, not as a JSON string. The client's escape hatch
 * `request()` only ever JSON-encodes a body, so these two are reachable through
 * `config.apply()` and `config.validate()` and nowhere else.
 *
 * Applying is also the only operation here with a concurrency story: the
 * revision read with the document goes back as `If-Match`, and a stale one
 * fails with 412 instead of overwriting somebody else's edit. The panel offers
 * the documented recovery — re-read, re-apply, retry — rather than just
 * reporting the failure.
 */
export function ConfigPanel() {
  const session = useSession();

  const [config, setConfig] = useState<Config | null>(null);
  const [text, setText] = useState('');
  const [result, setResult] = useState<ConfigResult | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);

  // A structured edit staged locally, applied to the text on demand.
  const [serverName, setServerName] = useState('');

  const load = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const next = await session.call(
        { method: 'GET', path: '/v1/config', label: 'config' },
        (client) => client.config.get(),
      );
      setConfig(next);
      setText(next.text);
      setResult(null);
      setConfirming(false);
      // Parsed locally, no request: the parser is case-insensitive on keys and
      // preserves repeated `+Key=` lines, so this reads the real value the
      // server will see.
      const document = createConfigDocument(next.text);
      setServerName(document.get(SESSION_SECTION, 'ServerName') ?? '');
    } catch (failure) {
      setError(failure);
    } finally {
      setBusy(false);
    }
  }, [session]);

  const stageServerName = useCallback(() => {
    if (config === null) return;
    // Edits return a new document, so the one read from the server is still
    // intact — which is exactly what the revision check needs.
    const edited = createConfigDocument(text).set(SESSION_SECTION, 'ServerName', serverName);
    setText(edited.text);
  }, [config, serverName, text]);

  const run = useCallback(
    async (mode: 'validate' | 'apply') => {
      setBusy(true);
      setError(null);
      setResult(null);
      try {
        const outcome =
          mode === 'validate'
            ? await session.call(
                { method: 'POST', path: '/v1/config/validate', label: 'validate config' },
                (client) => client.config.validate(text),
              )
            : await session.call(
                { method: 'PUT', path: '/v1/config', label: 'apply config' },
                (client) =>
                  client.config.apply(text, {
                    // The revision read above. Without it the write is
                    // unconditional, and a concurrent edit is lost silently.
                    ...(config !== null ? { ifMatch: config.revision } : {}),
                  }),
              );

        setResult(outcome);
        setConfirming(false);
        if (mode === 'apply') {
          // The server returns the new revision; keep it, so a second apply
          // from this page does not immediately fail as stale.
          setConfig((previous) =>
            previous === null ? previous : { ...previous, revision: outcome.revision },
          );
        }
      } catch (failure) {
        setError(failure);
        setConfirming(false);
      } finally {
        setBusy(false);
      }
    },
    [config, session, text],
  );

  const failure = error === null ? null : describeError(error);
  const stale = error instanceof WardogsHttpError && error.isRevisionConflict;

  return (
    <section>
      <div className="row">
        <button type="button" onClick={() => void load()} disabled={busy}>
          {busy && config === null
            ? 'Loading…'
            : config === null
              ? 'Read config'
              : 'Re-read config'}
        </button>
        {config !== null && (
          <>
            <button type="button" onClick={() => void run('validate')} disabled={busy}>
              Validate
            </button>
            <button
              type="button"
              className={confirming ? 'danger' : 'primary'}
              disabled={busy || session.readOnly || config.writable !== true}
              onClick={() => (confirming ? void run('apply') : setConfirming(true))}
            >
              {confirming ? 'Confirm — this replaces the server config' : 'Apply'}
            </button>
            {confirming && (
              <button type="button" onClick={() => setConfirming(false)}>
                Cancel
              </button>
            )}
          </>
        )}
      </div>

      {config !== null && (
        <p className="note">
          revision <code>{config.revision}</code> · writable {String(config.writable)} ·{' '}
          {text.split('\n').length} lines
          {session.readOnly && ' · read-only mode is on'}
        </p>
      )}

      {failure !== null && (
        <div className="failure">
          <strong>{failure.title}</strong>
          {failure.detail !== undefined && <p>{failure.detail}</p>}
          {failure.hint !== undefined && <p className="hint">{failure.hint}</p>}
          {stale && (
            <p>
              <button type="button" onClick={() => void load()}>
                Re-read the document
              </button>
            </p>
          )}
        </div>
      )}

      {config === null ? (
        <p className="empty">
          Nothing loaded yet. The document is the server&rsquo;s <code>ServerSettings.ini</code>.
        </p>
      ) : (
        <>
          <div className="row">
            <label className="inline">
              ServerName
              <input
                value={serverName}
                spellCheck={false}
                onChange={(event) => setServerName(event.target.value)}
              />
            </label>
            <button type="button" onClick={stageServerName}>
              Stage into document
            </button>
          </div>
          <p className="hint">
            A structured edit built with <code>createConfigDocument</code>: it looks the key up
            case-insensitively, the way Unreal reads it, and returns a new document rather than
            mutating the one that was read.
          </p>

          <label className="stack">
            Document
            <textarea
              className="document"
              rows={20}
              spellCheck={false}
              value={text}
              onChange={(event) => setText(event.target.value)}
            />
          </label>
        </>
      )}

      {result !== null && (
        <div className="result">
          <strong>{result.ok ? 'Accepted' : 'Rejected'}</strong>
          <p className="note">
            revision <code>{result.revision}</code>
            {result.changed !== undefined && ` · ${result.changed.length} keys changed`}
          </p>
          {renderList('Warnings', result.warnings)}
          {renderList('Errors', result.errors)}
          {renderList('Stripped (not on the allow-list)', result.stripped)}
          {renderList('Shadowed (a later duplicate won)', result.shadowed)}
          {renderList('Conflict', result.conflict)}
        </div>
      )}
    </section>
  );
}

/** The outcome arrays are typed loosely by the spec, so render whatever is there. */
function renderList(label: string, values: unknown): ReactNode {
  if (!Array.isArray(values) || values.length === 0) return null;
  return (
    <>
      <h4>{label}</h4>
      <ul className="plain">
        {values.map((value, index) => (
          <li key={index}>
            <code>{typeof value === 'string' ? value : JSON.stringify(value)}</code>
          </li>
        ))}
      </ul>
    </>
  );
}
