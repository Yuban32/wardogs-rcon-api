/**
 * A minimal Wardogs RCON client, written out by hand.
 *
 * `node-basic.mjs` walks the API through the published library. This one does it
 * with nothing but the global `fetch`, so you can see what actually goes on the
 * wire — and copy it into a script, a worker, a dashboard backend or another
 * language without taking a dependency.
 *
 * It is deliberately smaller than the library in four places, and each is a
 * decision rather than an oversight:
 *
 * - **No retries.** A dropped connection does not tell you whether the server
 *   acted, so a retried `kick` could kick twice. Only GETs are safe to repeat,
 *   and this script repeats nothing.
 * - **Parameter-blind route comparison.** The spec writes `{steamId}` where the
 *   reference's prose writes `{id}`; the comparison below strips placeholder
 *   names, and section 4 shows what a literal `includes()` reports instead.
 * - **No INI parsing.** `GET /v1/config` hands back the document as text. This
 *   script reads it and sends it back, but does not try to edit it.
 * - **No INI-aware concurrency.** `If-Match` is forwarded by hand; the library
 *   is where a revision gets validated and formatted.
 *
 * By default it expects the mock at `http://127.0.0.1:7777` — start it first:
 *
 * ```bash
 * node examples/mock-rcon-server.mjs      # in one shell
 * node examples/minimal-client.mjs        # in another
 * ```
 *
 * Point it at a real server with environment variables:
 *
 * ```bash
 * export WARDOGS_BASE_URL='https://my-server.example:7776'
 * export WARDOGS_TOKEN='the-rcon-password'
 * node examples/minimal-client.mjs
 * ```
 *
 * The token is a full-access admin password — there is no login step and no
 * read-only variant. Keep it on a backend rather than in a page a player can
 * read. Section 7 sends real commands and is skipped unless `WARDOGS_WRITES=1`.
 */

const BASE_URL = (process.env.WARDOGS_BASE_URL ?? 'http://127.0.0.1:7777').replace(/\/+$/, '');
const TOKEN = process.env.WARDOGS_TOKEN ?? 'mock-rcon-password';
const LIVE = process.env.WARDOGS_WRITES === '1';

/** Bounds every request, and so also bounds a server that went quiet mid-reply. */
const TIMEOUT_MS = 10_000;

function heading(text) {
  console.log(`\n${'─'.repeat(60)}\n${text}\n${'─'.repeat(60)}`);
}

/* -------------------------------------------------------------------------- */
/* The client                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * A failed request, carrying what the server said about it.
 *
 * The API answers a rejected request with `{ error: { code, message } }` and a
 * non-2xx status. Anything in front of it may answer with an HTML page
 * instead, which is why the error path decodes leniently: a 502 should read as
 * "HTTP 502" plus the page's first line, not as a JSON parse failure that hides
 * the status entirely.
 */
class RconError extends Error {
  constructor(message, { status, code, body }) {
    super(message);
    this.name = 'RconError';
    this.status = status;
    this.code = code;
    this.body = body;
  }

  /** The credential was rejected — retrying will not help. */
  get isAuthError() {
    return this.status === 401 || this.status === 403;
  }

  /** The `If-Match` revision was stale: re-read, re-apply, retry. */
  get isRevisionConflict() {
    return this.status === 412;
  }
}

/** The first readable line, so an HTML gateway page still says something useful. */
function firstLine(text) {
  const stripped = text.includes('<') ? text.replace(/<[^>]*>/g, ' ') : text;
  const line = stripped
    .split(/\r?\n/)
    .map((candidate) => candidate.trim())
    .find((candidate) => candidate !== '');
  return line?.slice(0, 300);
}

/**
 * The reason a `fetch` rejected, which is not the reason it reports.
 *
 * `fetch` rejects with a bare `TypeError: fetch failed` and hides the actual
 * problem — a refused connection, a DNS failure, a TLS handshake — one level
 * down in `cause`. Reporting the outer message alone sends people looking at
 * their code instead of at their hostname.
 */
function describeError(error) {
  let root = error;
  for (let depth = 0; depth < 4 && root instanceof Error && root.cause instanceof Error; depth++) {
    root = root.cause;
  }
  return root === error ? error.message : `${error.message} (${root.message})`;
}

/**
 * One request. Every call below goes through this.
 *
 * @param {string} method  `GET`, `POST`, `PATCH`, `PUT`, `DELETE`
 * @param {string} path    e.g. `'/v1/status'`
 * @param {object} [options]
 * @param {Record<string, string | number | boolean | undefined>} [options.query]
 * @param {unknown} [options.body]
 * @param {boolean} [options.plainText]  send the body as `text/plain`, not JSON
 * @param {Record<string, string>} [options.headers]
 * @param {number} [options.timeoutMs]
 */
async function request(method, path, options = {}) {
  const { query, body, plainText = false, headers = {}, timeoutMs = TIMEOUT_MS } = options;

  const url = new URL(BASE_URL + path);
  for (const [key, value] of Object.entries(query ?? {})) {
    // Omitted rather than sent empty: `?limit=` is not the same request as no
    // `limit` at all, and the server picks its own default only in the latter.
    if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
  }

  const hasBody = body !== undefined;

  let response;
  try {
    response = await fetch(url, {
      method,
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${TOKEN}`,
        // The config endpoints are the exception to an otherwise JSON API:
        // `PUT /v1/config` and `POST /v1/config/validate` take the INI document
        // as `text/plain` rather than as a JSON-encoded string.
        ...(hasBody ? { 'Content-Type': plainText ? 'text/plain' : 'application/json' } : {}),
        ...headers,
      },
      ...(hasBody ? { body: plainText ? String(body) : JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    // No response at all. A timeout and an unreachable host are different
    // problems, and the message should say which one happened.
    if (error.name === 'TimeoutError') {
      throw new RconError(`${method} ${url} timed out after ${timeoutMs}ms`, { status: 0 });
    }
    throw new RconError(`${method} ${url} failed before a response: ${describeError(error)}`, {
      status: 0,
    });
  }

  const text = await response.text();

  if (!response.ok) {
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = undefined;
    }
    const code = parsed?.error?.code ?? `http_${response.status}`;
    const message = parsed?.error?.message ?? firstLine(text) ?? response.statusText;

    throw new RconError(`${method} ${url} → HTTP ${response.status}: ${message}`, {
      status: response.status,
      code,
      body: parsed ?? text,
    });
  }

  // Strict where the error path is lenient: a 2xx promised JSON, so a body that
  // does not parse is a real problem rather than a diagnostic to salvage. An
  // empty body is not an error — that is a 204, or a bodyless success.
  return text.trim() === '' ? undefined : JSON.parse(text);
}

/** `PATCH /v1/players/{id}` and `PATCH /v1/players/{steamId}` are one route. */
function stripParamNames(route) {
  return route
    .replace(/\{[^}]*\}/g, '{*}')
    .toUpperCase()
    .replace(/\/+$/, '');
}

/* -------------------------------------------------------------------------- */
/* 1. Connectivity                                                             */
/* -------------------------------------------------------------------------- */

heading('1. Connectivity');

try {
  await request('GET', '/v1/status');
  console.log('  token accepted');
} catch (error) {
  // There is no login endpoint — `GET /v1/status` is the reference's own token
  // check, so an auth failure here means the password is wrong. `status` of 0
  // is the other dead end: no response arrived, so the host or port is wrong.
  // Both are worth one actionable line rather than a stack trace.
  if (error instanceof RconError) {
    console.error(`  ${error.message}`);
    console.error(error.isAuthError ? '  Check WARDOGS_TOKEN.' : '  Check WARDOGS_BASE_URL.');
    process.exit(1);
  }
  throw error;
}

/* -------------------------------------------------------------------------- */
/* 2. Live state                                                               */
/* -------------------------------------------------------------------------- */

heading('2. Live match state');

const status = await request('GET', '/v1/status');
console.log(`  ${status.serverName}`);
console.log(`  ${status.map}  ·  ${status.lighting}  ·  ${status.matchSeconds}s in`);
console.log(`  players: ${status.players.current}/${status.players.max}`);
console.log(
  `  score tick: ${status.scoreTick.current}s (range ${status.scoreTick.min}–${status.scoreTick.max})`,
);
console.log(`  factions: ${status.factionScores.map((f) => `${f.name} ${f.colorHex}`).join(', ')}`);

/* -------------------------------------------------------------------------- */
/* 3. Players                                                                  */
/* -------------------------------------------------------------------------- */

heading('3. Players');

// The list arrives wrapped: `{ "players": [ ... ] }`, not a bare array.
const { players } = await request('GET', '/v1/players');

for (const player of players) {
  // `factionScores` is the stable key for a faction, and the reference is
  // explicit that it is the colour rather than the name. Match on the name
  // here because that is what a player carries, and leave the colour missing
  // rather than guessing when nothing matches.
  const faction = status.factionScores.find(
    (row) => row.name.toLowerCase() === player.faction.toLowerCase(),
  );
  const colour = faction?.colorHex ?? '(unmatched)';
  console.log(
    `  ${player.name.padEnd(10)} ${colour.padEnd(9)} ${String(player.kills).padStart(3)}/${String(player.deaths).padEnd(3)} ${String(player.pingMs).padStart(4)}ms`,
  );
}

/* -------------------------------------------------------------------------- */
/* 4. Capabilities                                                             */
/* -------------------------------------------------------------------------- */

heading('4. Capabilities');

// Not every server enables every route, so the reference asks callers to check
// here rather than assume. This is the one request worth making before offering
// a feature in a UI.
const capabilities = await request('GET', '/v1/capabilities');
const wanted = 'PATCH /v1/players/{steamId}';

console.log(`  routes advertised: ${capabilities.routes.length}`);
console.log(`  config writable:   ${capabilities.config.writable}`);
console.log(`  literal compare:   ${capabilities.routes.includes(wanted)}`);
console.log(
  `  parameter-blind:   ${capabilities.routes.some((route) => stripParamNames(route) === stripParamNames(wanted))}`,
);

// Both lines describe the same server. The mock publishes `{id}` while the spec
// says `{steamId}`, and the parameter name carries no meaning on the wire — so a
// literal compare reports a feature the server plainly supports as missing.

/* -------------------------------------------------------------------------- */
/* 5. Queries and the audit log                                                */
/* -------------------------------------------------------------------------- */

heading('5. Audit log');

const audit = await request('GET', '/v1/audit', { query: { limit: 3 } });
console.log(`  ${audit.entries.length} entries (asked for 3)`);
for (const entry of audit.entries.slice(0, 3)) {
  console.log(`    ${entry.timestampUtc}  ${entry.event}  ${entry.detail}`);
}

/* -------------------------------------------------------------------------- */
/* 6. Config — the text/plain exception                                        */
/* -------------------------------------------------------------------------- */

heading('6. Config');

const config = await request('GET', '/v1/config');
const lineCount = config.text.split('\n').length;
console.log(`  revision ${config.revision}  writable ${config.writable}  ${lineCount} lines`);

// Validate without applying. Same document format as the write below, but this
// one is a no-op on the server — the safe way to check an edit before sending
// it, and the reason the warnings field exists.
const preview = await request('POST', '/v1/config/validate', {
  body: config.text,
  plainText: true,
});
console.log(`  validate: ok=${preview.ok}  warnings=${preview.warnings.length}`);

// A stale revision fails rather than silently overwriting a concurrent edit.
// The body sent back here is the document just read, so even a server that
// ignored `If-Match` could not change anything — worth arranging whenever a
// failure path can write.
try {
  await request('PUT', '/v1/config', {
    body: config.text,
    plainText: true,
    headers: { 'If-Match': '"definitely-not-the-real-revision"' },
  });
  console.log('  unexpected: the stale revision was accepted');
} catch (error) {
  if (!(error instanceof RconError) || !error.isRevisionConflict) throw error;
  console.log(`  412 as expected — ${error.code}: ${error.message}`);
  console.log('  the recovery is: re-read, re-apply your change, retry');
}

/* -------------------------------------------------------------------------- */
/* 7. Writes (opt-in)                                                          */
/* -------------------------------------------------------------------------- */

if (!LIVE) {
  heading('7. Writes — skipped');
  console.log('  This section sends real commands. Re-run with WARDOGS_WRITES=1.');
  console.log('  Against a live server, the broadcast reaches every connected player.');
} else {
  heading('7. Writes');

  // Writes are never retried, here or in the library: a retried `kick` could
  // kick twice, and a dropped connection does not tell you whether the server
  // acted. When a write fails, the decision is yours to make, not the client's.
  await request('POST', '/v1/broadcast', {
    body: { message: 'Server restarting in 5 minutes' },
  });
  console.log('  broadcast sent');

  await request('PATCH', '/v1/settings', { body: { scoreTick: 20 } });
  console.log('  score tick set to 20');
}

heading('Done');
