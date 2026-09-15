/**
 * Semantic response rendering.
 *
 * The explorer sends raw requests through `client.request()`, so what arrives
 * here is whatever the server sent — including the envelopes the typed client
 * methods unwrap (`{ players: [...] }` rather than `[...]`). Every reader below
 * therefore accepts either shape; being strict about that would mean the panel
 * renders an empty table for a perfectly good response.
 *
 * A route with no renderer falls back to pretty-printed JSON, which is the
 * honest answer for the catalog endpoints whose shape the spec leaves open.
 */

import type { ReactNode } from 'react';

import { type RouteId } from '@wardogs/api';

import { stringify } from './format';

/* -------------------------------------------------------------------------- */
/* Reading unknown JSON                                                        */
/* -------------------------------------------------------------------------- */

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** `{ players: [...] }` or a bare `[...]` — both mean the same list. */
function readList(data: unknown, key: string): unknown[] {
  const record = asRecord(data);
  const value = record === null ? data : record[key];
  return Array.isArray(value) ? value : [];
}

function text(value: unknown): string {
  if (value === undefined || value === null) return '—';
  if (typeof value === 'string') return value === '' ? '—' : value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return stringify(value);
}

function row(value: unknown): Record<string, unknown> {
  return asRecord(value) ?? {};
}

/* -------------------------------------------------------------------------- */
/* Small presentational pieces                                                 */
/* -------------------------------------------------------------------------- */

function Table({ head, rows }: { head: string[]; rows: ReactNode[][] }): ReactNode {
  if (rows.length === 0) return <p className="empty">Empty list.</p>;
  return (
    <table className="data">
      <thead>
        <tr>
          {head.map((column) => (
            <th key={column}>{column}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((cells, index) => (
          // Rows are a fixed-position snapshot of one response; there is no
          // stable id for most of them, and nothing reorders in place.
          <tr key={index}>
            {cells.map((cell, cellIndex) => (
              <td key={cellIndex}>{cell}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Fields({ entries }: { entries: [string, ReactNode][] }): ReactNode {
  return (
    <dl className="fields">
      {entries.map(([label, value]) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function Swatch({ colour }: { colour: string }): ReactNode {
  return (
    <span className="swatch">
      <i style={{ background: colour }} />
      {colour}
    </span>
  );
}

/* -------------------------------------------------------------------------- */
/* Renderers                                                                   */
/* -------------------------------------------------------------------------- */

function StatusView({ data }: { data: unknown }): ReactNode {
  const status = row(data);
  const players = row(status['players']);
  const scoreTick = row(status['scoreTick']);
  const rotation = status['rotation'] === null ? null : asRecord(status['rotation']);
  const factions = readList(status['factionScores'], 'factionScores');

  return (
    <>
      <Fields
        entries={[
          ['Server', text(status['serverName'])],
          ['Map', text(status['map'])],
          ['Lighting', text(status['lighting'])],
          ['Alternator', text(status['alternator'])],
          ['Players', `${text(players['current'])} / ${text(players['max'])}`],
          [
            'Score tick',
            `${text(scoreTick['current'])}s (range ${text(scoreTick['min'])}–${text(scoreTick['max'])})`,
          ],
          ['Score cap', text(status['scoreCap'])],
          ['In match', `${text(status['matchSeconds'])}s`],
          [
            'Rotation',
            rotation === null
              ? 'none configured'
              : `now #${text(rotation['nowIndex'])}, next #${text(rotation['nextIndex'])}`,
          ],
          [
            'Experiences',
            readList(status['experiences'], 'experiences').map(text).join(', ') || '—',
          ],
        ]}
      />
      {factions.length > 0 && (
        <>
          <h4>Factions</h4>
          <Table
            head={['Name', 'Colour']}
            rows={factions.map((faction) => {
              const entry = row(faction);
              return [text(entry['name']), <Swatch colour={text(entry['colorHex'])} />];
            })}
          />
        </>
      )}
    </>
  );
}

function PlayersView({ data }: { data: unknown }): ReactNode {
  const players = readList(data, 'players');
  return (
    <Table
      head={['Name', 'SteamID64', 'Faction', 'Kills', 'Deaths', 'Cash', 'Ping']}
      rows={players.map((player) => {
        const entry = row(player);
        return [
          text(entry['name']),
          <code>{text(entry['steamId'])}</code>,
          text(entry['faction']),
          text(entry['kills']),
          text(entry['deaths']),
          text(entry['cash']),
          `${text(entry['pingMs'])} ms`,
        ];
      })}
    />
  );
}

function BansView({ data }: { data: unknown }): ReactNode {
  const bans = readList(data, 'bans');
  return (
    <Table
      head={['SteamID64', 'Banned at', 'By', 'Reason']}
      rows={bans.map((ban) => {
        const entry = row(ban);
        return [
          <code>{text(entry['steamId'])}</code>,
          text(entry['bannedAtUtc']),
          text(entry['bannedBy']),
          text(entry['reason']),
        ];
      })}
    />
  );
}

function ReservedSlotsView({ data }: { data: unknown }): ReactNode {
  const slots = readList(data, 'reservedSlots');
  if (slots.length === 0) return <p className="empty">No reserved slots.</p>;
  return (
    <ul className="plain">
      {slots.map((slot, index) => (
        <li key={index}>
          <code>{text(slot)}</code>
        </li>
      ))}
    </ul>
  );
}

function AuditView({ data }: { data: unknown }): ReactNode {
  const entries = readList(data, 'entries');
  return (
    <Table
      head={['Timestamp', 'Event', 'Peer', 'Detail']}
      rows={entries.map((item) => {
        const entry = row(item);
        return [
          text(entry['timestampUtc']),
          text(entry['event']),
          text(entry['peer']),
          text(entry['detail']),
        ];
      })}
    />
  );
}

function RotationView({ data }: { data: unknown }): ReactNode {
  const rotation = row(data);
  const entries = readList(rotation['entries'], 'entries');

  return (
    <>
      <Fields
        entries={[
          ['Enabled', text(rotation['enabled'])],
          ['Mode', text(rotation['mode'])],
        ]}
      />
      <Table
        head={['#', 'Map', 'Experiences', 'Lighting', 'Zone alternator', 'Status']}
        rows={entries.map((item, index) => {
          const entry = row(item);
          return [
            String(index),
            text(entry['map']),
            readList(entry['experiences'], 'experiences').map(text).join(' + ') || '—',
            text(entry['lighting']),
            text(entry['zoneAlternator']),
            entry['denied'] === true ? `${text(entry['status'])} (denied)` : text(entry['status']),
          ];
        })}
      />
      <p className="note">
        Edits change the live rotation only. <code>POST /v1/rotation/save</code> is what writes them
        to <code>ServerSettings.ini</code>.
      </p>
    </>
  );
}

function CapabilitiesView({ data }: { data: unknown }): ReactNode {
  const capabilities = row(data);
  const routes = readList(capabilities['routes'], 'routes');
  const config = row(capabilities['config']);

  return (
    <>
      <Fields
        entries={[
          ['Routes advertised', String(routes.length)],
          ['Config writable', text(config['writable'])],
        ]}
      />
      <ul className="plain">
        {routes.map((route, index) => (
          <li key={index}>
            <code>{text(route)}</code>
          </li>
        ))}
      </ul>
    </>
  );
}

function SponsorView({ data }: { data: unknown }): ReactNode {
  const sponsor = row(data);
  const imageUrl = text(sponsor['imageUrl']);
  return (
    <Fields entries={[['Image URL', imageUrl === '—' ? '—' : <a href={imageUrl}>{imageUrl}</a>]]} />
  );
}

function ConfigView({ data }: { data: unknown }): ReactNode {
  const config = row(data);
  const document = text(config['text']);
  return (
    <>
      <Fields
        entries={[
          ['Revision', <code>{text(config['revision'])}</code>],
          ['Writable', text(config['writable'])],
          ['Lines', String(document.split('\n').length)],
        ]}
      />
      <p className="note">
        Editing and applying happens in the <strong>Config</strong> tab, which can send{' '}
        <code>text/plain</code> and a revision.
      </p>
      <pre className="body">{document}</pre>
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* Dispatch                                                                    */
/* -------------------------------------------------------------------------- */

const RENDERERS: Partial<Record<RouteId, (props: { data: unknown }) => ReactNode>> = {
  'GET /v1/status': StatusView,
  'GET /v1/players': PlayersView,
  'GET /v1/bans': BansView,
  'GET /v1/reserved-slots': ReservedSlotsView,
  'GET /v1/audit': AuditView,
  'GET /v1/rotation': RotationView,
  'GET /v1/capabilities': CapabilitiesView,
  'GET /v1/sponsor': SponsorView,
  'GET /v1/config': ConfigView,
};

/** The body of a response, rendered for the route that produced it. */
export function renderResponse(id: RouteId, data: unknown): ReactNode {
  const Renderer = RENDERERS[id];
  if (Renderer !== undefined) return <Renderer data={data} />;
  return <pre className="body">{stringify(data)}</pre>;
}
