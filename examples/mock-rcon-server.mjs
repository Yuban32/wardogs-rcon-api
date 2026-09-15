/**
 * A stand-in Wardogs RCON server, for trying the client without a game server.
 *
 * It implements the parts of `/v1` the examples touch, with the reference's own
 * shapes, plus the bearer check. What it deliberately does **not** do is
 * simulate a real game: state is fixed, and writes are acknowledged rather than
 * applied.
 *
 * Run it on its own, or alongside `browser-proxy-server.mjs` to exercise the
 * browser path:
 *
 * ```bash
 * node examples/mock-rcon-server.mjs
 * # in another shell
 * WARDOGS_ALLOWED_ORIGINS=http://127.0.0.1:7777 \
 * WARDOGS_TOKEN=mock-rcon-password \
 *   node examples/browser-proxy-server.mjs
 * ```
 *
 * Note the http/loopback combination: that is the one plaintext case the
 * library permits without `allowInsecureHttp`, because it maps to a loopback
 * listener. A real remote server would be `https://` and require TLS.
 */

import { createServer } from 'node:http';

const PORT = Number(process.env.MOCK_RCON_PORT ?? 7777);
const TOKEN = process.env.MOCK_RCON_TOKEN ?? 'mock-rcon-password';

/** Fixed roster, so diffs between polls are predictable. */
const players = [
  {
    name: 'Alpha',
    steamId: '76561198000000001',
    faction: 'NATO',
    kills: 12,
    deaths: 3,
    cash: 4200,
    pingMs: 24,
  },
  {
    name: 'Bravo',
    steamId: '76561198000000002',
    faction: 'RUS',
    kills: 7,
    deaths: 9,
    cash: 1800,
    pingMs: 61,
  },
  {
    name: 'Charlie',
    steamId: '76561198000000003',
    faction: 'NATO',
    kills: 15,
    deaths: 1,
    cash: 7300,
    pingMs: 18,
  },
];

const SERVER_SETTINGS = `[/Script/WDRCON.WDRCONSettings]
bEnabled=true
BindAddress=127.0.0.1
Port=7777
Password=
PasswordHash=""

[/Script/WDGame.WDGameSession]
ServerName=Mock Wardogs Server
ServerPassword=
ServerImageURL=
MaxReservedSlots=20
+DefaultReservedPlayerIds="76561198000000002"
+DefaultBannedPlayerIds="76561198000000009"

[/Script/Engine.GameSession]
MaxPlayers=128

[/Script/WDGame.WDServerMapRotationSettings]
bEnabled=true
RotationMode=Ordered
+RotationEntries=(Map="Kavkazi",Experience="Bakurani_KOTH_01",Lighting="DayClear",ZoneAlternator="ZoneAlternator.Factory.Circle")
+RotationEntries=(Map="Europe",Experiences="Madrid_KOTH_01+KOTH_InfantryOnly",Lighting="DayLateGray")
`;

let revision = 'rev-1';

/** State the mock mutates in response to writes. */
const state = {
  scoreTick: 24,
  rotationEnabled: true,
  rotationMode: 'ordered',
  bans: [
    {
      steamId: '76561198000000009',
      bannedAtUtc: '2026-09-01T12:00:00Z',
      bannedBy: 'admin',
      reason: 'cheating',
    },
  ],
  reservedSlots: ['76561198000000002'],
  rotationEntries: [
    {
      map: 'Kavkazi',
      experiences: ['Bakurani_KOTH_01'],
      lighting: 'DayClear',
      zoneAlternator: 'ZoneAlternator.Factory.Circle',
      status: 'now',
      denied: false,
    },
    {
      map: 'Europe',
      experiences: ['Madrid_KOTH_01', 'KOTH_InfantryOnly'],
      lighting: 'DayLateGray',
      zoneAlternator: '',
      status: 'next',
      denied: false,
    },
  ],
  sponsor: { imageUrl: 'https://cdn.example.com/banner.png' },
  kicked: [],
  broadcasts: [],
};

/**
 * The capability list a server would send.
 *
 * Deliberately uses `{id}` for the player route — that is the spelling the
 * reference's prose uses, while the machine-readable spec says `{steamId}`.
 * A client that compares these strings literally reports a supported feature as
 * unsupported, which is the mismatch `normalizeRoute` exists to absorb.
 */
const CAPABILITIES = {
  routes: [
    'GET /v1/status',
    'GET /v1/players',
    'POST /v1/players/{id}/kick',
    'POST /v1/players/{id}/kill',
    'POST /v1/players/{id}/message',
    'PATCH /v1/players/{id}',
    'GET /v1/bans',
    'POST /v1/bans',
    'DELETE /v1/bans/{steamId}',
    'GET /v1/reserved-slots',
    'POST /v1/reserved-slots',
    'DELETE /v1/reserved-slots/{steamId}',
    'GET /v1/capabilities',
    'GET /v1/server-id',
    'GET /v1/health',
    'GET /v1/audit',
    'POST /v1/broadcast',
    'POST /v1/match/map',
    'POST /v1/match/end',
    'POST /v1/match/restart',
    'PUT /v1/world/lighting',
    'GET /v1/rotation',
    'POST /v1/rotation/entries',
    'DELETE /v1/rotation/entries/{i}',
    'POST /v1/rotation/entries/{i}/move',
    'POST /v1/rotation/save',
    'PATCH /v1/settings',
    'GET /v1/catalog/maps',
    'GET /v1/catalog/lightings',
    'GET /v1/catalog/experiences',
    'GET /v1/catalog/maps/{id}/experiences',
    'GET /v1/catalog/maps/{id}/alternators',
    'GET /v1/sponsor',
    'PUT /v1/sponsor',
    'GET /v1/config',
    'PUT /v1/config',
    'POST /v1/config/validate',
  ],
  config: { writable: true, document: '/v1/config' },
  apiVersion: '1',
  build: '++Wardogs+Live-CL-501228',
  auth: { scheme: 'bearer', header: 'Authorization' },
  limits: { maxBodyBytes: 65536, maxRequestsPerMinutePerIp: 120 },
};

function statusPayload() {
  return {
    serverName: 'Mock Wardogs Server',
    map: 'Kavkazi',
    experiences: ['Bakurani_KOTH_01'],
    lighting: 'DayClear',
    alternator: 'ZoneAlternator.Factory.Circle',
    scoreTick: { current: state.scoreTick, min: 18, max: 30 },
    scoreCap: 500,
    matchSeconds: Math.floor(Date.now() / 1000) % 900,
    players: { current: players.length, max: 128 },
    factionScores: [
      { name: 'NATO', colorHex: '#3b82f6' },
      { name: 'RUS', colorHex: '#ef4444' },
    ],
    rotation: { nowIndex: 0, nextIndex: 1 },
  };
}

function send(response, status, payload, contentType = 'application/json; charset=utf-8') {
  const body = typeof payload === 'string' ? payload : JSON.stringify(payload);
  response.writeHead(status, {
    'Content-Type': contentType,
    'Content-Length': Buffer.byteLength(body),
  });
  response.end(body);
}

function fail(response, status, code, message) {
  send(response, status, { error: { code, message } });
}

async function readText(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

/** Matches `METHOD /v1/...` against a request, returning path captures. */
function match(pattern, method, requestMethod, pathname) {
  if (method !== requestMethod) return null;

  const wanted = pattern.split('/');
  const actual = pathname.split('/');
  if (wanted.length !== actual.length) return null;

  const params = {};
  for (let i = 0; i < wanted.length; i++) {
    const segment = wanted[i];
    const value = actual[i];
    if (segment === undefined || value === undefined) return null;

    if (segment.startsWith('{')) {
      params[segment.slice(1, -1)] = decodeURIComponent(value);
    } else if (segment !== value) {
      return null;
    }
  }

  return params;
}

const server = createServer((request, response) => {
  const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);
  const path = url.pathname;
  const method = request.method ?? 'GET';
  const auth = request.headers.authorization;

  void (async () => {
    if (auth !== `Bearer ${TOKEN}`) {
      fail(response, 401, 'unauthorized', 'Missing or invalid bearer token.');
      return;
    }

    const body = method === 'GET' || method === 'DELETE' ? '' : await readText(request);
    let json = {};
    if (body !== '' && (request.headers['content-type'] ?? '').includes('json')) {
      try {
        json = JSON.parse(body);
      } catch {
        fail(response, 400, 'bad_json', 'Request body is not valid JSON.');
        return;
      }
    }

    const ok = { ok: true };

    /* Read ------------------------------------------------------------------ */

    if (match('/v1/status', 'GET', method, path)) return send(response, 200, statusPayload());

    if (match('/v1/players', 'GET', method, path)) return send(response, 200, { players });

    if (match('/v1/capabilities', 'GET', method, path)) return send(response, 200, CAPABILITIES);

    if (match('/v1/server-id', 'GET', method, path)) {
      return send(response, 200, { serverId: 'mock-server-0001' });
    }

    if (match('/v1/health', 'GET', method, path)) {
      return send(response, 200, {
        status: 'ok',
        uptimeSeconds: Math.round(process.uptime()),
        connections: { active: 1 },
        gameThreadQueue: { inFlight: 0, depth: 0, rejectedTotal: 0 },
      });
    }

    if (match('/v1/bans', 'GET', method, path)) return send(response, 200, { bans: state.bans });

    if (match('/v1/reserved-slots', 'GET', method, path)) {
      return send(response, 200, { reservedSlots: state.reservedSlots });
    }

    if (match('/v1/audit', 'GET', method, path)) {
      const limit = Number(url.searchParams.get('limit') ?? 50);
      const entries = Array.from({ length: Math.min(limit, 5) }, (_, index) => ({
        timestampUtc: new Date(Date.now() - index * 60_000).toISOString(),
        peer: '127.0.0.1',
        sessionId: `session-${index}`,
        event: 'sample',
        detail: `Synthetic audit entry ${index + 1}`,
      }));
      return send(response, 200, { entries });
    }

    if (match('/v1/rotation', 'GET', method, path)) {
      return send(response, 200, {
        enabled: state.rotationEnabled,
        mode: state.rotationMode,
        entries: state.rotationEntries,
      });
    }

    if (match('/v1/config', 'GET', method, path)) {
      return send(response, 200, {
        revision,
        writable: true,
        text: SERVER_SETTINGS,
        sections: [],
        warnings: [],
      });
    }

    if (match('/v1/sponsor', 'GET', method, path)) return send(response, 200, state.sponsor);

    if (match('/v1/catalog/maps', 'GET', method, path)) {
      return send(response, 200, { maps: ['Kavkazi', 'Europe', 'Pacific'] });
    }
    if (match('/v1/catalog/lightings', 'GET', method, path)) {
      return send(response, 200, { lightings: ['DayClear', 'DayLateGray', 'Night'] });
    }
    if (match('/v1/catalog/experiences', 'GET', method, path)) {
      return send(response, 200, {
        experiences: ['Bakurani_KOTH_01', 'Madrid_KOTH_01', 'KOTH_InfantryOnly'],
      });
    }
    if (match('/v1/catalog/maps/{id}/experiences', 'GET', method, path)) {
      // The spec types this as a plain `Ok`, which cannot be right. The mock
      // sends the list, matching the reference's intent.
      return send(response, 200, { ok: true, experiences: ['Bakurani_KOTH_01'] });
    }
    if (match('/v1/catalog/maps/{id}/alternators', 'GET', method, path)) {
      return send(response, 200, { ok: true, alternators: ['ZoneAlternator.Factory.Circle'] });
    }

    /* Writes ---------------------------------------------------------------- */

    if (match('/v1/broadcast', 'POST', method, path)) {
      state.broadcasts.push(json.message);
      return send(response, 200, ok);
    }

    const kick = match('/v1/players/{steamId}/kick', 'POST', method, path);
    if (kick !== null) {
      state.kicked.push({ steamId: kick.steamId, reason: json.reason ?? null });
      return send(response, 200, ok);
    }
    if (match('/v1/players/{steamId}/kill', 'POST', method, path)) return send(response, 200, ok);
    if (match('/v1/players/{steamId}/message', 'POST', method, path))
      return send(response, 200, ok);
    if (match('/v1/players/{steamId}', 'PATCH', method, path)) return send(response, 200, ok);

    if (match('/v1/bans', 'POST', method, path)) {
      state.bans.push({
        steamId: json.steamId,
        bannedAtUtc: new Date().toISOString(),
        bannedBy: 'mock',
        reason: json.reason ?? '',
      });
      return send(response, 200, ok);
    }

    const unban = match('/v1/bans/{steamId}', 'DELETE', method, path);
    if (unban !== null) {
      state.bans = state.bans.filter((ban) => ban.steamId !== unban.steamId);
      return send(response, 200, ok);
    }

    if (match('/v1/reserved-slots', 'POST', method, path)) {
      state.reservedSlots.push(json.steamId);
      return send(response, 200, ok);
    }

    const unreserve = match('/v1/reserved-slots/{steamId}', 'DELETE', method, path);
    if (unreserve !== null) {
      state.reservedSlots = state.reservedSlots.filter((id) => id !== unreserve.steamId);
      return send(response, 200, ok);
    }

    if (match('/v1/match/map', 'POST', method, path)) return send(response, 200, ok);
    if (match('/v1/match/end', 'POST', method, path)) return send(response, 200, ok);
    if (match('/v1/match/restart', 'POST', method, path)) return send(response, 200, ok);
    if (match('/v1/world/lighting', 'PUT', method, path)) return send(response, 200, ok);

    if (match('/v1/rotation/entries', 'POST', method, path)) {
      state.rotationEntries.push({
        map: json.map,
        experiences: json.experiences ?? [],
        lighting: json.lighting ?? '',
        zoneAlternator: json.zoneAlternator ?? '',
        status: '',
        denied: false,
      });
      return send(response, 200, ok);
    }

    const dropEntry = match('/v1/rotation/entries/{i}', 'DELETE', method, path);
    if (dropEntry !== null) {
      state.rotationEntries.splice(Number(dropEntry.i), 1);
      return send(response, 200, ok);
    }

    const moveEntry = match('/v1/rotation/entries/{i}/move', 'POST', method, path);
    if (moveEntry !== null) {
      const index = Number(moveEntry.i);
      const target = json.direction === 'up' ? index - 1 : index + 1;
      if (target >= 0 && target < state.rotationEntries.length) {
        const [entry] = state.rotationEntries.splice(index, 1);
        if (entry !== undefined) state.rotationEntries.splice(target, 0, entry);
      }
      return send(response, 200, ok);
    }

    if (match('/v1/rotation/save', 'POST', method, path)) return send(response, 200, ok);

    if (match('/v1/settings', 'PATCH', method, path)) {
      if (json.scoreTick !== undefined) state.scoreTick = json.scoreTick;
      if (json.rotationEnabled !== undefined) state.rotationEnabled = json.rotationEnabled;
      if (json.rotationMode !== undefined) state.rotationMode = json.rotationMode;
      return send(response, 200, ok);
    }

    if (match('/v1/sponsor', 'PUT', method, path)) {
      state.sponsor = { imageUrl: json.imageUrl };
      return send(response, 200, ok);
    }

    if (match('/v1/config/validate', 'POST', method, path)) {
      // text/plain body, not JSON.
      const warnings = body.includes('MaxPlayer')
        ? []
        : ['No [GameSession] section found — MaxPlayers will keep its default.'];
      return send(response, 200, {
        ok: true,
        revision,
        outcomes: [],
        changed: [],
        warnings,
        timingsMs: { validate: 1 },
      });
    }

    if (match('/v1/config', 'PUT', method, path)) {
      const ifMatch = request.headers['if-match'];
      if (ifMatch !== undefined && ifMatch !== `"${revision}"`) {
        // The documented 412 path: the caller read a revision that has since
        // been replaced.
        return send(response, 412, {
          ok: false,
          revision,
          error: { code: 'revision_mismatch', message: 'The document changed since you read it.' },
          conflict: ['revision'],
          outcomes: [],
          changed: [],
          warnings: [],
        });
      }

      revision = `rev-${Number(revision.slice(4)) + 1}`;
      return send(response, 200, {
        ok: true,
        revision,
        outcomes: [{ key: 'ServerName', outcome: 'applied' }],
        changed: ['ServerName'],
        warnings: [],
        timingsMs: { apply: 2 },
      });
    }

    /* Nothing matched -------------------------------------------------------- */

    fail(response, 404, 'not_found', `No handler for ${method} ${path}`);
  })();
});

server.listen(PORT, () => {
  console.log(`Mock Wardogs RCON server on http://127.0.0.1:${PORT}`);
  console.log(`  token: ${TOKEN}`);
  console.log(`  revision: ${revision}`);
});
