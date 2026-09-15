# Changelog

All notable changes to this project are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

[中文](CHANGELOG.zh-CN.md) | **English**

## [Unreleased]

### Added

- **`GET /v1/server-id` and `GET /v1/health`.** `client.meta.serverId()` returns
  an opaque id that survives restarts and map changes — key stored state on it
  rather than `host:port`, which moves. `client.meta.health()` returns uptime,
  live connections and the game-thread work queue, where a climbing `depth` or a
  rising `rejectedTotal` means the server is shedding admin requests. Both are
  new in build `++Wardogs+Live-CL-501228`; a server older than that answers
  `404`. Exposed as `ServerId` and `Health`, with the flat aliases
  `getServerId()` and `getHealth()`.
- **`Capabilities` now carries what spec 1.1.0 documented**: `apiVersion`,
  `build`, `auth`, `limits` and `config.document`. All optional — an older
  build simply does not send them, and `routes` / `config.writable` stay
  required so existing callers are unaffected. `build` is the one to log when a
  capability check fails; it names the exact server build the answer came from.
- **`ConfigError` and `ConfigChange`**, and `ConfigResult.errors` /
  `.changed` are now typed with them instead of `unknown[]`. `errors` is
  non-empty only when nothing was applied, which is the case worth handling.

### Changed

- **Re-vendored the spec to 1.1.0 (2026-09-14, build
  `++Wardogs+Live-CL-501228`)**, up from 0.27 (2026-09-10). `SPEC_VERSION` and
  `SPEC_UPDATED` follow. A test now pins both constants to the vendored file, so
  a refresh of one without the other fails rather than drifting silently — which
  is how this build fell two spec releases behind.
- **The route list grew from 35 operations across 31 paths to 37 across 33.**
  `ROUTE_IDS` and the web panel's registry are updated together.
- **Eight write operations are marked `@deprecated`.** The 2026-09-14 build
  removed `POST`/`DELETE /v1/reserved-slots`, `POST`/`DELETE
/v1/rotation/entries`, `POST /v1/rotation/entries/{i}/move`, `POST
/v1/rotation/save`, `PATCH /v1/settings` and `PUT /v1/sponsor`, moving what
  they did into the config document. A current server answers `404` and omits
  them from `capabilities.routes`. **The methods still exist and still work** —
  older builds serve them — and each now names its replacement so an editor
  flags the call site. No runtime behaviour changed.

### Notes

- Prettier is enforced. `.prettierrc.json` (100 columns, single quotes,
  trailing commas), `npm run format` and `npm run format:check`. CI and the
  publish workflow both run `format:check`, and it is the first step of
  `npm run verify`.
- **`pre-commit` now formats what you staged** via `lint-staged`, then checks
  the whole repository, before running the typecheck and tests. Formatting a
  file you are about to commit should not be a separate manual step.
- **`examples/minimal-client.mjs`** — the same walkthrough as `node-basic.mjs`
  with no library at all, using the global `fetch`. It exists to be copied into
  another project or ported to another language, and it runs in CI so it cannot
  rot quietly.
- **A web panel.** `web/` is a local control panel for a running server: all 35
  routes with forms and semantic response rendering, capability-gated, live
  polling for match state, and a config editor that reads, validates and applies
  `ServerSettings.ini` with `If-Match`. It is a separate package with its own
  install and its own lockfile — deliberately not an npm workspace — so the root
  `npm install`, `npm run verify` and the publish path are unchanged. Read-only
  by default, and the RCON token is never persisted. See
  [web/README.md](web/README.md).

### Notes

- Two paths are excluded from formatting, in `.prettierignore`:
  **`spec/openapi.json`**, because it is a verbatim snapshot of the
  community-published spec and reformatting it would obscure the difference
  between what the server publishes and what this repository wrote — the one
  thing that file exists to preserve; and **`package-lock.json`**, because npm
  owns its layout.
- No linter is configured. Prettier is the only style authority, so there is one
  place a style question is answered rather than two that can disagree.
- Applying Prettier reformatted the existing source. The changes are
  whitespace-only — line rejoining and trailing commas — and the full suite
  passes unchanged.

## [0.1.0] — 2026-09-14

First release.

### Added

- **Typed client** covering all 35 operations of the WarDogs RCON HTTP API
  (`/v1`), derived from spec version `0.27` (updated 2026-09-10). Every method is
  available namespaced (`client.players.kick(...)`) and as a flat alias
  (`client.kickPlayer(...)`).
- **Three module formats from one source**: ESM, CommonJS and UMD, with bundled
  type declarations. The UMD build attaches a single `WardogsRCON` global rather
  than scattering names across `window`.
- **`createWatcher`** — polling with change detection, roster diffing keyed by
  SteamID64, exponential backoff on failure, and bounded buffering for
  `for await` consumers. A tick costs one request: `GET /v1/status` already
  carries what the documented events need.
- **`createCapabilities`** — cached feature detection. Route comparison collapses
  path-parameter names, so `{id}` and `{steamId}` compare equal; a literal
  comparison reports a supported feature as unsupported.
- **Config document helpers** — `ServerSettings.ini` parsing that preserves the
  repeated `+Key=` lines, with immutable edits, rotation-entry parsing (handling
  the singular `Experience` / plural `Experiences` split), and banned/reserved
  id list access.
- **`createProxyFetch`** — a same-origin transport for browsers, where CORS
  headers and mixed-content rules otherwise block the request and where the
  token can stay on your backend.
- **`createDirectFetch`** — the default transport, resolving `fetch` at request
  time so a polyfill installed after import still works.
- **SteamID64 helpers** that refuse a `number`, which cannot represent 17 digits
  and yields a plausible id belonging to someone else.
- **Faction helpers** (`groupPlayersByFaction`, `resolvePlayerFactions`) joining
  players to `factionScores` by `colorHex`.
- **Error hierarchy** — `WardogsHttpError`, `WardogsTimeoutError`,
  `WardogsAbortError`, `WardogsNetworkError`, `WardogsParseError`, all extending
  `WardogsError` and carrying the request method and URL.
- **Documentation** in English and Chinese: README, `docs/api.md`,
  `docs/adapters.md`, `docs/watch.md`, and this changelog.
- **Runnable examples**: a mock RCON server, a Node walkthrough, a
  dependency-free browser proxy, and a CDN page.
- **Conformance tests** comparing the shipped route surface against a vendored
  copy of the community spec, so an API change fails the build rather than a
  user's dashboard.

### Design decisions

These are the choices most likely to surprise someone reading the code later, so
they are recorded rather than left implicit.

- **Writes are never retried.** A dropped connection does not say whether the
  server acted, and a retried `kick` could kick twice. GET requests retry once,
  on transport failures and 5xx, with jittered exponential backoff.
- **Plaintext `http://` to a non-loopback host is refused at construction.**
  A network-exposed RCON listener requires TLS, so that connection can never
  succeed. Failing where the configuration was written names the problem
  instead of producing a socket error. Loopback is allowed — that is the one
  case where plaintext is real.
- **Certificate verification is not disableable.** There is no
  `rejectUnauthorized: false` option; a caller supplies their own transport
  instead. The connection carries a full-access admin password, so a
  convenience flag here would be a footgun.
- **A caller cancellation takes precedence over the error's name.** A caller may
  legitimately abort with a `TimeoutError`, and the signal being aborted is
  direct evidence where the name is only a hint.
- **Non-JSON error bodies decode leniently.** A gateway's HTML 502 surfaces as
  `WardogsHttpError` with `code: "http_502"` and a readable message, rather than
  as a JSON parse failure that hides the status code.
- **`null`/`undefined` query values are omitted, not serialized.** For
  `POST /v1/match/map`, an omitted key selects the map's authored default — which
  is not the same as an empty value.
- **The catalog list endpoints return `unknown`.** The spec leaves their shape
  open and notes it "varies by endpoint". Guessing would be worse than making
  the caller look.

### Notes

- **Unofficial.** Targets a community reference, not a developer-published API.
  It may change without notice. `SPEC_VERSION` and `SPEC_UPDATED` record the
  revision this release was written against.
- **`GET /v1/catalog/maps/{id}/experiences` and `.../alternators` are the one
  genuinely unknown shape.** The spec types both as a plain success envelope,
  which cannot be correct — they return lists — and the prose reference does not
  pin the field name. `MapExperiences` and `MapAlternators` therefore carry an
  optional typed field and stay open. Verify against your own server before
  relying on it.
- Requires Node 18+ (the first release with a global `fetch`). No polyfill is
  bundled. Node, Bun, Deno, browsers and workers all work; the browser case may
  need `createProxyFetch`.
- Zero runtime dependencies, no Node built-ins.
