# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A zero-runtime-dependency TypeScript client for the Wardogs dedicated server RCON HTTP API (`/v1`). Unofficial — it targets a community-published spec vendored at `spec/openapi.json`. Ships ESM + CJS + type declarations + a UMD bundle from one source, targeting Node 18+, Bun, Deno and browsers.

The whole design is shaped by three constraints, and code that violates one is usually wrong:

1. **No runtime dependencies and no Node built-ins in `src/`.** The UMD bundle runs in a `<script>` tag. Both Vite configs set `external: []` deliberately, so a stray `require('fs')` or npm import fails the build instead of silently bundling. `src/watch/emitter.ts` exists rather than Node's `EventEmitter` for this reason.
2. **Everything funnels through one transport seam.** `FetchLike` (`src/core/http.ts`) is the only way a request leaves the library. Every test drives that seam with a recording double, so no test needs a network.
3. **The spec can change underfoot.** Route and schema conformance is asserted against the vendored spec in tests, so a server-side change fails CI rather than a user's dashboard.

## Commands

```bash
npm run verify          # format:check → typecheck → test → build → lint:pkg  (what pre-push runs)
npm test                # vitest run — 278 tests, ~2s
npm test -- tests/http.test.ts        # one file
npm test -- -t "retries"              # by test name
npm run build           # ESM + CJS + d.ts, then UMD, then asserts artifacts and version sync
npm run typecheck       # tsc --noEmit
npm run format / format:check         # Prettier is the only style authority; no linter exists
npm run check:changelog # release notes agree with package.json, both languages
npm run lint:pkg        # packaging: exports resolve, files list, UMD wrapper, doc links
```

Git hooks (installed by `npm install`) run the full suite plus typecheck on every commit; `pre-push` runs `npm run verify`. The build is deliberately not in `pre-commit` (it rewrites `dist/`). Use `--no-verify` sparingly — it skips the tests too. Commit subjects follow Conventional Commits; the hook warns but does not block.

`node-basic.mjs` imports the **built** `dist/`, so `npm run build` before running it. `minimal-client.mjs` imports nothing — it is the same walkthrough on the global `fetch`, and is the one to copy from or port to another language.

```bash
node examples/mock-rcon-server.mjs      # stand-in server on 127.0.0.1:7777, no game needed
node examples/node-basic.mjs            # exercises the library against it
node examples/minimal-client.mjs        # same API, no library
node examples/browser-proxy-server.mjs  # then open examples/cdn.html
```

`WARDOGS_BASE_URL` / `WARDOGS_TOKEN` point them at a real server; `WARDOGS_WRITES=1` enables the examples' destructive sections.

## The web panel (`web/`)

A React + Vite control panel for a running server: all 35 routes with forms, capability gating, live polling, and a config editor that respects `If-Match`. It is a **separate package** — its own `package.json`, its own lockfile, its own install — and deliberately not an npm workspace, so the root `npm ci`, `verify` and publish paths are untouched. `scripts/check-exports.mjs` asserts `web` is never published.

**pnpm in `web/`, npm at the root.** The two never meet: this package is not a workspace member, and the root jobs never enter it. CI mirrors the split — `npm ci` for the library, `pnpm install --frozen-lockfile` for the panel.

```bash
cd web && pnpm install && pnpm dev   # http://localhost:5300, /rcon-proxy → 127.0.0.1:8787
cd web && pnpm test                  # route registry, connection layer, formatters
```

Two things to know before changing it:

- **It imports the library's source**, not `dist`, through a `@wardogs/api` alias in `web/vite.config.ts` (mirrored in `web/tsconfig.json`). No root build is needed, library edits hot-reload — and the library's `src/` is typechecked under the panel's `tsconfig.json`, which is why that config copies the root's strict flags rather than relaxing them.
- **The route registry is checked against `ROUTE_IDS`** in `web/src/lib/routes.test.ts`. Do not hand-copy the route list; extend `src/lib/routes.ts` and let the test tell you what is missing.
- **A `createClient` always emits an `Authorization` header** — it has no "no credential" state. In proxy mode the panel passes a placeholder token purely to satisfy the constructor, and `createProxyTransport` in `web/src/lib/connection.ts` deletes that header before the request leaves, so a backend-held credential is never replaced by a bogus one. `connection.test.ts` pins both directions.

Root `npm run format` / `format:check` do cover `web/**` (they inherit `.prettierrc.json`), but root `typecheck` and `test` do not — CI has a separate `panel` job for it.

## Architecture

```
src/index.ts ── CJS + ESM + bundled index.d.ts   (vite.config.ts, via vite-plugin-dts rollupTypes)
src/umd.ts   ── UMD, WardogsRCON global, ES2018  (vite.umd.config.ts, second invocation)
```

`src/index.ts` is the public surface: every export a consumer can reach is listed there explicitly, with no wildcard re-exports. Adding a module means adding its exports here or it does not exist.

**Layer map** (each layer only calls downward):

- `core/http.ts` — the transport. `request()` implements the timeout wiring, the GET-only retry policy, body decoding and the mapping of transport failures onto the error vocabulary. The `http://`-to-a-remote-host guard lives in `normalizeBaseUrl`. All of this exists exactly once, here, so it cannot drift per endpoint.
- `core/client.ts` — `createClient` builds every namespace method over one private `call()` that invokes `request()`. Each namespaced method also has a flat alias (`client.kickPlayer` === `client.players.kick`), assembled at the bottom of the file. Config validation happens at construction, not first request.
- `core/routes.ts` — `RouteId` + `ROUTE_IDS`: the canonical list of all 35 operations as `"METHOD /v1/..."`, the same form `GET /v1/capabilities` reports. `normalizeRoute` collapses path-parameter _names_ to `{*}` and drops trailing slashes; without it a capability check reports a supported route as unsupported, because the spec writes `{steamId}` where the prose reference writes `{id}`.
- `core/types.ts` — hand-written mirrors of `components/schemas`, each `extends Extensible` so undocumented server fields do not break callers.
- `core/errors.ts` — `Wardogs*`-prefixed hierarchy, all carrying `method` and `url`.

**On top of the client:**

- `capabilities.ts` — TTL-cached probe (`supports`, `configWritable`) that collapses concurrent misses onto one request.
- `watch/watcher.ts` + `watch/emitter.ts` — polling with change detection and backoff. The loop is a self-rescheduling `setTimeout`, not `setInterval`, so a slow response delays the next tick instead of stacking requests. A tick is one request unless `watchPlayers` is on.
- `config/ini.ts` → `config/doc.ts` → `config/rotation.ts` — the config pipeline. `ini.ts` parses losslessly (repeated `+Key=` lines stay separate entries, unknown sections are preserved); `doc.ts` wraps it in immutable edits where `setList` (not `set`) is what you want for repeated keys; `rotation.ts` handles the `Experience` (singular, one) vs `Experiences` (plural, `+`-joined) split and the optional `ZoneAlternator`, where omitting is _not_ the same as sending an empty string.
- `utils/steam.ts` — SteamID64 is always a `string`. A JS number carries 53 bits, so `76561198000000001` silently becomes a different, plausible id that bans the wrong person. Arithmetic on ids is a bug.
- `utils/factions.ts` — joins `player.faction` to `factionScores` rows by name, with `colorHex` as the stable key. Unresolvable players keep `undefined` colour rather than a guessed one.
- `adapters/direct.ts` / `adapters/proxy.ts` — the two transports. `direct` is the default; `proxy` describes the real request in headers (`X-Wardogs-Target`, `X-Wardogs-Method`) and POSTs to a same-origin backend, which is the only way a browser can work and the only way the bearer token — a full-access admin password with no read-only variant — stays server-side.

## Things that will bite

- **`src/version.ts` must match `package.json`.** `VERSION`, `SPEC_VERSION` and `SPEC_UPDATED` are source constants (not a JSON import, which would pull the manifest into the UMD bundle). `scripts/build.mjs` and `scripts/check-exports.mjs` both assert the sync; refreshing `spec/openapi.json` means updating `SPEC_*`.
- **Writes are never retried** — the `isRetryable` default is GET-only. A retried `kick` could kick twice, and a transport failure does not tell you whether the server acted. Do not "helpfully" widen this.
- **Runs of prose comments are the house style.** Comments here explain _why_ a decision was made, often naming the alternative that was rejected. Match that; do not strip comments or replace them with restatements of the code.
- **Import specifiers in `src/` are `.js`** even though the files are `.ts` (`verbatimModuleSyntax` + ESM output). Tests import from `../src/index.js`; examples import from `../dist/index.js`.
- **`.prettierignore` deliberately excludes `spec/`** (a verbatim snapshot — reformatting it hides the diff between the published spec and this repo) **and `package-lock.json`** (npm owns its layout).
- **`msw` is an unused devDependency.** Tests use the recording-fetch double in `tests/helpers.ts`, not an interceptor.

## Adding or changing an API operation

The spec is the source of truth, and several checks are wired to it, so a new endpoint touches all of:

1. `spec/openapi.json` (re-vendor) and `SPEC_VERSION` / `SPEC_UPDATED` in `src/version.ts`.
2. `src/core/routes.ts` — both the `RouteId` union and `ROUTE_IDS`.
3. `src/core/types.ts` — a type per schema name; `tests/routes.test.ts` asserts the type list and the schema list are identical, and that `ROUTE_IDS` equals the spec's routes exactly (35 across 31 paths).
4. `src/core/client.ts` — the namespace method, plus its flat alias.
5. `src/index.ts` — any new exported type.
6. Docs, in both languages: `README.md` + `README.zh-CN.md` tables, and `docs/api.md` + `docs/api.zh-CN.md`. `scripts/check-exports.mjs` fails if a published English document lacks a link to its `zh-CN` counterpart or vice versa.
7. A `CHANGELOG.md` entry, with the same version present in `CHANGELOG.zh-CN.md` — `npm run check:changelog` enforces both.
