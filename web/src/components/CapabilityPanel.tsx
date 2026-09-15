import { useCallback, useState } from 'react';

import { routeMatches, type Capabilities } from '@wardogs/api';

import { describeError } from '../lib/format';
import { GROUP_ORDER, ROUTE_SPECS } from '../lib/routes';
import { useSession } from '../lib/session';

/**
 * Which of the 35 operations this particular server implements.
 *
 * Not every server enables every route, and the reference says the admin panel
 * gates its own UI on exactly this call — offering "change faction" only when
 * `PATCH /v1/players/{id}` is in the list. So this is not a diagnostic screen;
 * it is the answer to why a button is greyed out on another one.
 *
 * The comparison goes through the library's `routeMatches`, which collapses
 * path-parameter names. That is not a detail: the spec writes `{steamId}` and
 * the reference's prose writes `{id}`, and a literal comparison reports a
 * route the server plainly supports as missing. Where the server's own
 * spelling differs, it is shown.
 */
export function CapabilityPanel() {
  const session = useSession();

  const [capabilities, setCapabilities] = useState<Capabilities | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(
    async (force: boolean) => {
      setBusy(true);
      setError(null);
      try {
        // `force` re-fetches rather than answering from the probe's 30s cache —
        // capabilities change when the server is reconfigured and restarted.
        const next = await session.call(
          { method: 'GET', path: '/v1/capabilities', label: 'capabilities' },
          (client) => client.meta.capabilities(),
        );
        if (force) session.caps.clear();
        setCapabilities(next);
      } catch (failure) {
        setError(failure);
      } finally {
        setBusy(false);
      }
    },
    [session],
  );

  const failure = error === null ? null : describeError(error);
  const advertised = capabilities?.routes ?? [];

  return (
    <section>
      <div className="row">
        <button type="button" onClick={() => void load(false)} disabled={busy}>
          {busy ? 'Loading…' : 'Load capabilities'}
        </button>
        <button type="button" onClick={() => void load(true)} disabled={busy}>
          Refresh (drop cache)
        </button>
      </div>

      {failure !== null && (
        <div className="failure">
          <strong>{failure.title}</strong>
          {failure.detail !== undefined && <p>{failure.detail}</p>}
          {failure.hint !== undefined && <p className="hint">{failure.hint}</p>}
        </div>
      )}

      {capabilities === null ? (
        <p className="empty">Nothing loaded yet.</p>
      ) : (
        <>
          <dl className="fields">
            <div>
              <dt>Routes advertised</dt>
              <dd>
                {advertised.length} of {ROUTE_SPECS.length}
              </dd>
            </div>
            <div>
              <dt>Config writable</dt>
              <dd>
                {capabilities.config?.writable === true ? (
                  <span className="ok">true</span>
                ) : (
                  <span className="dim">
                    false — <code>PUT /v1/config</code> would be refused
                  </span>
                )}
              </dd>
            </div>
          </dl>

          <table className="data">
            <thead>
              <tr>
                <th>Route</th>
                <th>Group</th>
                <th>Supported</th>
                <th>As the server spells it</th>
              </tr>
            </thead>
            <tbody>
              {GROUP_ORDER.flatMap((group) =>
                ROUTE_SPECS.filter((spec) => spec.group === group).map((spec) => {
                  const match = advertised.find((route) => routeMatches(spec.id, route));
                  return (
                    <tr key={spec.id}>
                      <td>
                        <code>{spec.id}</code>
                      </td>
                      <td className="dim">{spec.group}</td>
                      <td>
                        {match === undefined ? (
                          <span className="dim">—</span>
                        ) : (
                          <span className="ok">yes</span>
                        )}
                      </td>
                      <td>
                        {match !== undefined && match !== spec.id ? (
                          <code className="dim">{match}</code>
                        ) : (
                          <span className="dim">same</span>
                        )}
                      </td>
                    </tr>
                  );
                }),
              )}
            </tbody>
          </table>
        </>
      )}
    </section>
  );
}
