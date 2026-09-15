import { useCallback, useState } from 'react';

import { resolvePlayerFactions, type ResolvedPlayer } from '@wardogs/api';

import { describeError } from '../lib/format';
import { useSession } from '../lib/session';

/**
 * The roster, with each player's faction colour resolved.
 *
 * The join is done by the library's `resolvePlayerFactions`, not by hand. The
 * reference is explicit that the colour is the stable faction key across
 * servers, and that a `factionScores[].name` is not promised to be
 * byte-identical to the `faction` string on a player. The helper matches
 * case-insensitively and leaves the colour `undefined` when nothing matches —
 * which the table shows as `(unmatched)` rather than guessing a colour, so a
 * roster that looks wrong looks visibly wrong.
 */
export function PlayersPanel() {
  const session = useSession();

  const [players, setPlayers] = useState<ResolvedPlayer[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      // Two requests, in parallel: the roster and the score rows its colours
      // come from. `GET /v1/status` is the only place `factionScores` appears.
      const [roster, status] = await Promise.all([
        session.call({ method: 'GET', path: '/v1/players', label: 'players' }, (client) =>
          client.players.list(),
        ),
        session.call({ method: 'GET', path: '/v1/status', label: 'faction colours' }, (client) =>
          client.status.get(),
        ),
      ]);
      setPlayers(resolvePlayerFactions(roster, status.factionScores));
    } catch (failure) {
      setError(failure);
    } finally {
      setBusy(false);
    }
  }, [session]);

  const failure = error === null ? null : describeError(error);
  const unmatched = players?.filter((player) => player.factionColorHex === undefined).length ?? 0;

  return (
    <section>
      <div className="row">
        <button type="button" onClick={() => void load()} disabled={busy}>
          {busy ? 'Loading…' : 'Load roster'}
        </button>
      </div>

      {failure !== null && (
        <div className="failure">
          <strong>{failure.title}</strong>
          {failure.detail !== undefined && <p>{failure.detail}</p>}
          {failure.hint !== undefined && <p className="hint">{failure.hint}</p>}
        </div>
      )}

      {players === null ? (
        <p className="empty">No roster loaded yet.</p>
      ) : players.length === 0 ? (
        <p className="empty">Nobody is connected.</p>
      ) : (
        <>
          <table className="data">
            <thead>
              <tr>
                <th>Name</th>
                <th>SteamID64</th>
                <th>Faction</th>
                <th>Kills</th>
                <th>Deaths</th>
                <th>Cash</th>
                <th>Ping</th>
              </tr>
            </thead>
            <tbody>
              {players.map((player) => (
                <tr key={player.steamId}>
                  <td>{player.name}</td>
                  <td>
                    <code>{player.steamId}</code>
                  </td>
                  <td>
                    {player.factionColorHex === undefined ? (
                      <span className="dim">{player.faction} (unmatched)</span>
                    ) : (
                      <span className="swatch">
                        <i style={{ background: player.factionColorHex }} />
                        {player.faction}
                      </span>
                    )}
                  </td>
                  <td>{player.kills}</td>
                  <td>{player.deaths}</td>
                  <td>{player.cash}</td>
                  <td>{player.pingMs} ms</td>
                </tr>
              ))}
            </tbody>
          </table>
          {unmatched > 0 && (
            <p className="hint">
              {unmatched} player{unmatched === 1 ? '' : 's'} matched no <code>factionScores</code>{' '}
              row. The colour is left blank rather than guessed — the server may name the faction
              differently on the roster than in the score table.
            </p>
          )}
        </>
      )}
    </section>
  );
}
