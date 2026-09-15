# wardogs-rcon-api-tool

Typed client and utilities for the **Wardogs dedicated server RCON HTTP API** (`/v1`).

Zero runtime dependencies. Ships ESM, CommonJS and UMD from one source, so it works from `npm install`, a bundler, `require()`, or a plain `<script>` tag — in Node, Bun, Deno, browsers and workers.

[中文](README.zh-CN.md) | **English**

> **Unofficial.** This targets a community reference, not published or supported by the game's developers. It can change without notice. The library pins the spec revision it was written against (`SPEC_VERSION`, `SPEC_UPDATED`) and a test suite compares its route surface against a vendored copy of the spec, so a server-side change fails the build rather than a user's dashboard. Verify against your own server.

---

## Install

```bash
npm install @yuban32/wardogs-rcon-api
```

Or from a CDN, no build step:

```html
<script src="https://unpkg.com/@yuban32/wardogs-rcon-api/dist/wardogs-rcon-api.umd.js"></script>
<script>
  const { createClient } = WardogsRCON;
</script>
```

Everything lives under the single `WardogsRCON` global rather than being spread across `window`.

---

## Quick start

### Node, Bun, Deno

```ts
import { createClient } from '@yuban32/wardogs-rcon-api';

const client = createClient({
  baseUrl: 'https://my-server.example:7776',
  token: process.env.WARDOGS_TOKEN!,
});

const status = await client.status.get();
console.log(`${status.players.current}/${status.players.max} on ${status.map}`);

await client.broadcast('Server restarting in 5 minutes');
```

The default RCON port is `7776`. Point `baseUrl` at the server's RCON listener, not its game port.

### Browser

A browser can call the server directly **only if** the server sends CORS headers. Most self-hosted servers do not, and an HTTPS page cannot call a plaintext loopback listener at all. Route through a same-origin backend instead:

```ts
import { createClient, createProxyFetch } from '@yuban32/wardogs-rcon-api';

const client = createClient({
  baseUrl: 'https://my-server.example:7776',
  token: '', // held by your backend
  fetch: createProxyFetch({ endpoint: '/rcon-proxy' }),
});
```

[examples/browser-proxy-server.mjs](examples/browser-proxy-server.mjs) is a working, dependency-free proxy to copy from, and [docs/adapters.md](docs/adapters.md) covers the decision.

---

## Two things worth knowing up front

**The token is a full-access admin password.** There is no login step and no read-only variant — the same credential reads status, kicks players, writes bans, replaces the server config and ends matches. The reference asks that it stay server-side. In a browser, use the proxy adapter so it does.

**Not every server exposes every route.** Call `GET /v1/capabilities` and check before offering a feature:

```ts
import { createCapabilities } from '@yuban32/wardogs-rcon-api';

const caps = createCapabilities(client);
if (await caps.supports('PATCH /v1/players/{steamId}')) {
  // offer "change faction"
}
if (await caps.configWritable()) {
  // offer the config editor
}
```

Capability strings are compared with path-parameter names collapsed, because the spec writes `{steamId}` where the reference's prose writes `{id}`. Both mean the same route.

---

## API

Every method below is available namespaced (`client.players.kick(...)`) and as a flat alias (`client.kickPlayer(...)`) — same implementation, whichever reads better at the call site.

### Match state

| Method                | Endpoint         | Returns  |
| --------------------- | ---------------- | -------- |
| `client.status.get()` | `GET /v1/status` | `Status` |

### Players

| Method                                        | Endpoint                             | Returns    |
| --------------------------------------------- | ------------------------------------ | ---------- |
| `client.players.list()`                       | `GET /v1/players`                    | `Player[]` |
| `client.players.kick(steamId, reason?)`       | `POST /v1/players/{steamId}/kick`    | `Ok`       |
| `client.players.kill(steamId)`                | `POST /v1/players/{steamId}/kill`    | `Ok`       |
| `client.players.message(steamId, message)`    | `POST /v1/players/{steamId}/message` | `Ok`       |
| `client.players.setFaction(steamId, faction)` | `PATCH /v1/players/{steamId}`        | `Ok`       |
| `client.broadcast(message)`                   | `POST /v1/broadcast`                 | `Ok`       |

`setFaction` is capability-gated server-side — check `capabilities.supports(...)` before offering it.

### Moderation

| Method                                 | Endpoint                              | Returns        |
| -------------------------------------- | ------------------------------------- | -------------- |
| `client.bans.list()`                   | `GET /v1/bans`                        | `Ban[]`        |
| `client.bans.add(steamId, reason?)`    | `POST /v1/bans`                       | `Ok`           |
| `client.bans.remove(steamId)`          | `DELETE /v1/bans/{steamId}`           | `Ok`           |
| `client.reservedSlots.list()`          | `GET /v1/reserved-slots`              | `string[]`     |
| `client.reservedSlots.add(steamId)`    | `POST /v1/reserved-slots`             | `Ok`           |
| `client.reservedSlots.remove(steamId)` | `DELETE /v1/reserved-slots/{steamId}` | `Ok`           |
| `client.audit.list(limit?)`            | `GET /v1/audit?limit=N`               | `AuditEntry[]` |

`limit` is 1–500; the server default is 50.

### Match control

| Method                                                                   | Endpoint                 | Returns |
| ------------------------------------------------------------------------ | ------------------------ | ------- |
| `client.match.setMap({ map, experiences?, lighting?, zoneAlternator? })` | `POST /v1/match/map`     | `Ok`    |
| `client.match.end()`                                                     | `POST /v1/match/end`     | `Ok`    |
| `client.match.restart()`                                                 | `POST /v1/match/restart` | `Ok`    |
| `client.world.setLighting(lighting)`                                     | `PUT /v1/world/lighting` | `Ok`    |

Omitted `MapSelection` fields fall back to the map's authored defaults — which is not the same as sending an empty string, so the client omits them rather than sending `null`.

### Rotation

| Method                                             | Endpoint                             | Returns    |
| -------------------------------------------------- | ------------------------------------ | ---------- |
| `client.rotation.get()`                            | `GET /v1/rotation`                   | `Rotation` |
| `client.rotation.addEntry(selection)`              | `POST /v1/rotation/entries`          | `Ok`       |
| `client.rotation.removeEntry(index)`               | `DELETE /v1/rotation/entries/{i}`    | `Ok`       |
| `client.rotation.moveEntry(index, 'up' \| 'down')` | `POST /v1/rotation/entries/{i}/move` | `Ok`       |
| `client.rotation.save()`                           | `POST /v1/rotation/save`             | `Ok`       |

Edits change the live rotation only. `save()` persists them to `ServerSettings.ini`; without it they are lost on restart.

### Settings, catalog, sponsor

| Method                                                                   | Endpoint                                | Returns          |
| ------------------------------------------------------------------------ | --------------------------------------- | ---------------- |
| `client.settings.patch({ scoreTick?, rotationEnabled?, rotationMode? })` | `PATCH /v1/settings`                    | `Ok`             |
| `client.catalog.maps()`                                                  | `GET /v1/catalog/maps`                  | `unknown`        |
| `client.catalog.lightings()`                                             | `GET /v1/catalog/lightings`             | `unknown`        |
| `client.catalog.experiences()`                                           | `GET /v1/catalog/experiences`           | `unknown`        |
| `client.catalog.mapExperiences(mapId)`                                   | `GET /v1/catalog/maps/{id}/experiences` | `MapExperiences` |
| `client.catalog.mapAlternators(mapId)`                                   | `GET /v1/catalog/maps/{id}/alternators` | `MapAlternators` |
| `client.sponsor.get()`                                                   | `GET /v1/sponsor`                       | `Sponsor`        |
| `client.sponsor.set(imageUrl)`                                           | `PUT /v1/sponsor`                       | `Ok`             |

The three catalog lists return `unknown`: the spec leaves their shape open and notes it "varies by endpoint". The two map-scoped ones are typed, but see the caveat in [docs/api.md](docs/api.md) — the spec types them as a plain success envelope, which cannot be right.

### Config

| Method                                                        | Endpoint                   | Returns        |
| ------------------------------------------------------------- | -------------------------- | -------------- |
| `client.config.get()`                                         | `GET /v1/config`           | `Config`       |
| `client.config.apply(text, { ifMatch?, force?, fullApply? })` | `PUT /v1/config`           | `ConfigResult` |
| `client.config.validate(text)`                                | `POST /v1/config/validate` | `ConfigResult` |

These two are the `text/plain` exception to an otherwise JSON API; the client handles that.

Pass the revision you read as `ifMatch` to detect a concurrent edit — a stale one fails with `412`:

```ts
const config = await client.config.get();
try {
  await client.config.apply(edited, { ifMatch: config.revision });
} catch (error) {
  if (isWardogsError(error) && error instanceof WardogsHttpError && error.isRevisionConflict) {
    // Re-read, re-apply your change, retry.
  }
}
```

### Meta and escape hatches

| Method                                   | Endpoint               | Returns            |
| ---------------------------------------- | ---------------------- | ------------------ |
| `client.meta.capabilities()`             | `GET /v1/capabilities` | `Capabilities`     |
| `client.meta.serverId()`                 | `GET /v1/server-id`    | `ServerId`         |
| `client.meta.health()`                   | `GET /v1/health`       | `Health`           |
| `client.ping()`                          | `GET /v1/status`       | `Promise<boolean>` |
| `client.request(method, path, options?)` | any                    | `Promise<T>`       |

`ping()` is the reference's token check: `true` on success, `false` on `401`/`403`, and it **throws** on anything else — a network outage is not reported as a bad password. `request()` reaches a route this library has not typed yet.

---

## Polling

There is no push channel — live data means polling. `createWatcher` handles the loop, the diffing, and the error recovery:

```ts
import { createWatcher } from '@yuban32/wardogs-rcon-api';

const watcher = createWatcher(client, {
  intervalMs: 5000, // the official panel refreshes every 3–5s
  watchPlayers: true, // also emit roster deltas — doubles the request count
});

watcher.on('change', ({ changed }) => console.log('changed:', changed));

watcher.on('players', ({ joined, left }) => {
  for (const p of joined) console.log(`${p.name} joined`);
  for (const p of left) console.log(`${p.name} left`);
});

watcher.on('error', (error) => console.error('tick failed, retrying:', error));

watcher.start();
// later
await watcher.stop();
```

A tick costs one request; `GET /v1/status` already carries the player count, faction scores and rotation indices. A failed tick is reported and retried on a growing backoff up to 8× the interval — a transient blip should not silently end monitoring on a dashboard left running for days. `stop()` waits for any in-flight request, so nothing is left dangling.

Snapshots are also async-iterable:

```ts
for await (const snapshot of watcher) {
  console.log(snapshot.status.players.current);
}
```

See [docs/watch.md](docs/watch.md).

---

## Config documents

`ServerSettings.ini` is Unreal-style INI with a wrinkle that matters: `+RotationEntries=` repeats, and each occurrence is a separate entry. A `Record<string, string>` would keep only the last.

```ts
import { createConfigDocument } from '@yuban32/wardogs-rcon-api';

const config = await client.config.get();
const doc = createConfigDocument(config.text);

doc.getNumber('/Script/Engine.GameSession', 'MaxPlayers'); // 128
doc.rotationEntries(); // parsed, in file order
doc.bannedPlayerIds(); // ["76561198000000009"]

const edited = doc
  .set('/Script/WDGame.WDGameSession', 'ServerName', 'New Name')
  .setBannedPlayerIds(['76561198000000009', '76561198000000011']);

await client.config.apply(edited.text, { ifMatch: config.revision });
```

Lookups are case-insensitive, matching Unreal's reader. Edits return a new document, so the one you read stays intact — which is what `ifMatch` needs.

The parser never throws: an unparseable line is collected in `doc.malformed` rather than making the whole document unusable. Unknown sections are preserved, not stripped, so a key the server is silently ignoring stays visible.

---

## Utilities

```ts
import { toSteamId64, isSteamId64, groupPlayersByFaction } from '@yuban32/wardogs-rcon-api';

toSteamId64('76561198000000001'); // ok
toSteamId64(76561198000000001); // throws TypeError — see below

const [players, status] = await Promise.all([client.players.list(), client.status.get()]);
groupPlayersByFaction(players, status.factionScores); // keyed by colorHex
```

**SteamID64 is never a `number`.** It needs 64 bits and a JS double carries 53, so `76561198000000001` becomes `...0000` — a different, plausible-looking id that bans the wrong person. `toSteamId64` throws on a number instead of coercing.

A player's `faction` is a name and the reference is explicit that `colorHex` is the stable key. `groupPlayersByFaction` and `resolvePlayerFactions` do that join, and leave the colour `undefined` rather than guessing when the server exposes no matching row.

---

## Errors

All errors extend `WardogsError`, and carry the request's method and URL.

| Class                 | When                                                                                                                          |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `WardogsHttpError`    | Non-2xx. Has `status`, `code`, `body`, plus `isRevisionConflict` (412), `isAuthError` (401/403) and `isRetryable` (5xx, 429). |
| `WardogsTimeoutError` | Exceeded `timeoutMs`.                                                                                                         |
| `WardogsAbortError`   | Cancelled by your `AbortSignal`.                                                                                              |
| `WardogsNetworkError` | No response: DNS, refused connection, TLS handshake, dropped socket.                                                          |
| `WardogsParseError`   | A claimed-JSON body did not parse. Carries the raw `body`.                                                                    |

A reverse proxy's HTML error page surfaces as a `WardogsHttpError` with `code: "http_502"` and the page's first readable line as the message — not as a parse failure.

### Retries

GET requests retry once by default, on transport failures and 5xx, with exponential backoff and jitter. **Writes are never retried.** A dropped connection does not tell you whether the server acted, and a retried `kick` could kick twice. Raise it with `retries`, or set `0`.

---

## Options

```ts
createClient({
  baseUrl: 'https://host:7776',
  token: 'rcon-password',

  timeoutMs: 15_000, // per request; 0 disables
  retries: 1, // extra GET attempts only
  fetch: myFetch, // transport override — see docs/adapters.md
  headers: { 'X-Trace': '…' }, // or a function, re-evaluated per request
  allowInsecureHttp: false, // permits plaintext http:// to a non-loopback host
});
```

`createClient` validates its configuration and throws rather than failing on the first request, so a typo is reported where it was made. Plaintext `http://` to a non-loopback host is refused outright with an explanation: a network-exposed listener requires TLS, so that connection can never succeed. Loopback is allowed, because that is the one case where plaintext is real.

Every method takes an optional last argument for per-call overrides:

```ts
await client.status.get({ timeoutMs: 3000, signal: controller.signal });
```

### TLS with a self-signed certificate

There is no option to disable certificate verification — that would be a footgun shipped as a convenience, on a connection carrying a full-access password. Pass your own transport instead:

```ts
import { Agent, fetch } from 'undici';

const client = createClient({
  baseUrl: 'https://my-server:7776',
  token,
  fetch: (url, init) =>
    fetch(url, { ...init, dispatcher: new Agent({ connect: { ca: myCaPem } }) }),
});
```

Full details in [docs/adapters.md](docs/adapters.md).

---

## Documentation

- [docs/api.md](docs/api.md) — every operation, with parameters, return types and `curl` equivalents
- [docs/adapters.md](docs/adapters.md) — direct vs proxy, custom transports, TLS, tracing
- [docs/watch.md](docs/watch.md) — polling cadence, event semantics, failure handling
- [CHANGELOG.md](CHANGELOG.md) — release history
- [examples/](examples/) — runnable Node, proxy and CDN examples

Chinese editions: [README](README.zh-CN.md) · [api](docs/api.zh-CN.md) · [adapters](docs/adapters.zh-CN.md) · [watch](docs/watch.zh-CN.md) · [changelog](CHANGELOG.zh-CN.md)

## Examples

```bash
node examples/mock-rcon-server.mjs      # a stand-in server, no game required
node examples/node-basic.mjs            # exercises the client against it
node examples/minimal-client.mjs        # the same walkthrough with no library at all
node examples/browser-proxy-server.mjs  # then open examples/cdn.html
```

The examples default to the mock. Point them at a real server with `WARDOGS_BASE_URL` and `WARDOGS_TOKEN`.

[examples/minimal-client.mjs](examples/minimal-client.mjs) is worth reading if you would rather not take a dependency, or are porting this to another language: it walks the same API with nothing but `fetch`.

---

## Web panel

[`web/`](web/) is a local control panel for a server: the whole route surface, capability-gated, with live polling and a config editor that respects the revision check.

```bash
node examples/mock-rcon-server.mjs &                                    # a server to talk to
WARDOGS_ALLOWED_ORIGINS=http://127.0.0.1:7777 \
WARDOGS_TOKEN=mock-rcon-password \
  node examples/browser-proxy-server.mjs &                              # the proxy, holding the token
cd web && pnpm install && pnpm dev                                      # http://localhost:5300
```

| Tab          | What it is                                                          |
| ------------ | ------------------------------------------------------------------- |
| Status       | Live match state, one-shot or polled, with change and roster deltas |
| Players      | The roster, with each faction colour resolved by name               |
| Routes       | All 37 operations, with forms and semantic response rendering       |
| Capabilities | Which routes this server implements, and how it spells them         |
| Config       | Read, edit, validate and apply `ServerSettings.ini` with `If-Match` |
| Log          | Every request, with status, duration, size and the mapped error     |

It is a development tool, not part of the published package: `web/` has its own `package.json`, its own lockfile and its own install (pnpm, while the library uses npm), and the root `verify` and publish paths are untouched by it. Read-only by default — writes are refused until you unlock them, and each one needs a second confirmation. See [web/README.md](web/README.md).

---

## Development

Git hooks are installed by `npm install` and run automatically:

| Hook         | Runs                                                  | Why there                                                                                                                                                                                                                                            |
| ------------ | ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pre-commit` | `lint-staged` → `format:check` → `typecheck` → `test` | `lint-staged` reformats what you staged, so a commit fixes its own formatting rather than failing and making you run it by hand. The repo-wide `format:check` after it covers what the commit did _not_ touch.                                       |
| `pre-push`   | `npm run verify`                                      | The last point where a broken build is cheap to catch. `npm publish` cannot be undone for a given version.                                                                                                                                           |
| `commit-msg` | Conventional Commits check                            | Warns, does not block — a hook that refuses a commit over punctuation teaches people to reach for `--no-verify`, which disables the typecheck and test hooks too. It also reminds you if `package.json`'s version changed without a changelog entry. |

The full suite runs on every commit because it takes well under a second — a hook slow enough to be skipped protects nothing. The build deliberately does **not** run on commit: it rewrites `dist/`, which would make `git status` noisy for no gain. `pre-push` covers it.

### Formatting

[Prettier](https://prettier.io) is the only style authority — no linter, no style debate. Config is in [.prettierrc.json](.prettierrc.json): 100 columns, single quotes, trailing commas everywhere.

```bash
npm run format         # write
npm run format:check   # verify — what CI runs
```

Two paths are deliberately excluded, in [.prettierignore](.prettierignore):

- **`spec/openapi.json`** is a verbatim snapshot of the community-published spec. Reformatting it would obscure the difference between what the server actually publishes and what we wrote — the one thing that file exists to preserve.
- **`package-lock.json`**, because npm owns its layout and reformatting it fights the tool that writes it.

```bash
npm run verify            # format + typecheck + tests + build + packaging checks
npm run check:changelog   # release notes match the manifest
npm test -- --watch       # the same suite, watching
```

---

## Publishing

`repository`, `bugs` and `homepage` are intentionally absent — a placeholder URL resolves to a stranger's account and renders as a broken link on the package page. Add your own before publishing.

Before each release, add the new version to [CHANGELOG.md](CHANGELOG.md) — `npm run check:changelog` verifies the newest entry matches `package.json` and that both language editions cover the same versions.

```bash
npm run verify            # typecheck + tests + build + packaging checks
npm run check:changelog   # release notes match the manifest
npm pack --dry-run        # confirm the tarball contents
git tag v0.1.0 && git push --tags
```

`.github/workflows/publish.yml` publishes on a `v*` tag, with `--provenance`, after verifying the tag matches `package.json`. It needs an `NPM_TOKEN` secret.

---

## License

MIT. Not affiliated with Bulkhead Interactive or Team17. See [NOTICE](NOTICE).
