/**
 * The typed client.
 *
 * Every one of the API's 37 operations is a method here, grouped by the same
 * resources the reference groups them under. The grouping is on the returned
 * object (`client.players.kick(...)`), and each namespace method also has a
 * flat alias on the client (`client.kickPlayer(...)`) for callers who prefer a
 * single flat surface. Both reach the same implementation, so there is no
 * behavioural difference to learn.
 *
 * Eight of them are deprecated: build `++Wardogs+Live-CL-501228` (2026-09-14)
 * removed them from the server and moved what they did into the config
 * document. They are kept working because older builds still serve them, and
 * each carries an `@deprecated` note naming its replacement.
 */

import { createDirectFetch } from '../adapters/direct.js';
import { WardogsError, WardogsHttpError } from './errors.js';
import {
  normalizeBaseUrl,
  request,
  type FetchLike,
  type HeadersOption,
  type QueryValue,
} from './http.js';
import type {
  Audit,
  Ban,
  BanRequest,
  Bans,
  Capabilities,
  Config,
  ConfigResult,
  FactionRequest,
  Health,
  LightingRequest,
  MapAlternators,
  MapExperiences,
  MapSelection,
  MessageRequest,
  MoveDirection,
  Ok,
  Player,
  Players,
  ReasonRequest,
  ReservedSlots,
  Rotation,
  ServerId,
  SettingsPatch,
  Sponsor,
  SteamIdRequest,
  Status,
} from './types.js';

/* -------------------------------------------------------------------------- */
/* Configuration                                                               */
/* -------------------------------------------------------------------------- */

export interface ClientConfig {
  /**
   * Base URL of the RCON listener, e.g. `"https://my-server.example:7776"`.
   *
   * The default RCON port is `7776`. A server reachable over a network
   * requires TLS, so this is normally `https://`. Plaintext `http://` is
   * accepted only for loopback hosts, unless {@link allowInsecureHttp} is set.
   */
  baseUrl: string;

  /**
   * The RCON password, sent as `Authorization: Bearer <token>` on every
   * request.
   *
   * There is no separate login step and no read-only variant — this single
   * credential can kick, ban, replace the config and end a match. The API
   * reference asks that it be kept server-side; in a browser, prefer
   * `createProxyFetch` so the token stays on your own backend.
   */
  token: string;

  /** Per-request timeout in milliseconds. Default `15000`. `0` disables it. */
  timeoutMs?: number;

  /** Extra attempts for a failing GET. Default `1`. Never applies to writes. */
  retries?: number;

  /** Transport override. Defaults to a direct `fetch`. See `src/adapters`. */
  fetch?: FetchLike;

  /** Extra headers on every request. A function is re-evaluated per request. */
  headers?: HeadersOption;

  /**
   * Permit plaintext `http://` to a non-loopback host.
   *
   * Only meaningful when a plaintext proxy or tunnel terminates TLS in front
   * of the game server. Against the server itself this can never work.
   */
  allowInsecureHttp?: boolean;
}

/* -------------------------------------------------------------------------- */
/* Per-call options                                                            */
/* -------------------------------------------------------------------------- */

export interface CallOptions {
  /** Cancel this request. */
  signal?: AbortSignal;
  /** Override the client timeout for this request. */
  timeoutMs?: number;
  /** Override the client retry count for this request (GET only). */
  retries?: number;
}

/* -------------------------------------------------------------------------- */
/* Namespaces                                                                  */
/* -------------------------------------------------------------------------- */

export interface StatusApi {
  /** `GET /v1/status` — live match state. */
  get(options?: CallOptions): Promise<Status>;
}

export interface PlayersApi {
  /** `GET /v1/players` — connected players. */
  list(options?: CallOptions): Promise<Player[]>;
  /** `POST /v1/players/{steamId}/kick`. */
  kick(steamId: string, reason?: string, options?: CallOptions): Promise<Ok>;
  /** `POST /v1/players/{steamId}/kill` — kill in-match, no disconnect. */
  kill(steamId: string, options?: CallOptions): Promise<Ok>;
  /** `POST /v1/players/{steamId}/message` — direct message. */
  message(steamId: string, message: string, options?: CallOptions): Promise<Ok>;
  /**
   * `PATCH /v1/players/{steamId}` — move a player between factions.
   *
   * Capability-gated: check `GET /v1/capabilities` for
   * `PATCH /v1/players/{id}` before offering it. See
   * {@link import('../capabilities.js').createCapabilities}.
   */
  setFaction(steamId: string, faction: string, options?: CallOptions): Promise<Ok>;
}

export interface BansApi {
  /** `GET /v1/bans` — the ban list. */
  list(options?: CallOptions): Promise<Ban[]>;
  /** `POST /v1/bans`. */
  add(steamId: string, reason?: string, options?: CallOptions): Promise<Ok>;
  /** `DELETE /v1/bans/{steamId}` — lift a ban. */
  remove(steamId: string, options?: CallOptions): Promise<Ok>;
}

export interface ReservedSlotsApi {
  /** `GET /v1/reserved-slots` — SteamID64 strings. */
  list(options?: CallOptions): Promise<string[]>;
  /**
   * `POST /v1/reserved-slots` — reserve a slot for a SteamID64.
   *
   * @deprecated Removed in server build `++Wardogs+Live-CL-501228` (2026-09-14).
   * A current server answers 404 and omits it from `GET /v1/capabilities`;
   * older builds still serve it. Edit the config document instead:
   * `GET /v1/config` → change the text → `PUT /v1/config`. Reserved ids live in
   * `DefaultReservedPlayers`.
   */
  add(steamId: string, options?: CallOptions): Promise<Ok>;
  /**
   * `DELETE /v1/reserved-slots/{steamId}` — release a reserved slot.
   *
   * @deprecated Removed in build `++Wardogs+Live-CL-501228`. Drop the id from
   * `DefaultReservedPlayers` in the config document instead.
   */
  remove(steamId: string, options?: CallOptions): Promise<Ok>;
}

export interface AuditApi {
  /**
   * `GET /v1/audit` — the admin action log.
   *
   * @param limit 1–500, server default 50.
   */
  list(limit?: number, options?: CallOptions): Promise<Audit['entries']>;
}

export interface MatchApi {
  /**
   * `POST /v1/match/map` — change map now.
   *
   * Only `map` is required; `lighting` and `zoneAlternator` fall back to the
   * map's authored defaults when omitted.
   */
  setMap(selection: MapSelection, options?: CallOptions): Promise<Ok>;
  /** `POST /v1/match/end` — end the current match. */
  end(options?: CallOptions): Promise<Ok>;
  /** `POST /v1/match/restart` — restart the current match. */
  restart(options?: CallOptions): Promise<Ok>;
}

export interface WorldApi {
  /** `PUT /v1/world/lighting` — change lighting/weather live. */
  setLighting(lighting: string, options?: CallOptions): Promise<Ok>;
}

export interface RotationApi {
  /** `GET /v1/rotation` — the full rotation including per-entry status. */
  get(options?: CallOptions): Promise<Rotation>;
  /**
   * `POST /v1/rotation/entries` — append an entry.
   *
   * @deprecated Removed in build `++Wardogs+Live-CL-501228`. Append a
   * `RotationEntries` line to the config document instead.
   */
  addEntry(selection: MapSelection, options?: CallOptions): Promise<Ok>;
  /**
   * `DELETE /v1/rotation/entries/{i}` — remove by index.
   *
   * @deprecated Removed in build `++Wardogs+Live-CL-501228`. Drop that
   * `RotationEntries` line from the config document instead.
   */
  removeEntry(index: number, options?: CallOptions): Promise<Ok>;
  /**
   * `POST /v1/rotation/entries/{i}/move` — reorder one step.
   *
   * @deprecated Removed in build `++Wardogs+Live-CL-501228`. Reorder the
   * `RotationEntries` lines in the config document instead.
   */
  moveEntry(index: number, direction: MoveDirection, options?: CallOptions): Promise<Ok>;
  /**
   * `POST /v1/rotation/save` — persist rotation edits to `ServerSettings.ini`.
   *
   * Add/move/remove change the live rotation; without this they are lost when
   * the server restarts.
   *
   * @deprecated Removed in build `++Wardogs+Live-CL-501228`. There is nothing
   * left to persist: a config edit is already durable, because the document
   * *is* the file.
   */
  save(options?: CallOptions): Promise<Ok>;
}

export interface SettingsApi {
  /**
   * `PATCH /v1/settings` — patch score tick and rotation settings.
   *
   * @deprecated Removed in build `++Wardogs+Live-CL-501228`. `ScorePeriod` is
   * in `[/Script/WDGame.WDMatchState]` in the config document; edit it there.
   */
  patch(patch: SettingsPatch, options?: CallOptions): Promise<Ok>;
}

export interface CatalogApi {
  /** `GET /v1/catalog/maps` — available maps. */
  maps(options?: CallOptions): Promise<unknown>;
  /** `GET /v1/catalog/lightings` — available lighting presets. */
  lightings(options?: CallOptions): Promise<unknown>;
  /** `GET /v1/catalog/experiences` — all experiences (game modes). */
  experiences(options?: CallOptions): Promise<unknown>;
  /**
   * `GET /v1/catalog/maps/{id}/experiences` — experiences valid for one map.
   *
   * The spec types this as a plain success envelope, which cannot be correct;
   * see {@link MapExperiences}.
   */
  mapExperiences(mapId: string, options?: CallOptions): Promise<MapExperiences>;
  /** `GET /v1/catalog/maps/{id}/alternators` — zone alternators for a map. */
  mapAlternators(mapId: string, options?: CallOptions): Promise<MapAlternators>;
}

export interface SponsorApi {
  /** `GET /v1/sponsor`. */
  get(options?: CallOptions): Promise<Sponsor>;
  /**
   * `PUT /v1/sponsor` — set the banner URL (1024×256 PNG/JPEG, allow-listed).
   *
   * @deprecated Removed in build `++Wardogs+Live-CL-501228`. The banner is
   * `ServerImageURL` in the config document; edit it there.
   */
  set(imageUrl: string, options?: CallOptions): Promise<Ok>;
}

export interface ConfigApi {
  /** `GET /v1/config` — document plus the revision needed to write it back. */
  get(options?: CallOptions): Promise<Config>;

  /**
   * `PUT /v1/config` — apply a config document.
   *
   * `text` is the full document, sent as `text/plain`. Pass the revision you
   * read as `ifMatch` for optimistic concurrency; a stale revision fails with
   * {@link WardogsHttpError} whose `isRevisionConflict` is `true`.
   *
   * @param options.force Send `force=true` to apply despite validation warnings.
   * @param options.fullApply Send `fullApply=true` to apply every key rather
   *   than only the changed ones.
   */
  apply(
    text: string,
    options?: CallOptions & { ifMatch?: string; force?: boolean; fullApply?: boolean },
  ): Promise<ConfigResult>;

  /** `POST /v1/config/validate` — check a document without applying it. */
  validate(text: string, options?: CallOptions): Promise<ConfigResult>;
}

export interface MetaApi {
  /** `GET /v1/capabilities` — which routes this server actually exposes. */
  capabilities(options?: CallOptions): Promise<Capabilities>;
  /**
   * `GET /v1/server-id` — an opaque id that survives restarts and map changes.
   *
   * Key stored state on this rather than `host:port`, which moves.
   */
  serverId(options?: CallOptions): Promise<ServerId>;
  /**
   * `GET /v1/health` — uptime, open connections and game-thread queue depth.
   *
   * A climbing `gameThreadQueue.depth` or a rising `rejectedTotal` means the
   * server is shedding admin requests.
   */
  health(options?: CallOptions): Promise<Health>;
}

/* -------------------------------------------------------------------------- */
/* The client                                                                  */
/* -------------------------------------------------------------------------- */

export interface WardogsClient {
  /** The normalized base URL, without a trailing slash. */
  readonly baseUrl: string;

  readonly status: StatusApi;
  readonly players: PlayersApi;
  readonly bans: BansApi;
  readonly reservedSlots: ReservedSlotsApi;
  readonly audit: AuditApi;
  readonly match: MatchApi;
  readonly world: WorldApi;
  readonly rotation: RotationApi;
  readonly settings: SettingsApi;
  readonly catalog: CatalogApi;
  readonly sponsor: SponsorApi;
  readonly config: ConfigApi;
  readonly meta: MetaApi;

  /* Flat aliases, for callers who prefer not to nest. */
  /** Alias of `status.get()`. */
  getStatus(options?: CallOptions): Promise<Status>;
  /** Alias of `players.list()`. */
  getPlayers(options?: CallOptions): Promise<Player[]>;
  /** Alias of `players.kick()`. */
  kickPlayer(steamId: string, reason?: string, options?: CallOptions): Promise<Ok>;
  /** Alias of `players.kill()`. */
  killPlayer(steamId: string, options?: CallOptions): Promise<Ok>;
  /** Alias of `players.message()`. */
  messagePlayer(steamId: string, message: string, options?: CallOptions): Promise<Ok>;
  /** Alias of `players.setFaction()`. */
  setPlayerFaction(steamId: string, faction: string, options?: CallOptions): Promise<Ok>;
  /** Alias of `bans.list()`. */
  getBans(options?: CallOptions): Promise<Ban[]>;
  /** Alias of `bans.add()`. */
  banPlayer(steamId: string, reason?: string, options?: CallOptions): Promise<Ok>;
  /** Alias of `bans.remove()`. */
  unbanPlayer(steamId: string, options?: CallOptions): Promise<Ok>;
  /** Alias of `reservedSlots.list()`. */
  getReservedSlots(options?: CallOptions): Promise<string[]>;
  /**
   * Alias of `reservedSlots.add()`.
   * @deprecated Removed in build `++Wardogs+Live-CL-501228`. See the
   * namespaced method for what to do instead.
   */
  addReservedSlot(steamId: string, options?: CallOptions): Promise<Ok>;
  /**
   * Alias of `reservedSlots.remove()`.
   * @deprecated Removed in build `++Wardogs+Live-CL-501228`. See the
   * namespaced method for what to do instead.
   */
  removeReservedSlot(steamId: string, options?: CallOptions): Promise<Ok>;
  /** Alias of `audit.list()`. */
  getAudit(limit?: number, options?: CallOptions): Promise<Audit['entries']>;
  /** Alias of `match.setMap()`. */
  setMap(selection: MapSelection, options?: CallOptions): Promise<Ok>;
  /** Alias of `match.end()`. */
  endMatch(options?: CallOptions): Promise<Ok>;
  /** Alias of `match.restart()`. */
  restartMatch(options?: CallOptions): Promise<Ok>;
  /** Alias of `world.setLighting()`. */
  setLighting(lighting: string, options?: CallOptions): Promise<Ok>;
  /** Alias of `rotation.get()`. */
  getRotation(options?: CallOptions): Promise<Rotation>;
  /**
   * Alias of `rotation.addEntry()`.
   * @deprecated Removed in build `++Wardogs+Live-CL-501228`. See the
   * namespaced method for what to do instead.
   */
  addRotationEntry(selection: MapSelection, options?: CallOptions): Promise<Ok>;
  /**
   * Alias of `rotation.removeEntry()`.
   * @deprecated Removed in build `++Wardogs+Live-CL-501228`. See the
   * namespaced method for what to do instead.
   */
  removeRotationEntry(index: number, options?: CallOptions): Promise<Ok>;
  /**
   * Alias of `rotation.moveEntry()`.
   * @deprecated Removed in build `++Wardogs+Live-CL-501228`. See the
   * namespaced method for what to do instead.
   */
  moveRotationEntry(index: number, direction: MoveDirection, options?: CallOptions): Promise<Ok>;
  /**
   * Alias of `rotation.save()`.
   * @deprecated Removed in build `++Wardogs+Live-CL-501228`. See the
   * namespaced method for what to do instead.
   */
  saveRotation(options?: CallOptions): Promise<Ok>;
  /**
   * Alias of `settings.patch()`.
   * @deprecated Removed in build `++Wardogs+Live-CL-501228`. See the
   * namespaced method for what to do instead.
   */
  patchSettings(patch: SettingsPatch, options?: CallOptions): Promise<Ok>;
  /** Alias of `catalog.maps()`. */
  getCatalogMaps(options?: CallOptions): Promise<unknown>;
  /** Alias of `catalog.lightings()`. */
  getCatalogLightings(options?: CallOptions): Promise<unknown>;
  /** Alias of `catalog.experiences()`. */
  getCatalogExperiences(options?: CallOptions): Promise<unknown>;
  /** Alias of `catalog.mapExperiences()`. */
  getMapExperiences(mapId: string, options?: CallOptions): Promise<MapExperiences>;
  /** Alias of `catalog.mapAlternators()`. */
  getMapAlternators(mapId: string, options?: CallOptions): Promise<MapAlternators>;
  /** Alias of `sponsor.get()`. */
  getSponsor(options?: CallOptions): Promise<Sponsor>;
  /**
   * Alias of `sponsor.set()`.
   * @deprecated Removed in build `++Wardogs+Live-CL-501228`. See the
   * namespaced method for what to do instead.
   */
  setSponsor(imageUrl: string, options?: CallOptions): Promise<Ok>;
  /** Alias of `config.get()`. */
  getConfig(options?: CallOptions): Promise<Config>;
  /** Alias of `config.apply()`. */
  applyConfig(
    text: string,
    options?: CallOptions & { ifMatch?: string; force?: boolean; fullApply?: boolean },
  ): Promise<ConfigResult>;
  /** Alias of `config.validate()`. */
  validateConfig(text: string, options?: CallOptions): Promise<ConfigResult>;
  /** Alias of `meta.capabilities()`. */
  getCapabilities(options?: CallOptions): Promise<Capabilities>;
  /** Alias of `meta.serverId()`. */
  getServerId(options?: CallOptions): Promise<ServerId>;
  /** Alias of `meta.health()`. */
  getHealth(options?: CallOptions): Promise<Health>;
  /** Alias of `broadcast()`. */
  sendBroadcast(message: string, options?: CallOptions): Promise<Ok>;

  /**
   * `POST /v1/broadcast` — message everyone.
   *
   * Only exposed here: the reference files it under "Players", but it is not
   * player-scoped.
   */
  broadcast(message: string, options?: CallOptions): Promise<Ok>;

  /**
   * `GET /v1/status` as a connectivity and credential check.
   *
   * The reference names this as the way to verify a token — there is no login
   * endpoint. Resolves to `true` on success, `false` on an auth failure, and
   * **throws** on anything else, so a network problem is not mistaken for a
   * bad password.
   */
  ping(options?: CallOptions): Promise<boolean>;

  /**
   * Escape hatch: issue any route by its {@link import('./routes.js').RouteId}.
   *
   * Useful when a server exposes an operation this library has not typed yet.
   */
  request<T = unknown>(
    method: string,
    path: string,
    options?: CallOptions & { query?: Record<string, QueryValue>; body?: unknown },
  ): Promise<T>;
}

/* -------------------------------------------------------------------------- */
/* Implementation                                                              */
/* -------------------------------------------------------------------------- */

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_RETRIES = 1;

function assertNonNegativeInteger(value: number, label: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new WardogsError(`${label} must be a non-negative integer, received: ${value}`);
  }
}

function assertNonEmptyString(value: string, label: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new WardogsError(
      `${label} must be a non-empty string, received: ${JSON.stringify(value)}`,
    );
  }
  return value;
}

/** Path-segment escaping. A SteamID64 is digits, but an id from a catalog may not be. */
function segment(value: string): string {
  return encodeURIComponent(value);
}

/**
 * Creates a client for one Wardogs RCON server.
 *
 * ```ts
 * const client = createClient({
 *   baseUrl: 'https://my-server.example:7776',
 *   token: process.env.WARDOGS_TOKEN!,
 * });
 *
 * const status = await client.status.get();
 * await client.broadcast('Server restarting in 5 minutes');
 * ```
 *
 * @throws {WardogsError} when the configuration is unusable — a malformed or
 *   non-loopback-plaintext `baseUrl`, an empty token, or a negative timeout.
 *   Failing at construction rather than at the first request means a typo in a
 *   config value is reported where it was made.
 */
export function createClient(config: ClientConfig): WardogsClient {
  if (config === null || typeof config !== 'object') {
    throw new WardogsError('createClient requires a configuration object.');
  }

  const baseUrl = normalizeBaseUrl(assertNonEmptyString(config.baseUrl, 'baseUrl'), {
    allowInsecureHttp: config.allowInsecureHttp === true,
  });
  const token = assertNonEmptyString(config.token, 'token');

  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const retries = config.retries ?? DEFAULT_RETRIES;
  assertNonNegativeInteger(timeoutMs, 'timeoutMs');
  assertNonNegativeInteger(retries, 'retries');

  const fetchImpl = config.fetch ?? createDirectFetch();

  const call = async <T>(
    method: string,
    path: string,
    extras: {
      query?: Record<string, QueryValue>;
      body?: unknown;
      /** Send the body as `text/plain` instead of JSON. */
      plainText?: boolean;
      headers?: Record<string, string>;
    } = {},
    options: CallOptions = {},
  ): Promise<T> => {
    const hasBody = extras.body !== undefined;
    const isPlainText = extras.plainText === true;

    // Resolved before the request so an async header producer is awaited once
    // and a static object is not re-cloned for every endpoint.
    const headers = await mergeHeaders(config.headers, extras.headers);

    const result = await request({
      method,
      baseUrl,
      path,
      ...(extras.query !== undefined ? { query: extras.query } : {}),
      ...(hasBody
        ? {
            body: isPlainText ? String(extras.body) : JSON.stringify(extras.body),
            contentType: isPlainText ? 'text/plain' : 'application/json',
          }
        : {}),
      token,
      ...(Object.keys(headers).length > 0 ? { headers } : {}),
      ...(options.signal !== undefined ? { signal: options.signal } : {}),
      timeoutMs: options.timeoutMs ?? timeoutMs,
      retries: options.retries ?? retries,
      fetch: fetchImpl,
    });

    return result.data as T;
  };

  /* ---------------------------------------------------------------------- */
  /* Namespaces                                                              */
  /* ---------------------------------------------------------------------- */

  const status: StatusApi = {
    get: (options) => call<Status>('GET', '/v1/status', {}, options),
  };

  const players: PlayersApi = {
    list: async (options) => {
      const body = await call<Players>('GET', '/v1/players', {}, options);
      return body.players ?? [];
    },
    kick: (steamId, reason, options) =>
      call<Ok>(
        'POST',
        `/v1/players/${segment(steamId)}/kick`,
        { body: { ...(reason !== undefined ? { reason } : {}) } satisfies ReasonRequest },
        options,
      ),
    kill: (steamId, options) =>
      call<Ok>('POST', `/v1/players/${segment(steamId)}/kill`, {}, options),
    message: (steamId, message, options) =>
      call<Ok>(
        'POST',
        `/v1/players/${segment(steamId)}/message`,
        { body: { message } satisfies MessageRequest },
        options,
      ),
    setFaction: (steamId, faction, options) =>
      call<Ok>(
        'PATCH',
        `/v1/players/${segment(steamId)}`,
        { body: { faction } satisfies FactionRequest },
        options,
      ),
  };

  const bans: BansApi = {
    list: async (options) => {
      const body = await call<Bans>('GET', '/v1/bans', {}, options);
      return body.bans ?? [];
    },
    add: (steamId, reason, options) =>
      call<Ok>(
        'POST',
        '/v1/bans',
        { body: { steamId, ...(reason !== undefined ? { reason } : {}) } satisfies BanRequest },
        options,
      ),
    remove: (steamId, options) => call<Ok>('DELETE', `/v1/bans/${segment(steamId)}`, {}, options),
  };

  const reservedSlots: ReservedSlotsApi = {
    list: async (options) => {
      const body = await call<ReservedSlots>('GET', '/v1/reserved-slots', {}, options);
      return body.reservedSlots ?? [];
    },
    add: (steamId, options) =>
      call<Ok>(
        'POST',
        '/v1/reserved-slots',
        { body: { steamId } satisfies SteamIdRequest },
        options,
      ),
    remove: (steamId, options) =>
      call<Ok>('DELETE', `/v1/reserved-slots/${segment(steamId)}`, {}, options),
  };

  const audit: AuditApi = {
    list: async (limit, options) => {
      const body = await call<Audit>('GET', '/v1/audit', { query: { limit } }, options);
      return body.entries ?? [];
    },
  };

  const match: MatchApi = {
    setMap: (selection, options) => call<Ok>('POST', '/v1/match/map', { body: selection }, options),
    end: (options) => call<Ok>('POST', '/v1/match/end', {}, options),
    restart: (options) => call<Ok>('POST', '/v1/match/restart', {}, options),
  };

  const world: WorldApi = {
    setLighting: (lighting, options) =>
      call<Ok>(
        'PUT',
        '/v1/world/lighting',
        { body: { lighting } satisfies LightingRequest },
        options,
      ),
  };

  const rotation: RotationApi = {
    get: (options) => call<Rotation>('GET', '/v1/rotation', {}, options),
    addEntry: (selection, options) =>
      call<Ok>('POST', '/v1/rotation/entries', { body: selection }, options),
    removeEntry: (index, options) =>
      call<Ok>('DELETE', `/v1/rotation/entries/${String(index)}`, {}, options),
    moveEntry: (index, direction, options) =>
      call<Ok>(
        'POST',
        `/v1/rotation/entries/${String(index)}/move`,
        { body: { direction } },
        options,
      ),
    save: (options) => call<Ok>('POST', '/v1/rotation/save', {}, options),
  };

  const settings: SettingsApi = {
    patch: (patch, options) => call<Ok>('PATCH', '/v1/settings', { body: patch }, options),
  };

  const catalog: CatalogApi = {
    maps: (options) => call<unknown>('GET', '/v1/catalog/maps', {}, options),
    lightings: (options) => call<unknown>('GET', '/v1/catalog/lightings', {}, options),
    experiences: (options) => call<unknown>('GET', '/v1/catalog/experiences', {}, options),
    mapExperiences: (mapId, options) =>
      call<MapExperiences>('GET', `/v1/catalog/maps/${segment(mapId)}/experiences`, {}, options),
    mapAlternators: (mapId, options) =>
      call<MapAlternators>('GET', `/v1/catalog/maps/${segment(mapId)}/alternators`, {}, options),
  };

  const sponsor: SponsorApi = {
    get: (options) => call<Sponsor>('GET', '/v1/sponsor', {}, options),
    set: (imageUrl, options) => call<Ok>('PUT', '/v1/sponsor', { body: { imageUrl } }, options),
  };

  const configApi: ConfigApi = {
    get: (options) => call<Config>('GET', '/v1/config', {}, options),
    // `async` so a malformed revision surfaces as a rejected promise rather
    // than a synchronous throw — an `await`-ing caller should not have to wrap
    // the call in try/catch to catch a validation error.
    apply: async (text, options) => {
      const { ifMatch, force, fullApply, ...callOptions } = options ?? {};
      return call<ConfigResult>(
        'PUT',
        '/v1/config',
        {
          body: text,
          plainText: true,
          query: { force, fullApply },
          ...(ifMatch !== undefined ? { headers: { 'If-Match': formatIfMatch(ifMatch) } } : {}),
        },
        callOptions,
      );
    },
    validate: (text, options) =>
      call<ConfigResult>('POST', '/v1/config/validate', { body: text, plainText: true }, options),
  };

  const meta: MetaApi = {
    capabilities: (options) => call<Capabilities>('GET', '/v1/capabilities', {}, options),
    serverId: (options) => call<ServerId>('GET', '/v1/server-id', {}, options),
    health: (options) => call<Health>('GET', '/v1/health', {}, options),
  };

  /* ---------------------------------------------------------------------- */
  /* Assembly                                                                */
  /* ---------------------------------------------------------------------- */

  const broadcast = (message: string, options?: CallOptions): Promise<Ok> =>
    call<Ok>('POST', '/v1/broadcast', { body: { message } satisfies MessageRequest }, options);

  const ping = async (options?: CallOptions): Promise<boolean> => {
    try {
      await call<Status>('GET', '/v1/status', {}, options);
      return true;
    } catch (error) {
      if (error instanceof WardogsHttpError && error.isAuthError) return false;
      throw error;
    }
  };

  const request_ = <T = unknown>(
    method: string,
    path: string,
    options?: CallOptions & { query?: Record<string, QueryValue>; body?: unknown },
  ): Promise<T> => {
    const { query, body, ...callOptions } = options ?? {};
    return call<T>(
      method,
      path,
      {
        ...(query !== undefined ? { query } : {}),
        ...(body !== undefined ? { body } : {}),
      },
      callOptions,
    );
  };

  return {
    baseUrl,
    status,
    players,
    bans,
    reservedSlots,
    audit,
    match,
    world,
    rotation,
    settings,
    catalog,
    sponsor,
    config: configApi,
    meta,

    getStatus: status.get,
    getPlayers: players.list,
    kickPlayer: players.kick,
    killPlayer: players.kill,
    messagePlayer: players.message,
    setPlayerFaction: players.setFaction,
    getBans: bans.list,
    banPlayer: bans.add,
    unbanPlayer: bans.remove,
    getReservedSlots: reservedSlots.list,
    addReservedSlot: reservedSlots.add,
    removeReservedSlot: reservedSlots.remove,
    getAudit: audit.list,
    setMap: match.setMap,
    endMatch: match.end,
    restartMatch: match.restart,
    setLighting: world.setLighting,
    getRotation: rotation.get,
    addRotationEntry: rotation.addEntry,
    removeRotationEntry: rotation.removeEntry,
    moveRotationEntry: rotation.moveEntry,
    saveRotation: rotation.save,
    patchSettings: settings.patch,
    getCatalogMaps: catalog.maps,
    getCatalogLightings: catalog.lightings,
    getCatalogExperiences: catalog.experiences,
    getMapExperiences: catalog.mapExperiences,
    getMapAlternators: catalog.mapAlternators,
    getSponsor: sponsor.get,
    setSponsor: sponsor.set,
    getConfig: configApi.get,
    applyConfig: configApi.apply,
    validateConfig: configApi.validate,
    getCapabilities: meta.capabilities,
    getServerId: meta.serverId,
    getHealth: meta.health,
    sendBroadcast: broadcast,
    broadcast,

    ping,
    request: request_,
  };
}

/** Merges static and per-call headers, with the per-call values winning. */
async function mergeHeaders(
  base: HeadersOption | undefined,
  extra: Record<string, string> | undefined,
): Promise<Record<string, string>> {
  const resolved = base === undefined ? {} : typeof base === 'function' ? await base() : base;
  return extra === undefined ? { ...resolved } : { ...resolved, ...extra };
}

/**
 * Formats a config revision as an `If-Match` header value.
 *
 * The reference shows the header quoted (`If-Match: "<revision>"`), which is
 * also what HTTP requires for an entity-tag, so a caller who already quoted the
 * revision is accepted rather than double-quoted.
 *
 * A quote or line break inside the revision itself is rejected: the first
 * produces a malformed header, and the second is a request-splitting attempt
 * rather than a typo.
 */
function formatIfMatch(revision: string): string {
  const trimmed = revision.trim();
  const unquoted =
    trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"')
      ? trimmed.slice(1, -1)
      : trimmed;

  if (/["\r\n]/.test(unquoted)) {
    throw new WardogsError(
      'A config revision containing a quote or newline cannot be used as an ' +
        'If-Match header value.',
    );
  }
  return `"${unquoted}"`;
}
