# API reference

All 37 operations the `/v1` interface exposes, with their TypeScript signature and a `curl` equivalent. Paths are relative to `baseUrl`; every request carries `Authorization: Bearer <token>`.

`$BASE` below stands for your server, e.g. `https://my-server.example:7776`.

[中文](api.zh-CN.md) | **English**

---

## Deprecated operations

Eight write routes were removed from the server in build `++Wardogs+Live-CL-501228` (2026-09-14):

| Removed                              | Do this instead                                                        |
| ------------------------------------ | ---------------------------------------------------------------------- |
| `POST /v1/reserved-slots`            | Add the id to `DefaultReservedPlayers` in the config document          |
| `DELETE /v1/reserved-slots/{id}`     | Drop the id from `DefaultReservedPlayers`                              |
| `POST /v1/rotation/entries`          | Append a `RotationEntries` line                                        |
| `DELETE /v1/rotation/entries/{i}`    | Drop that `RotationEntries` line                                       |
| `POST /v1/rotation/entries/{i}/move` | Reorder the `RotationEntries` lines                                    |
| `POST /v1/rotation/save`             | Nothing — a config edit is already durable, the document _is_ the file |
| `PATCH /v1/settings`                 | `ScorePeriod` in `[/Script/WDGame.WDMatchState]`                       |
| `PUT /v1/sponsor`                    | `ServerImageURL` in the config document                                |

A current server answers `404` for all eight and omits them from `GET /v1/capabilities`; older builds still serve them, which is why the client methods remain and still work. Each carries an `@deprecated` tag naming its replacement, so an editor that renders those will flag the call site.

Check with `caps.supports(...)` rather than catching a `404` — that is exactly what `capabilities.routes` is for.

---

## Match state

### `GET /v1/status`

```ts
client.status.get(options?): Promise<Status>
```

```bash
curl -H "Authorization: Bearer $TOKEN" "$BASE/v1/status"
```

```jsonc
{
  "serverName": string,
  "map": string,                    // map id, e.g. "Kavkazi"
  "experiences": string[],
  "lighting": string,
  "alternator": string,
  "scoreTick": { "current": number, "min": number, "max": number },
  "scoreCap": number,
  "matchSeconds": number,
  "players": { "current": number, "max": number },
  "factionScores": [ { "name": string, "colorHex": string } ],
  "rotation": { "nowIndex": number | null, "nextIndex": number | null } | null
}
```

This is also the token check — there is no login endpoint.

---

## Players

### `GET /v1/players`

```ts
client.players.list(options?): Promise<Player[]>
```

```bash
curl -H "Authorization: Bearer $TOKEN" "$BASE/v1/players"
```

Wraps `{ players: [...] }`; the client unwraps it. Each player is `{ name, steamId, faction, kills, deaths, cash, pingMs }`.

`faction` is a server-defined **name**. The reference is explicit that `colorHex` on a `factionScores` row is the stable key — use `groupPlayersByFaction` or `resolvePlayerFactions` rather than matching names yourself.

### `POST /v1/players/{steamId}/kick`

```ts
client.players.kick(steamId: string, reason?: string, options?): Promise<Ok>
```

```bash
curl -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"reason":"teamkilling"}' "$BASE/v1/players/76561198000000001/kick"
```

The body is `{}` when `reason` is omitted — the key is absent, not empty.

### `POST /v1/players/{steamId}/kill`

```ts
client.players.kill(steamId: string, options?): Promise<Ok>
```

Kills in-match without disconnecting.

### `POST /v1/players/{steamId}/message`

```ts
client.players.message(steamId: string, message: string, options?): Promise<Ok>
```

### `PATCH /v1/players/{steamId}`

```ts
client.players.setFaction(steamId: string, faction: string, options?): Promise<Ok>
```

**Capability-gated.** The reference notes the admin panel offers "change team" only when this route is in `GET /v1/capabilities`. Check before offering it:

```ts
if (await caps.supports('PATCH /v1/players/{steamId}')) {
  /* … */
}
```

### `POST /v1/broadcast`

```ts
client.broadcast(message: string, options?): Promise<Ok>
```

Filed under "Players" in the reference, but not player-scoped, so it lives at the top level of the client.

---

## Moderation

### `GET /v1/bans`

```ts
client.bans.list(options?): Promise<Ban[]>   // { steamId, bannedAtUtc, bannedBy, reason }[]
```

### `POST /v1/bans`

```ts
client.bans.add(steamId: string, reason?: string, options?): Promise<Ok>
```

### `DELETE /v1/bans/{steamId}`

```ts
client.bans.remove(steamId: string, options?): Promise<Ok>
```

### `GET /v1/reserved-slots`

```ts
client.reservedSlots.list(options?): Promise<string[]>   // SteamID64 strings
```

### `POST /v1/reserved-slots`

```ts
client.reservedSlots.add(steamId: string, options?): Promise<Ok>
```

### `DELETE /v1/reserved-slots/{steamId}`

```ts
client.reservedSlots.remove(steamId: string, options?): Promise<Ok>
```

### `GET /v1/audit`

```ts
client.audit.list(limit?: number, options?): Promise<AuditEntry[]>
```

`limit` is 1–500; the server default is 50. Omitted entirely when not given rather than sent as `undefined`.

---

## Match control

### `POST /v1/match/map`

```ts
client.match.setMap(selection: MapSelection, options?): Promise<Ok>

interface MapSelection {
  map: string;
  experiences?: string[];
  lighting?: string;
  zoneAlternator?: string;
}
```

Only `map` is required. Omitted fields fall back to the map's authored defaults, which is **not** the same as sending an empty string — the client omits them.

### `POST /v1/match/end` · `POST /v1/match/restart`

```ts
client.match.end(options?): Promise<Ok>
client.match.restart(options?): Promise<Ok>
```

### `PUT /v1/world/lighting`

```ts
client.world.setLighting(lighting: string, options?): Promise<Ok>
```

Changes lighting live, without a map change.

---

## Rotation

### `GET /v1/rotation`

```ts
client.rotation.get(options?): Promise<Rotation>
```

```jsonc
{
  "enabled": boolean,
  "mode": "ordered" | "random",
  "entries": [{
    "map": string, "experiences": string[], "lighting": string,
    "zoneAlternator": string,
    "status": "now" | "next" | string,   // position in the cycle
    "denied": boolean
  }]
}
```

### `POST /v1/rotation/entries`

```ts
client.rotation.addEntry(selection: MapSelection, options?): Promise<Ok>
```

### `DELETE /v1/rotation/entries/{i}`

```ts
client.rotation.removeEntry(index: number, options?): Promise<Ok>
```

### `POST /v1/rotation/entries/{i}/move`

```ts
client.rotation.moveEntry(index: number, direction: 'up' | 'down', options?): Promise<Ok>
```

### `POST /v1/rotation/save`

```ts
client.rotation.save(options?): Promise<Ok>
```

Add, remove and move change the **live** rotation. This persists them to `ServerSettings.ini`; without it the changes are lost on restart.

---

## Settings

### `PATCH /v1/settings`

```ts
client.settings.patch(patch: SettingsPatch, options?): Promise<Ok>

interface SettingsPatch {
  scoreTick?: number;       // seconds between score ticks; the server accepts 18–30
  rotationEnabled?: boolean;
  rotationMode?: string;
}
```

All fields optional — this is a patch. Only the keys you provide are sent.

---

## Catalog

### `GET /v1/catalog/maps` · `GET /v1/catalog/lightings` · `GET /v1/catalog/experiences`

```ts
client.catalog.maps(options?): Promise<unknown>
client.catalog.lightings(options?): Promise<unknown>
client.catalog.experiences(options?): Promise<unknown>
```

Typed as `unknown` on purpose. The spec leaves `Catalog` empty and notes its shape "varies by endpoint"; the reference does not pin the field names either. Inspect the payload once against your server and narrow it.

### `GET /v1/catalog/maps/{id}/experiences` · `GET /v1/catalog/maps/{id}/alternators`

```ts
client.catalog.mapExperiences(mapId: string, options?): Promise<MapExperiences>
client.catalog.mapAlternators(mapId: string, options?): Promise<MapAlternators>
```

> **Spec divergence.** The spec types both as a plain `Ok`, which cannot be right — the operations are named for and documented as returning lists. It does not pin the field name either. `MapExperiences` and `MapAlternators` therefore carry the `Ok` members plus an optional typed list (`experiences` / `alternators`) and stay open for anything else. **Verify against your own server** before relying on the field name; the shape is the one place in this library where the documented contract is genuinely unknown.

---

## Sponsor

### `GET /v1/sponsor`

```ts
client.sponsor.get(options?): Promise<Sponsor>   // { imageUrl }
```

### `PUT /v1/sponsor`

```ts
client.sponsor.set(imageUrl: string, options?): Promise<Ok>
```

The banner must be a 1024×256 PNG/JPEG on the server's allow-list.

---

## Config

### `GET /v1/config`

```ts
client.config.get(options?): Promise<Config>
```

Returns `{ revision, writable, text, sections, warnings }`. `text` is the authoritative document; `revision` is what `ifMatch` needs.

Subscribing to edits: `writable` is the same flag `capabilities.configWritable()` reports.

### `PUT /v1/config`

```ts
client.config.apply(
  text: string,
  options?: { ifMatch?: string; force?: boolean; fullApply?: boolean } & CallOptions,
): Promise<ConfigResult>
```

```bash
curl -X PUT -H "Authorization: Bearer $TOKEN" -H "Content-Type: text/plain" \
  -H 'If-Match: "rev-1"' --data-binary @ServerSettings.ini "$BASE/v1/config"
```

One of the two `text/plain` endpoints — the client sets the header for you. `ifMatch` is quoted as HTTP requires for an entity-tag; a revision that already includes quotes is not double-quoted, and one containing a quote or a line break is rejected rather than emitted as a malformed header.

A stale revision returns **HTTP 412**:

```ts
const error = await client.config.apply(text, { ifMatch: 'stale' }).catch((e) => e);
if (error instanceof WardogsHttpError && error.isRevisionConflict) {
  // Re-read, re-apply your change, retry.
}
```

### `POST /v1/config/validate`

```ts
client.config.validate(text: string, options?): Promise<ConfigResult>
```

Checks a document without applying it. Also `text/plain`.

### `ConfigResult`

```jsonc
{
  "ok": boolean,
  "revision": string,
  "error": { "code": string, "message": string },
  "errors": ConfigError[],    // non-empty means nothing was applied
  "outcomes": unknown[],
  "changed": ConfigChange[],  // sections this document would change
  "shadowed": unknown[],      // keys shadowed by a later duplicate
  "stripped": unknown[],      // keys stripped as not allow-listed
  "conflict": unknown[],      // present on HTTP 412
  "warnings": string[],
  "timingsMs": object | null
}

interface ConfigError  { section: string; key: string; code: string; message: string }
interface ConfigChange { section: string; added?: boolean; removed?: boolean; keys?: string[] }
```

Spec 1.1.0 typed `errors` and `changed` properly, so those two are `ConfigError[]` and `ConfigChange[]` here. The remaining outcome arrays are still `items: {}` in the spec and stay `unknown[]` rather than guessed at.

`errors` is the one that matters when a write fails: nothing is applied while it is non-empty, so a single stale value — a sponsor URL whose host has dropped off `ImageURLWhitelist`, say — blocks unrelated edits until it is corrected. `message` is written for a human and is safe to show as-is.

---

## Meta

### `GET /v1/capabilities`

```ts
client.meta.capabilities(options?): Promise<Capabilities>

interface Capabilities {
  apiVersion?: string;              // "1"
  build?: string;                   // "++Wardogs+Live-CL-501228"
  auth?: { scheme: string; header: string };
  limits?: { maxBodyBytes: number; maxRequestsPerMinutePerIp: number };
  config: { writable: boolean; document?: string };
  routes: string[];                 // e.g. "PATCH /v1/players/{id}"
}
```

The authoritative list of what a given server exposes. `routes` entries are compared with path-parameter names collapsed, so `{id}` and `{steamId}` are the same route:

```ts
const caps = createCapabilities(client); // cached, 30s TTL
await caps.supports('PATCH /v1/players/{steamId}');
await caps.configWritable();
await caps.get(true); // force a refresh
```

Everything except `routes` and `config.writable` is optional: spec 1.1.0 documented them for the first time, and a server on an older build simply does not send them. `build` is the one to log when a capability check fails — it names the exact server build the answer came from, which is usually the whole explanation.

`findRouteEntries(capabilities, route)` returns the server's own strings for a match, which is what you want when the check failed and you are comparing by eye.

### `GET /v1/server-id`

```ts
client.meta.serverId(options?): Promise<ServerId>

interface ServerId {
  serverId: string;
}
```

An opaque id that survives restarts and map changes. Key stored state on it rather than `host:port`, which moves when a server is re-hosted — a dashboard that keyed its history on the address loses it on the next migration.

### `GET /v1/health`

```ts
client.meta.health(options?): Promise<Health>

interface Health {
  status: string;
  uptimeSeconds: number;
  connections: { active: number };
  gameThreadQueue: { inFlight: number; depth: number; rejectedTotal: number };
}
```

Uptime, live connection count and the game-thread work queue. A climbing `gameThreadQueue.depth` or a rising `rejectedTotal` means the server is shedding admin requests — the signal to back a poll loop off, not to retry harder.

### `GET /v1/status` as a ping

```ts
client.ping(options?): Promise<boolean>
```

`true` on success, `false` on `401`/`403`, **throws** on anything else. Conflating "unreachable" with "wrong password" sends an operator to check a credential that was never the problem.

---

## Escape hatch

```ts
client.request<T>(
  method: string,
  path: string,
  options?: CallOptions & { query?: Record<string, QueryValue>; body?: unknown },
): Promise<T>
```

For a route a server exposes that this library has not typed yet. Query values that are `undefined` or `null` are omitted.

---

## Per-call options

Every method takes an optional last argument:

```ts
interface CallOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
  retries?: number; // GET only
}
```

```ts
const controller = new AbortController();
await client.status.get({ timeoutMs: 3000, signal: controller.signal });
```

---

## Route ids

`ROUTE_IDS` and the `RouteId` type list all 37 operations as `"METHOD /path"` strings, which is the form `capabilities.routes` uses.

```ts
import { ROUTE_IDS, normalizeRoute, isRouteId } from '@yuban32/wardogs-rcon-api';
```

`normalizeRoute('patch /v1/players/{id}/')` → `'PATCH /v1/players/{*}'`. These are the strings the conformance test compares against the vendored spec, so a server-side change fails the build.
