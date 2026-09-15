/**
 * The route registry: one entry per operation, driving the whole explorer UI.
 *
 * The ids are not retyped here. `ROUTE_IDS` is imported from the library, and a
 * test asserts this registry covers exactly that set — a route added to the
 * spec, or dropped from it, fails the panel's own test run. The library already
 * proves that list against `spec/openapi.json`; re-deriving it here would be a
 * second copy to keep in sync, and the one that drifts silently.
 *
 * What the library cannot know is the *presentation*: which group a route
 * belongs under, what a usable request body looks like, and — the one that
 * matters — whether sending it changes anything.
 */

import { ROUTE_IDS, type RouteId } from '@wardogs/api';

/** Sections of the API, in the order the reference groups them. */
export type RouteGroup =
  | 'Status'
  | 'Players'
  | 'Moderation'
  | 'Match'
  | 'Rotation'
  | 'Settings'
  | 'Catalog'
  | 'Sponsor'
  | 'Meta'
  | 'Config';

export const GROUP_ORDER: readonly RouteGroup[] = [
  'Status',
  'Players',
  'Moderation',
  'Match',
  'Rotation',
  'Settings',
  'Catalog',
  'Sponsor',
  'Meta',
  'Config',
];

/** A path parameter or query parameter, with a value worth trying. */
export interface ParamSpec {
  name: string;
  label: string;
  /** Pre-filled so the form is sendable without reading the docs. */
  value: string;
  /** Rendered as a SteamID hint, for the id-shaped parameters. */
  kind?: 'steamId';
}

export interface RouteSpec {
  id: RouteId;
  group: RouteGroup;
  /** One line, shown in the picker. */
  summary: string;
  /**
   * Whether the route can change server state.
   *
   * This drives the read-only guard, so the safe answer is `true`: a route that
   * is wrongly marked read-only becomes a button that mutates a live server
   * while the panel says it will not.
   */
  mutating: boolean;
  params?: ParamSpec[];
  query?: ParamSpec[];
  /**
   * Body template, sent verbatim after the caller has had a chance to edit it.
   * An empty field sends no body at all, which is how the optional ones work.
   */
  body?: { kind: 'json' | 'text'; template: string };
  /**
   * Set when a dedicated panel owns this route.
   *
   * `PUT /v1/config` and `POST /v1/config/validate` take the INI document as
   * `text/plain`, and the client's escape hatch `request()` only ever
   * JSON-encodes a body — so these two are reachable through `config.apply()`
   * and `config.validate()` and nowhere else. The explorer links to the config
   * panel rather than duplicating that path.
   */
  owner?: 'config';
  /**
   * Why this route is deprecated, when it is.
   *
   * Eight write routes were removed from the server in build
   * `++Wardogs+Live-CL-501228` (2026-09-14) and are now config-document edits.
   * They stay registered because older builds still serve them, but the panel
   * says so rather than presenting a 404 as an ordinary endpoint.
   */
  deprecated?: string;
}

const STEAM_ID = '76561198000000002';

/** Ascending, so a stale revision is the only reason 412 can happen. */
const ROUTES: readonly RouteSpec[] = [
  /* Status ----------------------------------------------------------------- */
  { id: 'GET /v1/status', group: 'Status', summary: 'Live match state', mutating: false },

  /* Players ---------------------------------------------------------------- */
  { id: 'GET /v1/players', group: 'Players', summary: 'Connected players', mutating: false },
  {
    id: 'POST /v1/players/{steamId}/kick',
    group: 'Players',
    summary: 'Disconnect a player',
    mutating: true,
    params: [{ name: 'steamId', label: 'SteamID64', value: STEAM_ID, kind: 'steamId' }],
    body: { kind: 'json', template: '{\n  "reason": "example kick"\n}' },
  },
  {
    id: 'POST /v1/players/{steamId}/kill',
    group: 'Players',
    summary: 'Kill in match, no disconnect',
    mutating: true,
    params: [{ name: 'steamId', label: 'SteamID64', value: STEAM_ID, kind: 'steamId' }],
  },
  {
    id: 'POST /v1/players/{steamId}/message',
    group: 'Players',
    summary: 'Direct message to one player',
    mutating: true,
    params: [{ name: 'steamId', label: 'SteamID64', value: STEAM_ID, kind: 'steamId' }],
    body: { kind: 'json', template: '{\n  "message": "Hello from the panel"\n}' },
  },
  {
    id: 'PATCH /v1/players/{steamId}',
    group: 'Players',
    summary: 'Move a player between factions',
    mutating: true,
    params: [{ name: 'steamId', label: 'SteamID64', value: STEAM_ID, kind: 'steamId' }],
    body: { kind: 'json', template: '{\n  "faction": "NATO"\n}' },
  },
  {
    id: 'POST /v1/broadcast',
    group: 'Players',
    summary: 'Message everyone',
    mutating: true,
    body: { kind: 'json', template: '{\n  "message": "Server restarting in 5 minutes"\n}' },
  },

  /* Moderation ------------------------------------------------------------- */
  { id: 'GET /v1/bans', group: 'Moderation', summary: 'The ban list', mutating: false },
  {
    id: 'POST /v1/bans',
    group: 'Moderation',
    summary: 'Ban a player',
    mutating: true,
    body: { kind: 'json', template: `{\n  "steamId": "${STEAM_ID}",\n  "reason": "cheating"\n}` },
  },
  {
    id: 'DELETE /v1/bans/{steamId}',
    group: 'Moderation',
    summary: 'Lift a ban',
    mutating: true,
    params: [{ name: 'steamId', label: 'SteamID64', value: STEAM_ID, kind: 'steamId' }],
  },
  {
    id: 'GET /v1/reserved-slots',
    group: 'Moderation',
    summary: 'Reserved slot holders',
    mutating: false,
  },
  {
    id: 'POST /v1/reserved-slots',
    group: 'Moderation',
    summary: 'Grant a reserved slot',
    mutating: true,
    body: { kind: 'json', template: `{\n  "steamId": "${STEAM_ID}"\n}` },
    // Removed from the server in ++Wardogs+Live-CL-501228; older builds
    // still serve it. Its replacement is a config-document edit.
    deprecated:
      'Removed in build ++Wardogs+Live-CL-501228 (2026-09-14). Edit the config document instead.',
  },
  {
    id: 'DELETE /v1/reserved-slots/{steamId}',
    group: 'Moderation',
    summary: 'Revoke a reserved slot',
    mutating: true,
    params: [{ name: 'steamId', label: 'SteamID64', value: STEAM_ID, kind: 'steamId' }],
    // Removed from the server in ++Wardogs+Live-CL-501228; older builds
    // still serve it. Its replacement is a config-document edit.
    deprecated:
      'Removed in build ++Wardogs+Live-CL-501228 (2026-09-14). Edit the config document instead.',
  },
  {
    id: 'GET /v1/audit',
    group: 'Moderation',
    summary: 'Admin action log',
    mutating: false,
    query: [{ name: 'limit', label: 'Limit (1–500)', value: '10' }],
  },

  /* Match ------------------------------------------------------------------ */
  {
    id: 'POST /v1/match/map',
    group: 'Match',
    summary: 'Change map now',
    mutating: true,
    body: {
      kind: 'json',
      template:
        '{\n  "map": "Kavkazi",\n  "experiences": ["Bakurani_KOTH_01"],\n  "lighting": "DayClear"\n}',
    },
  },
  { id: 'POST /v1/match/end', group: 'Match', summary: 'End the current match', mutating: true },
  {
    id: 'POST /v1/match/restart',
    group: 'Match',
    summary: 'Restart the current match',
    mutating: true,
  },
  {
    id: 'PUT /v1/world/lighting',
    group: 'Match',
    summary: 'Change lighting live',
    mutating: true,
    body: { kind: 'json', template: '{\n  "lighting": "DayLateGray"\n}' },
  },

  /* Rotation --------------------------------------------------------------- */
  { id: 'GET /v1/rotation', group: 'Rotation', summary: 'The full rotation', mutating: false },
  {
    id: 'POST /v1/rotation/entries',
    group: 'Rotation',
    summary: 'Append a rotation entry',
    mutating: true,
    body: { kind: 'json', template: '{\n  "map": "Europe",\n  "lighting": "DayLateGray"\n}' },
    // Removed from the server in ++Wardogs+Live-CL-501228; older builds
    // still serve it. Its replacement is a config-document edit.
    deprecated:
      'Removed in build ++Wardogs+Live-CL-501228 (2026-09-14). Edit the config document instead.',
  },
  {
    id: 'DELETE /v1/rotation/entries/{i}',
    group: 'Rotation',
    summary: 'Remove an entry by index',
    mutating: true,
    params: [{ name: 'i', label: 'Index', value: '0' }],
    // Removed from the server in ++Wardogs+Live-CL-501228; older builds
    // still serve it. Its replacement is a config-document edit.
    deprecated:
      'Removed in build ++Wardogs+Live-CL-501228 (2026-09-14). Edit the config document instead.',
  },
  {
    id: 'POST /v1/rotation/entries/{i}/move',
    group: 'Rotation',
    summary: 'Reorder one entry',
    mutating: true,
    params: [{ name: 'i', label: 'Index', value: '1' }],
    body: { kind: 'json', template: '{\n  "direction": "up"\n}' },
    // Removed from the server in ++Wardogs+Live-CL-501228; older builds
    // still serve it. Its replacement is a config-document edit.
    deprecated:
      'Removed in build ++Wardogs+Live-CL-501228 (2026-09-14). Edit the config document instead.',
  },
  {
    id: 'POST /v1/rotation/save',
    group: 'Rotation',
    summary: 'Persist rotation edits to ServerSettings.ini',
    mutating: true,
    // Removed from the server in ++Wardogs+Live-CL-501228; older builds
    // still serve it. Its replacement is a config-document edit.
    deprecated:
      'Removed in build ++Wardogs+Live-CL-501228 (2026-09-14). Edit the config document instead.',
  },

  /* Settings --------------------------------------------------------------- */
  {
    id: 'PATCH /v1/settings',
    group: 'Settings',
    summary: 'Patch score tick and rotation settings',
    mutating: true,
    body: { kind: 'json', template: '{\n  "scoreTick": 20\n}' },
    // Removed from the server in ++Wardogs+Live-CL-501228; older builds
    // still serve it. Its replacement is a config-document edit.
    deprecated:
      'Removed in build ++Wardogs+Live-CL-501228 (2026-09-14). Edit the config document instead.',
  },

  /* Catalog ---------------------------------------------------------------- */
  { id: 'GET /v1/catalog/maps', group: 'Catalog', summary: 'Available maps', mutating: false },
  {
    id: 'GET /v1/catalog/lightings',
    group: 'Catalog',
    summary: 'Available lighting presets',
    mutating: false,
  },
  {
    id: 'GET /v1/catalog/experiences',
    group: 'Catalog',
    summary: 'Available experiences',
    mutating: false,
  },
  {
    id: 'GET /v1/catalog/maps/{id}/experiences',
    group: 'Catalog',
    summary: 'Experiences valid for one map',
    mutating: false,
    params: [{ name: 'id', label: 'Map id', value: 'Kavkazi' }],
  },
  {
    id: 'GET /v1/catalog/maps/{id}/alternators',
    group: 'Catalog',
    summary: 'Zone alternators for one map',
    mutating: false,
    params: [{ name: 'id', label: 'Map id', value: 'Kavkazi' }],
  },

  /* Sponsor ---------------------------------------------------------------- */
  { id: 'GET /v1/sponsor', group: 'Sponsor', summary: 'The sponsor banner', mutating: false },
  {
    id: 'PUT /v1/sponsor',
    group: 'Sponsor',
    summary: 'Set the sponsor banner URL',
    mutating: true,
    body: { kind: 'json', template: '{\n  "imageUrl": "https://cdn.example.com/banner.png"\n}' },
    // Removed from the server in ++Wardogs+Live-CL-501228; older builds
    // still serve it. Its replacement is a config-document edit.
    deprecated:
      'Removed in build ++Wardogs+Live-CL-501228 (2026-09-14). Edit the config document instead.',
  },

  /* Meta ------------------------------------------------------------------- */
  {
    id: 'GET /v1/capabilities',
    group: 'Meta',
    summary: 'Which routes this server exposes',
    mutating: false,
  },
  {
    id: 'GET /v1/server-id',
    group: 'Meta',
    summary: 'Stable id for this server',
    mutating: false,
  },
  {
    id: 'GET /v1/health',
    group: 'Meta',
    summary: 'Liveness and queue depth',
    mutating: false,
  },

  /* Config ----------------------------------------------------------------- */
  { id: 'GET /v1/config', group: 'Config', summary: 'Document plus its revision', mutating: false },
  {
    id: 'PUT /v1/config',
    group: 'Config',
    summary: 'Apply a config document (text/plain)',
    mutating: true,
    body: { kind: 'text', template: '' },
    owner: 'config',
  },
  {
    id: 'POST /v1/config/validate',
    group: 'Config',
    summary: 'Check a document without applying (text/plain)',
    // A POST that changes nothing — the reference's whole point for this route
    // is that it does not apply. Marking it mutating would hide the safest way
    // to check an edit behind the read-only guard.
    mutating: false,
    body: { kind: 'text', template: '' },
    owner: 'config',
  },
];

export const ROUTE_SPECS: readonly RouteSpec[] = ROUTES;

const BY_ID: ReadonlyMap<string, RouteSpec> = new Map(ROUTES.map((route) => [route.id, route]));

export function routeSpec(id: RouteId): RouteSpec {
  const spec = BY_ID.get(id);
  if (spec === undefined) {
    // Unreachable while the registry covers `ROUTE_IDS`, which a test asserts.
    // Throwing beats returning a default: a missing spec would otherwise render
    // as a read-only GET form with no body, and look like it worked.
    throw new Error(`No registry entry for ${id}`);
  }
  return spec;
}

/** `"POST /v1/players/{steamId}/kick"` → `"POST"` / `"/v1/players/{steamId}/kick"`. */
export function splitRouteId(id: string): { method: string; path: string } {
  const space = id.indexOf(' ');
  return { method: id.slice(0, space), path: id.slice(space + 1) };
}

/** Fills `{placeholders}` from the form, percent-encoding as it goes. */
export function fillParams(path: string, values: Record<string, string>): string {
  return path.replace(/\{([^}]*)\}/g, (_match, name: string) => {
    const value = values[name];
    if (value === undefined || value === '') {
      throw new Error(`Missing value for {${name}}`);
    }
    return encodeURIComponent(value);
  });
}

/**
 * Query parameters, dropping the empty ones.
 *
 * An empty `?limit=` is a different request from no `limit` at all — the server
 * only picks its own default in the second case.
 */
export function buildQuery(values: Record<string, string>): Record<string, string> | undefined {
  const entries = Object.entries(values).filter(([, value]) => value.trim() !== '');
  return entries.length === 0 ? undefined : Object.fromEntries(entries);
}

/** Every route this group owns, in registry order. */
export function routesInGroup(group: RouteGroup): RouteSpec[] {
  return ROUTES.filter((route) => route.group === group);
}

/** Guards against a route being added to the registry but not to a group list. */
export function assertRegistryCoversRoutes(): void {
  const missing = ROUTE_IDS.filter((id) => !BY_ID.has(id));
  if (missing.length > 0) {
    throw new Error(`Route registry is missing: ${missing.join(', ')}`);
  }
}
