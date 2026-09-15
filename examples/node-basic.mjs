/**
 * End-to-end walkthrough against a real HTTP server.
 *
 * By default it starts nothing and expects the mock at
 * `http://127.0.0.1:7777` — run `node examples/mock-rcon-server.mjs` first.
 * Point it at a real server with environment variables:
 *
 * ```bash
 * export WARDOGS_BASE_URL='https://my-server.example:7776'
 * export WARDOGS_TOKEN='the-rcon-password'
 * node examples/node-basic.mjs
 * ```
 *
 * Against a real server, be aware the writes below are real: the broadcast
 * reaches every player, and the config write bumps the revision. Read the
 * section headers before running it against anything live.
 */

import {
  createCapabilities,
  createClient,
  createConfigDocument,
  createWatcher,
  isWardogsError,
  WardogsHttpError,
  SPEC_UPDATED,
  VERSION,
} from '../dist/index.js';

const BASE_URL = process.env.WARDOGS_BASE_URL ?? 'http://127.0.0.1:7777';
const TOKEN = process.env.WARDOGS_TOKEN ?? 'mock-rcon-password';
const LIVE = process.env.WARDOGS_WRITES === '1';

function heading(text) {
  console.log(`\n${'─'.repeat(60)}\n${text}\n${'─'.repeat(60)}`);
}

const client = createClient({
  baseUrl: BASE_URL,
  token: TOKEN,
  timeoutMs: 10_000,
  // One retry on a failing GET. Writes are never retried by design — a retried
  // kick could kick twice.
  retries: 1,
});

/* -------------------------------------------------------------------------- */
/* 1. Connectivity                                                             */
/* -------------------------------------------------------------------------- */

heading(`1. Connectivity  (library ${VERSION}, spec ${SPEC_UPDATED})`);

// `ping()` is `GET /v1/status` with the auth failure turned into `false`. The
// reference names that endpoint as the way to check a token — there is no login.
const reachable = await client.ping();
if (!reachable) {
  console.error('  The token was rejected. Check WARDOGS_TOKEN.');
  process.exit(1);
}
console.log('  token accepted');

/* -------------------------------------------------------------------------- */
/* 2. Live state                                                               */
/* -------------------------------------------------------------------------- */

heading('2. Live match state');

const status = await client.status.get();
console.log(`  ${status.serverName}`);
console.log(`  ${status.map}  ·  ${status.lighting}  ·  ${status.matchSeconds}s in`);
console.log(`  players: ${status.players.current}/${status.players.max}`);
console.log(
  `  score tick: ${status.scoreTick.current}s (range ${status.scoreTick.min}–${status.scoreTick.max})`,
);
console.log(`  factions: ${status.factionScores.map((f) => `${f.name} ${f.colorHex}`).join(', ')}`);

/* -------------------------------------------------------------------------- */
/* 3. Capability detection                                                     */
/* -------------------------------------------------------------------------- */

heading('3. Capability detection');

const caps = createCapabilities(client);
console.log(`  routes advertised: ${(await caps.get()).routes.length}`);
console.log(`  config writable:   ${await caps.configWritable()}`);

// The mock advertises `PATCH /v1/players/{id}` while the spec says
// `PATCH /v1/players/{steamId}`. A literal string compare reports false here;
// the normalization inside supports() is why this is true.
console.log(`  "change faction" available: ${await caps.supports('PATCH /v1/players/{steamId}')}`);

/* -------------------------------------------------------------------------- */
/* 4. Roster, with factions resolved by colour                                 */
/* -------------------------------------------------------------------------- */

heading('4. Players');

const players = await client.players.list();
for (const player of players) {
  // The reference is explicit that the colour, not the name, is the stable
  // faction key. Look it up rather than trusting the name string.
  const faction = status.factionScores.find(
    (row) => row.name.toLowerCase() === player.faction.toLowerCase(),
  );
  const colour = faction?.colorHex ?? '(unmatched)';
  console.log(
    `  ${player.name.padEnd(10)} ${colour.padEnd(9)} ${String(player.kills).padStart(3)}/${String(player.deaths).padEnd(3)} ${String(player.pingMs).padStart(4)}ms`,
  );
}

/* -------------------------------------------------------------------------- */
/* 5. Config document                                                          */
/* -------------------------------------------------------------------------- */

heading('5. Config document');

const config = await client.config.get();
console.log(`  revision: ${config.revision}  writable: ${config.writable}`);

// Parsing the document is local — no extra request. The parser is
// case-insensitive on keys and preserves repeated `+Key=` lines, which is what
// makes a rotation readable without hand-rolled string work.
const doc = createConfigDocument(config.text);

console.log(`  sections: ${doc.sectionNames().join(', ')}`);
console.log(`  MaxPlayers: ${doc.getNumber('/Script/Engine.GameSession', 'MaxPlayers')}`);
console.log(`  banned ids: ${doc.bannedPlayerIds().join(', ') || '(none)'}`);

const rotation = doc.rotationEntries();
console.log(`  rotation entries: ${rotation.length}`);
for (const entry of rotation) {
  console.log(
    `    ${entry.map.padEnd(9)} ${(entry.experiences.join('+') || '(default)').padEnd(24)} ${entry.lighting ?? '(default)'}`,
  );
}

// Edits are immutable, so the document you read stays intact — which is what
// optimistic concurrency needs.
const edited = doc.set('/Script/WDGame.WDGameSession', 'ServerName', 'Renamed By Example');
console.log(`  edited ServerName → ${edited.get('/Script/WDGame.WDGameSession', 'ServerName')}`);
console.log(`  original untouched → ${doc.get('/Script/WDGame.WDGameSession', 'ServerName')}`);

/* -------------------------------------------------------------------------- */
/* 6. Error handling                                                           */
/* -------------------------------------------------------------------------- */

heading('6. Error handling');

try {
  // A no-op write against the mock that fails deterministically: the mock
  // 412s when If-Match does not match the current revision.
  await client.config.apply('[/Script/Engine.GameSession]\nMaxPlayers=64\n', {
    ifMatch: 'definitely-not-the-real-revision',
  });
  console.log('  unexpected: the stale revision was accepted');
} catch (error) {
  if (!isWardogsError(error)) throw error;

  console.log(`  ${error.name}: ${error.message}`);
  if (error instanceof WardogsHttpError) {
    console.log(`  status ${error.status}  code ${error.code}`);
    // The reference documents this specifically for PUT /v1/config: re-read,
    // re-apply, retry.
    console.log(`  revision conflict: ${error.isRevisionConflict}`);
  }
}

/* -------------------------------------------------------------------------- */
/* 7. Writes (opt-in)                                                          */
/* -------------------------------------------------------------------------- */

if (!LIVE) {
  heading('7. Writes — skipped');
  console.log('  This section sends real commands. Re-run with WARDOGS_WRITES=1.');
  console.log('  Against a live server that means a broadcast every connected player sees.');
} else {
  heading('7. Writes');

  await client.broadcast('Server restarting in 5 minutes');
  console.log('  broadcast sent');

  await client.settings.patch({ scoreTick: 20 });
  console.log('  score tick set to 20');

  const picked = await client.match.setMap({
    map: 'Europe',
    experiences: ['Madrid_KOTH_01'],
    lighting: 'DayLateGray',
  });
  console.log(`  map change acknowledged: ${picked.ok}`);

  await client.players.kick('76561198000000002', 'example kick');
  console.log('  kick sent');
}

/* -------------------------------------------------------------------------- */
/* 8. Polling                                                                  */
/* -------------------------------------------------------------------------- */

heading('8. Polling for 12 seconds');

const watcher = createWatcher(client, {
  // The reference notes the official panel refreshes every 3–5 seconds and asks
  // for gentle polling. Here it is compressed so the example finishes.
  intervalMs: 2_000,
  watchPlayers: true,
});

let ticks = 0;
watcher.on('snapshot', (snapshot) => {
  ticks++;
  console.log(
    `  tick ${snapshot.tick}  ${snapshot.status.players.current} players  on ${snapshot.status.map}  (+${snapshot.elapsedMs}ms)`,
  );
});

watcher.on('change', ({ changed }) => {
  console.log(`    changed: ${changed.join(', ')}`);
});

watcher.on('players', ({ joined, left }) => {
  for (const player of joined) console.log(`    + ${player.name} joined`);
  for (const player of left) console.log(`    - ${player.name} left`);
});

watcher.on('error', (error) => {
  // A failing tick does not end the loop — it backs off and retries.
  console.log(`    error (retrying): ${error instanceof Error ? error.message : String(error)}`);
});

watcher.start();
await new Promise((resolve) => setTimeout(resolve, 12_000));
await watcher.stop();

console.log(`\n  ${ticks} ticks, watcher stopped cleanly.`);
console.log(`  last status cached locally: ${watcher.getStatus()?.map ?? '(none)'}`);
console.log(`  last roster cached locally: ${watcher.getPlayers().length} players`);

heading('Done');
