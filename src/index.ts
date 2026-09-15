/**
 * wardogs-rcon-api-tool
 *
 * A typed client and utilities for the Wardogs dedicated server RCON HTTP API
 * (`/v1`).
 *
 * Unofficial. The API it targets is a community reference, not published or
 * supported by the game's developers, and it can change without notice. See
 * `SPEC_VERSION` and `SPEC_UPDATED` for the revision this build was written
 * against.
 *
 * Zero runtime dependencies, no Node built-ins, no polyfills. The same build
 * runs in Node, Bun, Deno, browsers and workers.
 *
 * ```ts
 * import { createClient } from '@yuban32/wardogs-rcon-api';
 *
 * const client = createClient({
 *   baseUrl: 'https://my-server.example:7776',
 *   token: process.env.WARDOGS_TOKEN!,
 * });
 *
 * const status = await client.status.get();
 * console.log(`${status.players.current}/${status.players.max} on ${status.map}`);
 * ```
 */

/* Transport and client ------------------------------------------------------ */
export { createClient } from './core/client.js';
export type {
  CallOptions,
  ClientConfig,
  WardogsClient,
  StatusApi,
  PlayersApi,
  BansApi,
  ReservedSlotsApi,
  AuditApi,
  MatchApi,
  WorldApi,
  RotationApi,
  SettingsApi,
  CatalogApi,
  SponsorApi,
  ConfigApi,
  MetaApi,
} from './core/client.js';

/* Adapters ------------------------------------------------------------------ */
export { createDirectFetch, type DirectFetchOptions } from './adapters/direct.js';
export { createProxyFetch, type ProxyFetchOptions } from './adapters/proxy.js';

/* Errors -------------------------------------------------------------------- */
export {
  WardogsError,
  WardogsHttpError,
  WardogsTimeoutError,
  WardogsNetworkError,
  WardogsParseError,
  WardogsAbortError,
  isWardogsError,
  NO_FETCH_HINT,
  TLS_CERTIFICATE_HINT,
} from './core/errors.js';

/* Low-level HTTP, for callers building their own transport ------------------ */
export {
  buildUrl,
  normalizeBaseUrl,
  request,
  type FetchInit,
  type FetchLike,
  type FetchResponse,
  type HeadersOption,
  type QueryValue,
  type RequestOptions,
  type RequestResult,
} from './core/http.js';

/* Routes -------------------------------------------------------------------- */
export {
  ROUTE_IDS,
  isRouteId,
  normalizeRoute,
  routeMatches,
  splitRoute,
  type RouteId,
} from './core/routes.js';

/* Types --------------------------------------------------------------------- */
export type {
  Audit,
  AuditEntry,
  Ban,
  BanRequest,
  Bans,
  Capabilities,
  Catalog,
  Config,
  ConfigChange,
  ConfigError,
  ConfigResult,
  ErrorBody,
  FactionRequest,
  FactionScore,
  Health,
  LightingRequest,
  MapAlternators,
  MapExperiences,
  MapSelection,
  MessageRequest,
  MoveDirection,
  MoveRequest,
  Ok,
  Player,
  Players,
  ReasonRequest,
  ReservedSlots,
  Rotation,
  RotationEntry,
  ServerId,
  SettingsPatch,
  Sponsor,
  SponsorRequest,
  Status,
  SteamIdRequest,
} from './core/types.js';

/* Capability probing -------------------------------------------------------- */
export {
  createCapabilities,
  findRouteEntries,
  type CapabilitiesOptions,
  type CapabilitiesProbe,
} from './capabilities.js';

/* Polling ------------------------------------------------------------------- */
export {
  createWatcher,
  diffPlayers,
  diffStatusFields,
  type PlayerListDelta,
  type StatusChange,
  type WardogsWatcher,
  type WatcherEvents,
  type WatcherOptions,
  type WatchSnapshot,
} from './watch/watcher.js';

/* Config documents ---------------------------------------------------------- */
export {
  WardogsConfigDocument,
  createConfigDocument,
  RCON_SECTION,
  ROTATION_SECTION,
  SESSION_SECTION,
} from './config/doc.js';
export {
  parseIni,
  stringifyIni,
  type IniDocument,
  type IniEntry,
  type IniSection,
} from './config/ini.js';
export {
  parseRotationEntries,
  parseRotationEntryValue,
  serializeRotationEntryValue,
  type RotationEntryFields,
} from './config/rotation.js';

/* Utilities ----------------------------------------------------------------- */
export {
  accountIdToSteamId64,
  isSteamId64,
  steamId64ToAccountId,
  steamId64ToLegacy,
  toSteamId64,
} from './utils/steam.js';
export {
  buildFactionIndex,
  buildFactionIndexFromScores,
  groupPlayersByFaction,
  isSameFaction,
  resolvePlayerFactions,
  type FactionIndex,
  type FactionInfo,
  type FactionSource,
  type ResolvedPlayer,
} from './utils/factions.js';

/* Metadata ------------------------------------------------------------------ */
export { API_VERSION, SPEC_UPDATED, SPEC_VERSION, VERSION } from './version.js';
