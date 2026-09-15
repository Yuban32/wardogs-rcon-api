/**
 * Response and request-body types for the Wardogs RCON HTTP API (v1).
 *
 * Hand-written to mirror `components/schemas` in the spec snapshot at
 * `spec/openapi.json` (OpenAPI 3.0.3, spec version 1.1.0, updated 2026-09-14).
 * `tests/routes.test.ts` asserts the two stay in sync, so a server-side API
 * change surfaces as a failing test rather than a runtime surprise.
 *
 * The API is unofficially documented by the community at
 * https://wardogs.tech/rcon-reference — it is not affiliated with the game's
 * developers and may change without notice. Where that reference's prose
 * contradicts the machine-readable spec, the prose wins here, and the
 * divergence is called out in a comment.
 */

/** Every response object may carry extra fields beyond the documented ones. */
type Extensible = Record<string, unknown>;

/* -------------------------------------------------------------------------- */
/* Common envelopes                                                            */
/* -------------------------------------------------------------------------- */

/** The standard success envelope returned by write endpoints that have nothing else to say. */
export interface Ok extends Extensible {
  ok: boolean;
  /** Human-readable note; present on some endpoints but not guaranteed. */
  message?: string;
}

/** The error envelope. Returned with a non-2xx status. */
export interface ErrorBody extends Extensible {
  error: {
    code: string;
    message: string;
  };
}

/* -------------------------------------------------------------------------- */
/* Match state                                                                 */
/* -------------------------------------------------------------------------- */

/** One faction's row in {@link Status.factionScores}. */
export interface FactionScore extends Extensible {
  name: string;
  /** The stable key across servers: match a player's `faction` name to this. */
  colorHex: string;
}

/**
 * Live match state. Returned by `GET /v1/status`.
 *
 * Uses bare object literals rather than named types for the nested groups
 * (`scoreTick`, `players`, `rotation`) because they appear inline in the spec
 * and are not reused anywhere else.
 */
export interface Status extends Extensible {
  serverName: string;
  /** Map id, e.g. `"Kavkazi"`. */
  map: string;
  experiences: string[];
  lighting: string;
  alternator: string;
  scoreTick: {
    current: number;
    min: number;
    max: number;
  };
  scoreCap: number;
  matchSeconds: number;
  players: {
    current: number;
    max: number;
  };
  /** One row per faction. */
  factionScores: FactionScore[];
  /**
   * `null` when the server has no rotation configured; the individual indices
   * are also nullable, so a rotation may exist with no known next entry.
   */
  rotation: {
    nowIndex: number | null;
    nextIndex: number | null;
  } | null;
}

/* -------------------------------------------------------------------------- */
/* Players                                                                     */
/* -------------------------------------------------------------------------- */

export interface Player extends Extensible {
  /** In-game name. Not the Steam profile name — see the reference on that. */
  name: string;
  /** SteamID64. */
  steamId: string;
  /**
   * A server-defined faction name. Match it to a {@link FactionScore} row
   * using `colorHex`, which is the stable identifier.
   */
  faction: string;
  kills: number;
  deaths: number;
  cash: number;
  pingMs: number;
}

export interface Players extends Extensible {
  players: Player[];
}

/* -------------------------------------------------------------------------- */
/* Meta                                                                        */
/* -------------------------------------------------------------------------- */

/**
 * What a given server actually supports. Returned by `GET /v1/capabilities`.
 *
 * Not every server enables every route — the reference is explicit that this
 * is the authoritative list, and that callers should check here rather than
 * assume. `routes` entries look like `"PATCH /v1/players/{id}"`.
 *
 * Spec 1.1.0 filled this out considerably: `apiVersion`, `build`, `auth` and
 * `limits` were previously undocumented, and `config` gained `document`. They
 * are all optional here because a server running an older build simply does
 * not send them, while `routes` and `config.writable` have been mandatory all
 * along and callers already depend on that.
 */
export interface Capabilities extends Extensible {
  /** The API generation, e.g. `"1"`. */
  apiVersion?: string;
  /** Engine build string, e.g. `"++Wardogs+Live-CL-501228"`. */
  build?: string;
  auth?: {
    scheme: string;
    header: string;
  };
  limits?: {
    maxBodyBytes: number;
    maxRequestsPerMinutePerIp: number;
  };
  config: {
    writable: boolean;
    /** Path of the config document, normally `"/v1/config"`. */
    document?: string;
  };
  routes: string[];
}

/* -------------------------------------------------------------------------- */
/* Server identity and liveness                                                */
/* -------------------------------------------------------------------------- */

/** Returned by `GET /v1/server-id`. */
export interface ServerId extends Extensible {
  /**
   * An opaque id that survives restarts and map changes.
   *
   * Use it to key stored state instead of `host:port`, which moves.
   */
  serverId: string;
}

/**
 * Returned by `GET /v1/health`.
 *
 * `uptimeSeconds`, the live connection count and the game-thread work queue.
 * A climbing `gameThreadQueue.depth` or a rising `rejectedTotal` means the
 * server is shedding admin requests — the signal to back off a poll loop
 * rather than the one to retry harder.
 *
 * Nested groups use bare object literals, as in {@link Status}: they appear
 * inline in the spec and are not reused elsewhere.
 */
export interface Health extends Extensible {
  status: string;
  uptimeSeconds: number;
  connections: {
    active: number;
  };
  /** Admin work waiting on the game thread. */
  gameThreadQueue: {
    inFlight: number;
    depth: number;
    rejectedTotal: number;
  };
}

/* -------------------------------------------------------------------------- */
/* Moderation                                                                  */
/* -------------------------------------------------------------------------- */

export interface Ban extends Extensible {
  steamId: string;
  bannedAtUtc: string;
  bannedBy: string;
  reason: string;
}

export interface Bans extends Extensible {
  bans: Ban[];
}

export interface ReservedSlots extends Extensible {
  /** SteamID64 strings. */
  reservedSlots: string[];
}

export interface AuditEntry extends Extensible {
  timestampUtc: string;
  peer: string;
  sessionId: string;
  event: string;
  detail: string;
}

export interface Audit extends Extensible {
  entries: AuditEntry[];
}

/* -------------------------------------------------------------------------- */
/* Rotation                                                                    */
/* -------------------------------------------------------------------------- */

export interface RotationEntry extends Extensible {
  map: string;
  experiences: string[];
  lighting: string;
  zoneAlternator: string;
  /** Position in the cycle: `"now"`, `"next"`, or similar. */
  status: string;
  denied: boolean;
}

export interface Rotation extends Extensible {
  enabled: boolean;
  /** `"ordered"` or `"random"`. */
  mode: string;
  entries: RotationEntry[];
}

/* -------------------------------------------------------------------------- */
/* Catalog                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Catalog list responses (`/v1/catalog/maps`, `/v1/catalog/lightings`,
 * `/v1/catalog/experiences`).
 *
 * The spec leaves this shape empty and notes that it "varies by endpoint", so
 * this type is intentionally open. Narrow it at the call site or inspect the
 * payload directly.
 */
export type Catalog = Extensible;

/**
 * Response of `GET /v1/catalog/maps/{id}/experiences`.
 *
 * NOTE: the spec declares this endpoint returns a plain {@link Ok}, which
 * cannot be right — the operation is named for and documented as returning a
 * list of experiences. The prose reference does not pin down the field name
 * either, so this type carries both the `Ok` members and an optional typed
 * field, and stays open for anything else the server sends. Verify against
 * your own server.
 */
export interface MapExperiences extends Ok {
  experiences?: string[];
}

/**
 * Response of `GET /v1/catalog/maps/{id}/alternators`.
 *
 * See {@link MapExperiences} — same spec/prose divergence, same caveat.
 */
export interface MapAlternators extends Ok {
  alternators?: string[];
}

/* -------------------------------------------------------------------------- */
/* Sponsor                                                                     */
/* -------------------------------------------------------------------------- */

export interface Sponsor extends Extensible {
  imageUrl: string;
}

/* -------------------------------------------------------------------------- */
/* Config documents                                                            */
/* -------------------------------------------------------------------------- */

/**
 * A config document as returned by `GET /v1/config`.
 *
 * `text` is the authoritative ServerSettings.ini content; `sections` is a
 * pre-parsed convenience the spec leaves open-ended.
 */
export interface Config extends Extensible {
  /** Pass as `If-Match` when writing, to detect concurrent edits. */
  revision: string;
  writable: boolean;
  /** The config document itself. */
  text: string;
  sections: object[];
  warnings: string[];
}

/**
 * One value the server refused.
 *
 * Nothing is applied while the error list is non-empty, so one stale value
 * blocks unrelated edits until it is corrected. `message` is written for a
 * human and is safe to show as-is.
 */
export interface ConfigError extends Extensible {
  section: string;
  key: string;
  /** e.g. `url_not_allowed`, `out_of_range`. */
  code: string;
  message: string;
}

/**
 * A section a config document would change.
 *
 * `removed: true` means the section is absent from what you sent and would be
 * dropped — the whole-document replace is destructive, and this is how the
 * server tells you what it is about to take away.
 */
export interface ConfigChange extends Extensible {
  section: string;
  added?: boolean;
  removed?: boolean;
  keys?: string[];
}

/**
 * Result of `PUT /v1/config` and `POST /v1/config/validate`.
 *
 * Spec 1.1.0 typed `errors` and `changed` properly (they were `items: {}` in
 * 0.27), so those two are now {@link ConfigError} and {@link ConfigChange}.
 * `outcomes`, `shadowed` and `stripped` are still `items: {}` in the spec and
 * stay `unknown[]` here. `conflict` is documented as present specifically on
 * the HTTP 412 (stale revision) response.
 */
export interface ConfigResult extends Extensible {
  ok: boolean;
  revision: string;
  error?: ErrorBody['error'];
  /** Values the server refused. Non-empty means nothing was applied. */
  errors?: ConfigError[];
  outcomes?: unknown[];
  /** Sections this document would change. */
  changed?: ConfigChange[];
  /** Keys shadowed by a later duplicate. */
  shadowed?: unknown[];
  /** Keys stripped because they are not on the server's allow-list. */
  stripped?: unknown[];
  /** Present on HTTP 412 (revision mismatch). */
  conflict?: unknown[];
  warnings?: string[];
  timingsMs?: Record<string, unknown> | null;
}

/* -------------------------------------------------------------------------- */
/* Request bodies                                                              */
/* -------------------------------------------------------------------------- */

/** Body of `POST /v1/match/map` and `POST /v1/rotation/entries`. */
export interface MapSelection {
  map: string;
  experiences?: string[];
  lighting?: string;
  zoneAlternator?: string;
}

/** Body of `POST /v1/players/{steamId}/kick`. */
export interface ReasonRequest {
  reason?: string;
}

/** Body of `POST /v1/bans`. */
export interface BanRequest {
  steamId: string;
  reason?: string;
}

/** Body of `POST /v1/reserved-slots`. */
export interface SteamIdRequest {
  steamId: string;
}

/** Body of `POST /v1/players/{steamId}/message` and `POST /v1/broadcast`. */
export interface MessageRequest {
  message: string;
}

/** Body of `PATCH /v1/players/{steamId}`. Capability-gated server-side. */
export interface FactionRequest {
  faction: string;
}

/** Body of `PUT /v1/world/lighting`. */
export interface LightingRequest {
  lighting: string;
}

/** Direction for `POST /v1/rotation/entries/{i}/move`. */
export type MoveDirection = 'up' | 'down';

/** Body of `POST /v1/rotation/entries/{i}/move`. */
export interface MoveRequest {
  direction: MoveDirection;
}

/** Body of `PATCH /v1/settings`. All fields optional — this is a patch. */
export interface SettingsPatch {
  /** Seconds between score ticks. Server accepts 18–30. */
  scoreTick?: number;
  rotationEnabled?: boolean;
  rotationMode?: string;
}

/** Body of `PUT /v1/sponsor`. */
export interface SponsorRequest {
  imageUrl: string;
}
