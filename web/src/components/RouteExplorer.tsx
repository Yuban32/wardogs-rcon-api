import { useCallback, useEffect, useMemo, useState } from 'react';

import { isSteamId64, isWardogsError, type RouteId } from '@wardogs/api';

import {
  GROUP_ORDER,
  ROUTE_SPECS,
  buildQuery,
  fillParams,
  routeSpec,
  type RouteSpec,
} from '../lib/routes';
import { byteLength, describeError, formatBytes, formatDuration, stringify } from '../lib/format';
import { renderResponse } from '../lib/renderers';
import { SUCCESS_STATUS, useSession } from '../lib/session';

const DEFAULT_ROUTE: RouteId = 'GET /v1/status';

/** The response, plus what it cost. */
interface Answer {
  data: unknown;
  status: number;
  durationMs: number;
  bytes: number;
}

export function RouteExplorer() {
  const [selected, setSelected] = useState<RouteId>(DEFAULT_ROUTE);
  const spec = routeSpec(selected);

  return (
    <section>
      <div className="row">
        <label>
          Route
          <select value={selected} onChange={(event) => setSelected(event.target.value as RouteId)}>
            {GROUP_ORDER.map((group) => {
              const routes = ROUTE_SPECS.filter((route) => route.group === group);
              if (routes.length === 0) return null;
              return (
                <optgroup key={group} label={group}>
                  {routes.map((route) => (
                    <option key={route.id} value={route.id}>
                      {route.id} — {route.summary}
                    </option>
                  ))}
                </optgroup>
              );
            })}
          </select>
        </label>
      </div>

      <p className="hint">
        All {ROUTE_SPECS.length} operations the API exposes. The list comes from the library&rsquo;s{' '}
        <code>ROUTE_IDS</code>, which its own test suite compares against the vendored spec — so it
        cannot quietly drift from what the server implements.
      </p>

      {/* Keyed by route id, so switching routes resets the form rather than
          carrying the previous route's values into this one. */}
      <RouteForm key={selected} spec={spec} />
    </section>
  );
}

function RouteForm({ spec }: { spec: RouteSpec }) {
  const session = useSession();
  const { method, path: pathTemplate } = useMemo(() => {
    const space = spec.id.indexOf(' ');
    return { method: spec.id.slice(0, space), path: spec.id.slice(space + 1) };
  }, [spec.id]);

  const [params, setParams] = useState<Record<string, string>>(() =>
    Object.fromEntries((spec.params ?? []).map((param) => [param.name, param.value])),
  );
  const [query, setQuery] = useState<Record<string, string>>(() =>
    Object.fromEntries((spec.query ?? []).map((param) => [param.name, param.value])),
  );
  const [body, setBody] = useState(spec.body?.template ?? '');

  const [answer, setAnswer] = useState<Answer | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [supported, setSupported] = useState<boolean | null>(null);

  // Ask the server whether it implements this route. It is a cached call, so
  // switching through the list costs one request at most every 30 seconds.
  useEffect(() => {
    let cancelled = false;
    setSupported(null);
    void session.caps
      .supports(spec.id)
      .then((value) => {
        if (!cancelled) setSupported(value);
      })
      .catch(() => {
        // A failed capability probe is not a reason to block the form — the
        // request itself is still worth trying.
        if (!cancelled) setSupported(null);
      });
    return () => {
      cancelled = true;
    };
  }, [session.caps, spec.id]);

  const preview = useMemo(() => {
    try {
      const path = fillParams(pathTemplate, params);
      const search = new URLSearchParams(buildQuery(query) ?? {}).toString();
      return search === '' ? path : `${path}?${search}`;
    } catch (failure) {
      return failure instanceof Error ? failure.message : String(failure);
    }
  }, [pathTemplate, params, query]);

  const blockedByReadOnly = spec.mutating && session.readOnly;

  const send = useCallback(async () => {
    setLocalError(null);
    setError(null);
    setBusy(true);

    const started = performance.now();
    try {
      // Only the JSON channel is reachable from here: `client.request()` encodes
      // a body as JSON, and the two `text/plain` config routes have their own
      // panel. Guard rather than silently sending something else.
      if (spec.body?.kind === 'text') {
        throw new Error('This route takes a text/plain body — use the Config tab.');
      }

      const resolvedPath = fillParams(pathTemplate, params);
      const trimmed = body.trim();
      const payload: unknown =
        trimmed === '' ? undefined : spec.body?.kind === 'json' ? JSON.parse(trimmed) : trimmed;

      const data = await session.call({ method, path: resolvedPath, label: spec.id }, (client) =>
        client.request(method, resolvedPath, {
          ...(buildQuery(query) !== undefined ? { query: buildQuery(query) } : {}),
          ...(payload !== undefined ? { body: payload } : {}),
        }),
      );

      setAnswer({
        data,
        status: SUCCESS_STATUS,
        durationMs: performance.now() - started,
        bytes: byteLength(stringify(data)),
      });
    } catch (failure) {
      if (failure instanceof SyntaxError) {
        // Caught before the request: a body that is not JSON. Saying so here is
        // clearer than the parse error the client would raise on the way out.
        setLocalError(`The request body is not valid JSON: ${failure.message}`);
      } else {
        setError(failure);
      }
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  }, [body, method, params, pathTemplate, query, session, spec.body?.kind, spec.id]);

  const attempt = () => {
    setLocalError(null);

    for (const param of spec.params ?? []) {
      const value = params[param.name] ?? '';
      if (value.trim() === '') {
        setLocalError(`Missing value for {${param.name}}.`);
        return;
      }
      // SteamIDs are the one parameter the panel can sanity-check before
      // sending. A SteamID64 is a 17-digit string and exceeds
      // Number.MAX_SAFE_INTEGER, so one that has been through a number is a
      // valid-looking id belonging to somebody else.
      if (param.kind === 'steamId' && !isSteamId64(value.trim())) {
        setLocalError(
          `"${value.trim()}" is not an individual-account SteamID64. It must be a string in the 7656119… range.`,
        );
        return;
      }
    }

    if (spec.owner === 'config') {
      setLocalError('This route takes a text/plain body — use the Config tab.');
      return;
    }

    if (spec.mutating && session.readOnly) {
      setLocalError('The panel is in read-only mode. Uncheck it to send writes.');
      return;
    }

    // A write gets a second look. The panel is pointed at a live server, and
    // every one of these routes changes something a player can see.
    if (spec.mutating && !confirming) {
      setConfirming(true);
      return;
    }

    void send();
  };

  const failure = error === null ? null : describeError(error);

  return (
    <>
      <div className="route-head">
        <code className={spec.mutating ? 'method write' : 'method'}>{method}</code>
        <code>{pathTemplate}</code>
        <span className="dim">{spec.summary}</span>
        {spec.mutating && <span className="tag write">changes state</span>}
        {supported === false && <span className="tag">not advertised</span>}
        {supported === true && <span className="tag ok">advertised</span>}
      </div>

      {spec.owner === 'config' && (
        <p className="note">
          This route carries the INI document as <code>text/plain</code>, which{' '}
          <code>client.request()</code> cannot send. Use the <strong>Config</strong> tab — it reads
          the document, sends edits back with the revision, and handles the 412.
        </p>
      )}

      {supported === false && (
        <p className="hint">
          <code>GET /v1/capabilities</code> does not list this route on this server. Not every
          server enables every operation — the reference asks callers to check here rather than
          assume. Sending it anyway is allowed, and will most likely fail.
        </p>
      )}

      {(spec.params ?? []).length > 0 && (
        <div className="row">
          {(spec.params ?? []).map((param) => (
            <label key={param.name}>
              {param.label}
              <input
                value={params[param.name] ?? ''}
                spellCheck={false}
                onChange={(event) =>
                  setParams((previous) => ({ ...previous, [param.name]: event.target.value }))
                }
              />
            </label>
          ))}
        </div>
      )}

      {(spec.query ?? []).length > 0 && (
        <div className="row">
          {(spec.query ?? []).map((param) => (
            <label key={param.name}>
              {param.label}
              <input
                value={query[param.name] ?? ''}
                spellCheck={false}
                onChange={(event) =>
                  setQuery((previous) => ({ ...previous, [param.name]: event.target.value }))
                }
              />
            </label>
          ))}
        </div>
      )}

      {spec.body !== undefined && spec.owner !== 'config' && (
        <label className="stack">
          Request body {spec.body.kind === 'json' ? '(JSON)' : '(text)'} — leave empty to send none
          <textarea
            rows={6}
            spellCheck={false}
            value={body}
            onChange={(event) => setBody(event.target.value)}
          />
        </label>
      )}

      <p className="hint">
        <code>
          {method} {preview}
        </code>
      </p>

      <div className="row">
        <button
          type="button"
          className={confirming ? 'danger' : 'primary'}
          disabled={busy || spec.owner === 'config'}
          onClick={attempt}
        >
          {busy
            ? 'Sending…'
            : confirming
              ? `Confirm ${method} — this changes server state`
              : 'Send'}
        </button>
        {confirming && (
          <button type="button" onClick={() => setConfirming(false)}>
            Cancel
          </button>
        )}
      </div>

      {localError !== null && <p className="failure">{localError}</p>}

      {failure !== null && (
        <div className="failure">
          <strong>{failure.title}</strong>
          {failure.detail !== undefined && <p>{failure.detail}</p>}
          {failure.hint !== undefined && <p className="hint">{failure.hint}</p>}
          {error instanceof Error && isWardogsError(error) && (
            <p className="hint dim">{error.name}</p>
          )}
        </div>
      )}

      {answer !== null && (
        <>
          <p className="note">
            {answer.status} · {formatDuration(answer.durationMs)} · {formatBytes(answer.bytes)}
          </p>
          {renderResponse(spec.id, answer.data)}
        </>
      )}
    </>
  );
}
