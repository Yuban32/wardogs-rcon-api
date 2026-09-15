/**
 * Request-construction tests for all 35 operations.
 *
 * Every operation is asserted on its wire representation — method, path, query,
 * headers and body — rather than on its parsed return value. That is where the
 * bugs actually live: a wrong path segment, a missing content type, a body sent
 * as JSON to a `text/plain` endpoint, an `If-Match` that is not quoted the way
 * the reference documents.
 */

import { beforeEach, describe, expect, it } from 'vitest';

import { createClient, ROUTE_IDS, type WardogsClient } from '../src/index.js';
import {
  createRecordingFetch,
  parseRequest,
  playerPayload,
  statusPayload,
  type RecordingFetch,
} from './helpers.js';

const BASE = 'https://my-server.example:7776';
const TOKEN = 'rcon-password-123';

let rec: RecordingFetch;
let client: WardogsClient;

function ok(body: unknown = { ok: true }): { body: unknown } {
  return { body };
}

beforeEach(() => {
  rec = createRecordingFetch();
  client = createClient({ baseUrl: BASE, token: TOKEN, fetch: rec.fetch, retries: 0 });
});

/* -------------------------------------------------------------------------- */
/* Connection                                                                  */
/* -------------------------------------------------------------------------- */

describe('client configuration', () => {
  it('uses the configured base URL', () => {
    expect(client.baseUrl).toBe(BASE);
  });

  it('strips a trailing slash so paths never double up', () => {
    const trimmed = createClient({ baseUrl: `${BASE}/`, token: TOKEN, fetch: rec.fetch });
    expect(trimmed.baseUrl).toBe(BASE);
  });

  it('sends the token as a bearer header', async () => {
    rec.setResponses([{ body: statusPayload() }]);
    await client.status.get();
    expect(rec.last().headers['Authorization']).toBe(`Bearer ${TOKEN}`);
  });

  it('rejects an empty token at construction, not at first request', () => {
    // The token is the only credential and there is no login step, so an empty
    // one produces a 401 somewhere far from the configuration that caused it.
    expect(() => createClient({ baseUrl: BASE, token: '' })).toThrow(/token/);
    expect(() => createClient({ baseUrl: BASE, token: '   ' })).toThrow(/token/);
  });

  it('rejects plaintext http to a remote host, and explains why', () => {
    // A network-bound RCON listener refuses to start without TLS, so this can
    // never connect. Reporting it as a config error beats a socket error.
    expect(() => createClient({ baseUrl: 'http://my-server.example:7776', token: TOKEN })).toThrow(
      /plaintext http/i,
    );
  });

  it('allows plaintext http to loopback, where it is legitimate', () => {
    for (const host of ['127.0.0.1', 'localhost', '127.0.0.5']) {
      expect(() => createClient({ baseUrl: `http://${host}:7776`, token: TOKEN })).not.toThrow();
    }
  });

  it('allows http to a remote host only when explicitly permitted', () => {
    expect(() =>
      createClient({
        baseUrl: 'http://my-server.example:7776',
        token: TOKEN,
        allowInsecureHttp: true,
      }),
    ).not.toThrow();
  });

  it('rejects an unusable base URL', () => {
    expect(() => createClient({ baseUrl: 'not a url', token: TOKEN })).toThrow(/baseUrl/);
    expect(() => createClient({ baseUrl: 'ftp://host:1', token: TOKEN })).toThrow(/protocol/);
  });

  it('rejects a negative timeout or retry count', () => {
    expect(() => createClient({ baseUrl: BASE, token: TOKEN, timeoutMs: -1 })).toThrow(/timeoutMs/);
    expect(() => createClient({ baseUrl: BASE, token: TOKEN, retries: -2 })).toThrow(/retries/);
  });
});

/* -------------------------------------------------------------------------- */
/* Every operation                                                             */
/* -------------------------------------------------------------------------- */

describe('match state', () => {
  it('GET /v1/status', async () => {
    rec.setResponses([{ body: statusPayload() }]);
    const status = await client.status.get();

    expect(rec.last().method).toBe('GET');
    expect(parseRequest(rec.last()).path).toBe('/v1/status');
    expect(status.serverName).toBe('Test Server');
    expect(status.players.current).toBe(3);
  });
});

describe('players', () => {
  it('GET /v1/players unwraps the players array', async () => {
    rec.setResponses([{ body: { players: [playerPayload()] } }]);
    const players = await client.players.list();

    expect(parseRequest(rec.last()).path).toBe('/v1/players');
    expect(players).toHaveLength(1);
    expect(players[0]?.steamId).toBe('76561198000000001');
  });

  it('GET /v1/players tolerates a missing players key', async () => {
    rec.setResponses([{ body: {} }]);
    await expect(client.players.list()).resolves.toEqual([]);
  });

  it('POST /v1/players/{steamId}/kick with a reason', async () => {
    rec.setResponses([ok()]);
    await client.players.kick('76561198000000001', 'teamkilling');

    const request = parseRequest(rec.last());
    expect(rec.last().method).toBe('POST');
    expect(request.path).toBe('/v1/players/76561198000000001/kick');
    expect(request.body).toEqual({ reason: 'teamkilling' });
    expect(rec.last().headers['Content-Type']).toBe('application/json');
  });

  it('POST /v1/players/{steamId}/kick omits reason when not given', async () => {
    rec.setResponses([ok()]);
    await client.players.kick('76561198000000001');

    // An explicit `reason: undefined` would serialize to `{}` either way, but
    // omitting the key keeps the payload exactly what the reference shows.
    expect(parseRequest(rec.last()).body).toEqual({});
  });

  it('POST /v1/players/{steamId}/kill sends no body', async () => {
    rec.setResponses([ok()]);
    await client.players.kill('76561198000000001');

    const request = parseRequest(rec.last());
    expect(request.path).toBe('/v1/players/76561198000000001/kill');
    expect(rec.last().body).toBeUndefined();
    expect(rec.last().headers['Content-Type']).toBeUndefined();
  });

  it('POST /v1/players/{steamId}/message', async () => {
    rec.setResponses([ok()]);
    await client.players.message('76561198000000001', 'regroup at B');

    expect(parseRequest(rec.last()).path).toBe('/v1/players/76561198000000001/message');
    expect(parseRequest(rec.last()).body).toEqual({ message: 'regroup at B' });
  });

  it('PATCH /v1/players/{steamId} changes faction', async () => {
    rec.setResponses([ok()]);
    await client.players.setFaction('76561198000000001', 'RUS');

    expect(rec.last().method).toBe('PATCH');
    expect(parseRequest(rec.last()).path).toBe('/v1/players/76561198000000001');
    expect(parseRequest(rec.last()).body).toEqual({ faction: 'RUS' });
  });

  it('escapes a path segment rather than splicing it in raw', async () => {
    rec.setResponses([ok()]);
    await client.players.kick('a/b?c');

    expect(parseRequest(rec.last()).path).toBe('/v1/players/a%2Fb%3Fc/kick');
  });
});

describe('moderation', () => {
  it('GET /v1/bans unwraps the bans array', async () => {
    rec.setResponses([
      {
        body: {
          bans: [
            {
              steamId: '76561198000000009',
              bannedAtUtc: '2026-09-01T12:00:00Z',
              bannedBy: 'admin',
              reason: 'cheating',
            },
          ],
        },
      },
    ]);

    const bans = await client.bans.list();
    expect(parseRequest(rec.last()).path).toBe('/v1/bans');
    expect(bans).toHaveLength(1);
    expect(bans[0]?.reason).toBe('cheating');
  });

  it('POST /v1/bans with a reason', async () => {
    rec.setResponses([ok()]);
    await client.bans.add('76561198000000009', 'cheating');

    expect(rec.last().method).toBe('POST');
    expect(parseRequest(rec.last()).path).toBe('/v1/bans');
    expect(parseRequest(rec.last()).body).toEqual({
      steamId: '76561198000000009',
      reason: 'cheating',
    });
  });

  it('POST /v1/bans without a reason still sends the steamId', async () => {
    rec.setResponses([ok()]);
    await client.bans.add('76561198000000009');

    expect(parseRequest(rec.last()).body).toEqual({ steamId: '76561198000000009' });
  });

  it('DELETE /v1/bans/{steamId}', async () => {
    rec.setResponses([ok()]);
    await client.bans.remove('76561198000000009');

    expect(rec.last().method).toBe('DELETE');
    expect(parseRequest(rec.last()).path).toBe('/v1/bans/76561198000000009');
  });

  it('GET /v1/reserved-slots unwraps the array', async () => {
    rec.setResponses([{ body: { reservedSlots: ['76561198000000002'] } }]);
    const slots = await client.reservedSlots.list();

    expect(parseRequest(rec.last()).path).toBe('/v1/reserved-slots');
    expect(slots).toEqual(['76561198000000002']);
  });

  it('POST /v1/reserved-slots', async () => {
    rec.setResponses([ok()]);
    await client.reservedSlots.add('76561198000000002');

    expect(parseRequest(rec.last()).path).toBe('/v1/reserved-slots');
    expect(parseRequest(rec.last()).body).toEqual({ steamId: '76561198000000002' });
  });

  it('DELETE /v1/reserved-slots/{steamId}', async () => {
    rec.setResponses([ok()]);
    await client.reservedSlots.remove('76561198000000002');

    expect(rec.last().method).toBe('DELETE');
    expect(parseRequest(rec.last()).path).toBe('/v1/reserved-slots/76561198000000002');
  });
});

describe('meta', () => {
  it('GET /v1/audit sends limit as a query parameter', async () => {
    rec.setResponses([{ body: { entries: [] } }]);
    await client.audit.list(10);

    const request = parseRequest(rec.last());
    expect(request.path).toBe('/v1/audit');
    expect(request.query).toEqual({ limit: '10' });
  });

  it('GET /v1/audit omits limit when not given', async () => {
    rec.setResponses([{ body: { entries: [] } }]);
    await client.audit.list();

    expect(parseRequest(rec.last()).query).toEqual({});
  });

  it('GET /v1/capabilities', async () => {
    rec.setResponses([{ body: { routes: ['GET /v1/status'], config: { writable: true } } }]);

    const capabilities = await client.meta.capabilities();
    expect(parseRequest(rec.last()).path).toBe('/v1/capabilities');
    expect(capabilities.config.writable).toBe(true);
  });

  it('GET /v1/capabilities reads the fields spec 1.1.0 added', async () => {
    // A build old enough to predate these omits them; the point here is that
    // they pass through untouched when present rather than being dropped.
    rec.setResponses([
      {
        body: {
          apiVersion: '1',
          build: '++Wardogs+Live-CL-501228',
          auth: { scheme: 'bearer', header: 'Authorization' },
          limits: { maxBodyBytes: 65536, maxRequestsPerMinutePerIp: 120 },
          config: { writable: true, document: '/v1/config' },
          routes: ['GET /v1/health'],
        },
      },
    ]);

    const capabilities = await client.meta.capabilities();
    expect(capabilities.build).toBe('++Wardogs+Live-CL-501228');
    expect(capabilities.limits?.maxBodyBytes).toBe(65536);
    expect(capabilities.config.document).toBe('/v1/config');
  });

  it('GET /v1/server-id', async () => {
    rec.setResponses([{ body: { serverId: 'srv_abc123' } }]);

    const { serverId } = await client.meta.serverId();
    const request = parseRequest(rec.last());
    expect(request.path).toBe('/v1/server-id');
    expect(rec.last().method).toBe('GET');
    expect(request.body).toBeUndefined();
    expect(serverId).toBe('srv_abc123');
  });

  it('GET /v1/health', async () => {
    rec.setResponses([
      {
        body: {
          status: 'ok',
          uptimeSeconds: 3600,
          connections: { active: 3 },
          gameThreadQueue: { inFlight: 1, depth: 2, rejectedTotal: 0 },
        },
      },
    ]);

    const health = await client.meta.health();
    expect(parseRequest(rec.last()).path).toBe('/v1/health');
    expect(health.gameThreadQueue.depth).toBe(2);
    expect(health.connections.active).toBe(3);
  });
});

describe('match control', () => {
  it('POST /v1/broadcast', async () => {
    rec.setResponses([ok()]);
    await client.broadcast('restarting in 5');

    expect(parseRequest(rec.last()).path).toBe('/v1/broadcast');
    expect(parseRequest(rec.last()).body).toEqual({ message: 'restarting in 5' });
  });

  it('POST /v1/match/map sends the full selection', async () => {
    rec.setResponses([ok()]);
    await client.match.setMap({
      map: 'Kavkazi',
      experiences: ['Bakurani_KOTH_01'],
      lighting: 'DayClear',
      zoneAlternator: 'ZoneAlternator.Factory.Circle',
    });

    expect(parseRequest(rec.last()).path).toBe('/v1/match/map');
    expect(parseRequest(rec.last()).body).toEqual({
      map: 'Kavkazi',
      experiences: ['Bakurani_KOTH_01'],
      lighting: 'DayClear',
      zoneAlternator: 'ZoneAlternator.Factory.Circle',
    });
  });

  it('POST /v1/match/map sends only what was given', async () => {
    rec.setResponses([ok()]);
    await client.match.setMap({ map: 'Europe' });

    // Unset keys must be absent, not null: the server falls back to the map's
    // authored defaults for whatever is missing.
    expect(parseRequest(rec.last()).body).toEqual({ map: 'Europe' });
  });

  it('POST /v1/match/end', async () => {
    rec.setResponses([ok()]);
    await client.match.end();

    expect(rec.last().method).toBe('POST');
    expect(parseRequest(rec.last()).path).toBe('/v1/match/end');
    expect(rec.last().body).toBeUndefined();
  });

  it('POST /v1/match/restart', async () => {
    rec.setResponses([ok()]);
    await client.match.restart();

    expect(parseRequest(rec.last()).path).toBe('/v1/match/restart');
  });

  it('PUT /v1/world/lighting', async () => {
    rec.setResponses([ok()]);
    await client.world.setLighting('DayLateGray');

    expect(rec.last().method).toBe('PUT');
    expect(parseRequest(rec.last()).path).toBe('/v1/world/lighting');
    expect(parseRequest(rec.last()).body).toEqual({ lighting: 'DayLateGray' });
  });
});

describe('rotation', () => {
  it('GET /v1/rotation', async () => {
    rec.setResponses([
      {
        body: {
          enabled: true,
          mode: 'ordered',
          entries: [
            {
              map: 'Kavkazi',
              experiences: ['Bakurani_KOTH_01'],
              lighting: 'DayClear',
              zoneAlternator: '',
              status: 'now',
              denied: false,
            },
          ],
        },
      },
    ]);

    const rotation = await client.rotation.get();
    expect(parseRequest(rec.last()).path).toBe('/v1/rotation');
    expect(rotation.mode).toBe('ordered');
    expect(rotation.entries[0]?.status).toBe('now');
  });

  it('POST /v1/rotation/entries', async () => {
    rec.setResponses([ok()]);
    await client.rotation.addEntry({ map: 'Europe', lighting: 'DayLateGray' });

    expect(parseRequest(rec.last()).path).toBe('/v1/rotation/entries');
    expect(parseRequest(rec.last()).body).toEqual({
      map: 'Europe',
      lighting: 'DayLateGray',
    });
  });

  it('DELETE /v1/rotation/entries/{i}', async () => {
    rec.setResponses([ok()]);
    await client.rotation.removeEntry(2);

    expect(rec.last().method).toBe('DELETE');
    expect(parseRequest(rec.last()).path).toBe('/v1/rotation/entries/2');
  });

  it('POST /v1/rotation/entries/{i}/move', async () => {
    rec.setResponses([ok()]);
    await client.rotation.moveEntry(1, 'up');

    expect(parseRequest(rec.last()).path).toBe('/v1/rotation/entries/1/move');
    expect(parseRequest(rec.last()).body).toEqual({ direction: 'up' });
  });

  it('POST /v1/rotation/save', async () => {
    rec.setResponses([ok()]);
    await client.rotation.save();

    expect(parseRequest(rec.last()).path).toBe('/v1/rotation/save');
  });
});

describe('settings', () => {
  it('PATCH /v1/settings sends only the provided keys', async () => {
    rec.setResponses([ok()]);
    await client.settings.patch({ scoreTick: 24, rotationMode: 'random' });

    expect(rec.last().method).toBe('PATCH');
    expect(parseRequest(rec.last()).path).toBe('/v1/settings');
    expect(parseRequest(rec.last()).body).toEqual({
      scoreTick: 24,
      rotationMode: 'random',
    });
  });

  it('PATCH /v1/settings accepts an empty patch', async () => {
    rec.setResponses([ok()]);
    await client.settings.patch({});

    expect(parseRequest(rec.last()).body).toEqual({});
  });
});

describe('catalog', () => {
  it('GET /v1/catalog/maps', async () => {
    rec.setResponses([{ body: { maps: ['Kavkazi', 'Europe'] } }]);
    await client.catalog.maps();

    expect(parseRequest(rec.last()).path).toBe('/v1/catalog/maps');
  });

  it('GET /v1/catalog/lightings', async () => {
    rec.setResponses([{ body: {} }]);
    await client.catalog.lightings();

    expect(parseRequest(rec.last()).path).toBe('/v1/catalog/lightings');
  });

  it('GET /v1/catalog/experiences', async () => {
    rec.setResponses([{ body: {} }]);
    await client.catalog.experiences();

    expect(parseRequest(rec.last()).path).toBe('/v1/catalog/experiences');
  });

  it('GET /v1/catalog/maps/{id}/experiences', async () => {
    rec.setResponses([{ body: { ok: true, experiences: ['Bakurani_KOTH_01'] } }]);
    const result = await client.catalog.mapExperiences('Kavkazi');

    expect(parseRequest(rec.last()).path).toBe('/v1/catalog/maps/Kavkazi/experiences');
    expect(result.experiences).toEqual(['Bakurani_KOTH_01']);
  });

  it('GET /v1/catalog/maps/{id}/alternators', async () => {
    rec.setResponses([{ body: { ok: true, alternators: ['ZoneAlternator.Factory.Circle'] } }]);
    const result = await client.catalog.mapAlternators('Kavkazi');

    expect(parseRequest(rec.last()).path).toBe('/v1/catalog/maps/Kavkazi/alternators');
    expect(result.alternators).toEqual(['ZoneAlternator.Factory.Circle']);
  });

  it('escapes a map id that contains a slash', async () => {
    rec.setResponses([{ body: {} }]);
    await client.catalog.mapExperiences('a/b');

    expect(parseRequest(rec.last()).path).toBe('/v1/catalog/maps/a%2Fb/experiences');
  });
});

describe('sponsor', () => {
  it('GET /v1/sponsor', async () => {
    rec.setResponses([{ body: { imageUrl: 'https://cdn.example/banner.png' } }]);
    const sponsor = await client.sponsor.get();

    expect(parseRequest(rec.last()).path).toBe('/v1/sponsor');
    expect(sponsor.imageUrl).toBe('https://cdn.example/banner.png');
  });

  it('PUT /v1/sponsor', async () => {
    rec.setResponses([ok()]);
    await client.sponsor.set('https://cdn.example/banner.png');

    expect(rec.last().method).toBe('PUT');
    expect(parseRequest(rec.last()).path).toBe('/v1/sponsor');
    expect(parseRequest(rec.last()).body).toEqual({
      imageUrl: 'https://cdn.example/banner.png',
    });
  });
});

describe('config', () => {
  it('GET /v1/config', async () => {
    rec.setResponses([
      {
        body: {
          revision: 'abc123',
          writable: true,
          text: '[/Script/WDRCON.WDRCONSettings]\nbEnabled=true',
          sections: [],
          warnings: [],
        },
      },
    ]);

    const config = await client.config.get();
    expect(parseRequest(rec.last()).path).toBe('/v1/config');
    expect(config.revision).toBe('abc123');
  });

  it('PUT /v1/config sends text/plain, not JSON', async () => {
    rec.setResponses([{ body: { ok: true, revision: 'def456' } }]);
    await client.config.apply('[A]\nkey=value');

    const request = parseRequest(rec.last());
    expect(rec.last().method).toBe('PUT');
    expect(request.path).toBe('/v1/config');
    // The document is the raw body — the reference is explicit that these two
    // endpoints are the text/plain exception to an otherwise JSON API.
    expect(rec.last().body).toBe('[A]\nkey=value');
    expect(rec.last().headers['Content-Type']).toBe('text/plain');
  });

  it('PUT /v1/config quotes the If-Match revision', async () => {
    rec.setResponses([{ body: { ok: true } }]);
    await client.config.apply('doc', { ifMatch: 'abc123' });

    expect(rec.last().headers['If-Match']).toBe('"abc123"');
  });

  it('PUT /v1/config does not double-quote an already-quoted revision', async () => {
    rec.setResponses([{ body: { ok: true } }]);
    await client.config.apply('doc', { ifMatch: '"abc123"' });

    expect(rec.last().headers['If-Match']).toBe('"abc123"');
  });

  it('refuses a revision that would produce a malformed header', async () => {
    // A CR or LF here is a header-injection attempt, not a typo. A quote
    // *inside* the revision is equally unusable — it cannot be represented in
    // an entity-tag, so re-emitting it would produce a header the server
    // cannot parse.
    await expect(client.config.apply('doc', { ifMatch: 'a\r\nX-Evil: 1' })).rejects.toThrow(
      /If-Match/,
    );
    await expect(client.config.apply('doc', { ifMatch: 'a"b' })).rejects.toThrow(/If-Match/);
    await expect(client.config.apply('doc', { ifMatch: 'a\nb' })).rejects.toThrow(/If-Match/);
  });

  it('PUT /v1/config omits If-Match when no revision is given', async () => {
    rec.setResponses([{ body: { ok: true } }]);
    await client.config.apply('doc');

    expect(rec.last().headers['If-Match']).toBeUndefined();
  });

  it('PUT /v1/config passes force and fullApply as query flags', async () => {
    rec.setResponses([{ body: { ok: true } }]);
    await client.config.apply('doc', { force: true, fullApply: true });

    expect(parseRequest(rec.last()).query).toEqual({ force: 'true', fullApply: 'true' });
  });

  it('POST /v1/config/validate sends text/plain and no If-Match', async () => {
    rec.setResponses([{ body: { ok: true } }]);
    await client.config.validate('[A]\nkey=value');

    const request = parseRequest(rec.last());
    expect(rec.last().method).toBe('POST');
    expect(request.path).toBe('/v1/config/validate');
    expect(rec.last().body).toBe('[A]\nkey=value');
    expect(rec.last().headers['Content-Type']).toBe('text/plain');
    expect(rec.last().headers['If-Match']).toBeUndefined();
  });
});

/* -------------------------------------------------------------------------- */
/* Convenience surface                                                         */
/* -------------------------------------------------------------------------- */

describe('flat aliases', () => {
  it('reach the same operation as the namespaced form', async () => {
    rec.setResponses([ok()]);
    await client.kickPlayer('76561198000000001', 'test');

    expect(parseRequest(rec.last()).path).toBe('/v1/players/76561198000000001/kick');
  });

  it('cover the operations that only exist as aliases', async () => {
    rec.setResponses([ok()]);
    await client.sendBroadcast('hi');

    expect(parseRequest(rec.last()).path).toBe('/v1/broadcast');
  });
});

describe('ping', () => {
  it('resolves true when the token works', async () => {
    rec.setResponses([{ body: statusPayload() }]);
    await expect(client.ping()).resolves.toBe(true);
    expect(parseRequest(rec.last()).path).toBe('/v1/status');
  });

  it('resolves false on a rejected credential', async () => {
    rec.setResponses([
      { status: 401, body: { error: { code: 'unauthorized', message: 'bad token' } } },
    ]);
    await expect(client.ping()).resolves.toBe(false);
  });

  it('throws on a network failure rather than reporting a bad token', async () => {
    // Conflating "unreachable" with "wrong password" sends an operator to check
    // a credential that was never the problem.
    rec.setResponses([{ throws: new TypeError('fetch failed') }]);
    await expect(client.ping()).rejects.toThrow(/failed before a response/);
  });

  it('throws on a server error', async () => {
    rec.setResponses([{ status: 500, body: { error: { code: 'boom', message: 'x' } } }]);
    await expect(client.ping()).rejects.toThrow(/HTTP 500/);
  });
});

describe('request escape hatch', () => {
  it('issues an arbitrary route', async () => {
    rec.setResponses([{ body: { anything: true } }]);
    const result = await client.request('GET', '/v1/some/future/route', {
      query: { a: 1 },
    });

    expect(parseRequest(rec.last()).path).toBe('/v1/some/future/route');
    expect(parseRequest(rec.last()).query).toEqual({ a: '1' });
    expect(result).toEqual({ anything: true });
  });
});

describe('custom headers', () => {
  it('merges client headers into every request', async () => {
    const withHeaders = createClient({
      baseUrl: BASE,
      token: TOKEN,
      fetch: rec.fetch,
      headers: { 'X-Trace': 'abc' },
    });

    rec.setResponses([{ body: statusPayload() }]);
    await withHeaders.status.get();

    expect(rec.last().headers['X-Trace']).toBe('abc');
  });

  it('accepts a header producer that is evaluated per request', async () => {
    let counter = 0;
    const withHeaders = createClient({
      baseUrl: BASE,
      token: TOKEN,
      fetch: rec.fetch,
      headers: () => ({ 'X-Seq': String(++counter) }),
    });

    rec.setResponses([{ body: statusPayload() }]);
    await withHeaders.status.get();
    await withHeaders.status.get();

    expect(rec.at(0).headers['X-Seq']).toBe('1');
    expect(rec.at(1).headers['X-Seq']).toBe('2');
  });

  it('lets a per-call header override the client header', async () => {
    const withHeaders = createClient({
      baseUrl: BASE,
      token: TOKEN,
      fetch: rec.fetch,
      headers: { 'If-Match': 'stale' },
    });

    rec.setResponses([{ body: { ok: true } }]);
    await withHeaders.config.apply('doc', { ifMatch: 'fresh' });

    expect(rec.last().headers['If-Match']).toBe('"fresh"');
  });
});

/* -------------------------------------------------------------------------- */
/* Route coverage                                                              */
/* -------------------------------------------------------------------------- */

describe('route coverage', () => {
  it('exercises every route the library declares', async () => {
    // The routes a client can reach are compared against ROUTE_IDS, so a route
    // added to the API surface without a client method — or a method wired to
    // the wrong path — fails here rather than in a user's dashboard.
    const reachable = new Set<string>();

    const scenario: [string, () => Promise<unknown>][] = [
      ['GET /v1/status', () => client.status.get()],
      ['GET /v1/players', () => client.players.list()],
      ['POST /v1/players/{steamId}/kick', () => client.players.kick('76561198000000001')],
      ['POST /v1/players/{steamId}/kill', () => client.players.kill('76561198000000001')],
      [
        'POST /v1/players/{steamId}/message',
        () => client.players.message('76561198000000001', 'x'),
      ],
      ['PATCH /v1/players/{steamId}', () => client.players.setFaction('76561198000000001', 'RUS')],
      ['GET /v1/bans', () => client.bans.list()],
      ['POST /v1/bans', () => client.bans.add('76561198000000001')],
      ['DELETE /v1/bans/{steamId}', () => client.bans.remove('76561198000000001')],
      ['GET /v1/reserved-slots', () => client.reservedSlots.list()],
      ['POST /v1/reserved-slots', () => client.reservedSlots.add('76561198000000001')],
      [
        'DELETE /v1/reserved-slots/{steamId}',
        () => client.reservedSlots.remove('76561198000000001'),
      ],
      ['GET /v1/capabilities', () => client.meta.capabilities()],
      ['GET /v1/server-id', () => client.meta.serverId()],
      ['GET /v1/health', () => client.meta.health()],
      ['GET /v1/audit', () => client.audit.list()],
      ['POST /v1/broadcast', () => client.broadcast('x')],
      ['POST /v1/match/map', () => client.match.setMap({ map: 'Kavkazi' })],
      ['POST /v1/match/end', () => client.match.end()],
      ['POST /v1/match/restart', () => client.match.restart()],
      ['PUT /v1/world/lighting', () => client.world.setLighting('DayClear')],
      ['GET /v1/rotation', () => client.rotation.get()],
      ['POST /v1/rotation/entries', () => client.rotation.addEntry({ map: 'Kavkazi' })],
      ['DELETE /v1/rotation/entries/{i}', () => client.rotation.removeEntry(0)],
      ['POST /v1/rotation/entries/{i}/move', () => client.rotation.moveEntry(0, 'up')],
      ['POST /v1/rotation/save', () => client.rotation.save()],
      ['PATCH /v1/settings', () => client.settings.patch({})],
      ['GET /v1/catalog/maps', () => client.catalog.maps()],
      ['GET /v1/catalog/lightings', () => client.catalog.lightings()],
      ['GET /v1/catalog/experiences', () => client.catalog.experiences()],
      ['GET /v1/catalog/maps/{id}/experiences', () => client.catalog.mapExperiences('Kavkazi')],
      ['GET /v1/catalog/maps/{id}/alternators', () => client.catalog.mapAlternators('Kavkazi')],
      ['GET /v1/sponsor', () => client.sponsor.get()],
      ['PUT /v1/sponsor', () => client.sponsor.set('https://cdn.example/b.png')],
      ['GET /v1/config', () => client.config.get()],
      ['PUT /v1/config', () => client.config.apply('doc')],
      ['POST /v1/config/validate', () => client.config.validate('doc')],
    ];

    for (const [route, invoke] of scenario) {
      rec.reset();
      rec.setResponses([{ body: {} }]);
      await invoke();

      const { path } = parseRequest(rec.last());
      const method = rec.last().method;
      // Normalize the placeholder name the same way capability checks do, so
      // `{steamId}` here compares equal to `{steamId}` in ROUTE_IDS regardless
      // of which id the scenario used.
      reachable.add(
        `${method} ${path
          .replace(/\/76561198000000001(?=\/|$)/g, '/{steamId}')
          .replace(/\/Kavkazi(?=\/|$)/g, '/{id}')
          .replace(/\/\d+(?=\/|$)/g, '/{i}')}`,
      );
    }

    expect([...reachable].sort()).toEqual([...ROUTE_IDS].sort());
  });
});
