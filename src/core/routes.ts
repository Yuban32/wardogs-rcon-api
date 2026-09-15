/**
 * The complete `/v1` route surface.
 *
 * Every operation the API exposes is named here as a literal `"METHOD /path"`
 * string, which is the same form `GET /v1/capabilities` uses in its `routes`
 * array. Keeping that correspondence lets capability checks take a `RouteId`
 * instead of a hand-typed string.
 *
 * `tests/routes.test.ts` asserts this union matches the vendored spec exactly,
 * so adding or losing an endpoint fails the build's test run rather than
 * silently producing "route not supported" at runtime.
 */

/** Every operation in the API, as `"METHOD /v1/..."`. */
export type RouteId =
  // Match state
  | 'GET /v1/status'
  // Players
  | 'GET /v1/players'
  | 'POST /v1/players/{steamId}/kick'
  | 'POST /v1/players/{steamId}/kill'
  | 'POST /v1/players/{steamId}/message'
  | 'PATCH /v1/players/{steamId}'
  // Moderation
  | 'GET /v1/bans'
  | 'POST /v1/bans'
  | 'DELETE /v1/bans/{steamId}'
  | 'GET /v1/reserved-slots'
  /**
   * @deprecated Removed in server build `++Wardogs+Live-CL-501228` (2026-09-14).
   * A current server answers 404 and omits it from `GET /v1/capabilities`;
   * older builds still serve it. Edit the config document instead.
   */
  | 'POST /v1/reserved-slots'
  /** @deprecated Removed in build `++Wardogs+Live-CL-501228`. See {@link RouteId}. */
  | 'DELETE /v1/reserved-slots/{steamId}'
  // Meta
  | 'GET /v1/capabilities'
  | 'GET /v1/server-id'
  | 'GET /v1/health'
  | 'GET /v1/audit'
  // Match control
  | 'POST /v1/broadcast'
  | 'POST /v1/match/map'
  | 'POST /v1/match/end'
  | 'POST /v1/match/restart'
  | 'PUT /v1/world/lighting'
  // Rotation
  | 'GET /v1/rotation'
  /** @deprecated Removed in build `++Wardogs+Live-CL-501228`. See {@link RouteId}. */
  | 'POST /v1/rotation/entries'
  /** @deprecated Removed in build `++Wardogs+Live-CL-501228`. See {@link RouteId}. */
  | 'DELETE /v1/rotation/entries/{i}'
  /** @deprecated Removed in build `++Wardogs+Live-CL-501228`. See {@link RouteId}. */
  | 'POST /v1/rotation/entries/{i}/move'
  /** @deprecated Removed in build `++Wardogs+Live-CL-501228`. See {@link RouteId}. */
  | 'POST /v1/rotation/save'
  // Settings
  /** @deprecated Removed in build `++Wardogs+Live-CL-501228`. See {@link RouteId}. */
  | 'PATCH /v1/settings'
  // Catalog
  | 'GET /v1/catalog/maps'
  | 'GET /v1/catalog/lightings'
  | 'GET /v1/catalog/experiences'
  | 'GET /v1/catalog/maps/{id}/experiences'
  | 'GET /v1/catalog/maps/{id}/alternators'
  // Sponsor
  | 'GET /v1/sponsor'
  /** @deprecated Removed in build `++Wardogs+Live-CL-501228`. See {@link RouteId}. */
  | 'PUT /v1/sponsor'
  // Config
  | 'GET /v1/config'
  | 'PUT /v1/config'
  | 'POST /v1/config/validate';

/** Every {@link RouteId}, for iteration, validation and conformance testing. */
export const ROUTE_IDS = [
  'GET /v1/status',
  'GET /v1/players',
  'POST /v1/players/{steamId}/kick',
  'POST /v1/players/{steamId}/kill',
  'POST /v1/players/{steamId}/message',
  'PATCH /v1/players/{steamId}',
  'GET /v1/bans',
  'POST /v1/bans',
  'DELETE /v1/bans/{steamId}',
  'GET /v1/reserved-slots',
  /** @deprecated Removed in build `++Wardogs+Live-CL-501228`. */
  'POST /v1/reserved-slots',
  /** @deprecated Removed in build `++Wardogs+Live-CL-501228`. */
  'DELETE /v1/reserved-slots/{steamId}',
  'GET /v1/capabilities',
  'GET /v1/server-id',
  'GET /v1/health',
  'GET /v1/audit',
  'POST /v1/broadcast',
  'POST /v1/match/map',
  'POST /v1/match/end',
  'POST /v1/match/restart',
  'PUT /v1/world/lighting',
  'GET /v1/rotation',
  /** @deprecated Removed in build `++Wardogs+Live-CL-501228`. */
  'POST /v1/rotation/entries',
  /** @deprecated Removed in build `++Wardogs+Live-CL-501228`. */
  'DELETE /v1/rotation/entries/{i}',
  /** @deprecated Removed in build `++Wardogs+Live-CL-501228`. */
  'POST /v1/rotation/entries/{i}/move',
  /** @deprecated Removed in build `++Wardogs+Live-CL-501228`. */
  'POST /v1/rotation/save',
  /** @deprecated Removed in build `++Wardogs+Live-CL-501228`. */
  'PATCH /v1/settings',
  'GET /v1/catalog/maps',
  'GET /v1/catalog/lightings',
  'GET /v1/catalog/experiences',
  'GET /v1/catalog/maps/{id}/experiences',
  'GET /v1/catalog/maps/{id}/alternators',
  'GET /v1/sponsor',
  /** @deprecated Removed in build `++Wardogs+Live-CL-501228`. */
  'PUT /v1/sponsor',
  'GET /v1/config',
  'PUT /v1/config',
  'POST /v1/config/validate',
] as const satisfies readonly RouteId[];

const ROUTE_ID_SET: ReadonlySet<string> = new Set(ROUTE_IDS);

export function isRouteId(value: string): value is RouteId {
  return ROUTE_ID_SET.has(value);
}

/** Splits a `"METHOD /path"` string, tolerating extra whitespace and casing. */
export function splitRoute(route: string): { method: string; path: string } | null {
  const trimmed = route.trim();
  const firstSpace = trimmed.indexOf(' ');
  if (firstSpace <= 0) return null;
  const method = trimmed.slice(0, firstSpace).toUpperCase();
  const path = trimmed.slice(firstSpace + 1).trim();
  if (!path.startsWith('/')) return null;
  return { method, path };
}

/**
 * Canonical form of a route string, for comparison.
 *
 * The machine-readable spec writes path parameters as `{steamId}` / `{id}`,
 * while the prose reference's examples use `{id}` for the same routes. The
 * parameter *name* carries no meaning on the wire, so comparison collapses
 * every `{...}` placeholder to `{*}`, upper-cases the method and drops any
 * trailing slash.
 *
 * Without this, a capabilities check would report "route not supported" for a
 * route the server plainly supports — the exact failure this library exists to
 * avoid.
 *
 * @example
 * normalizeRoute('patch /v1/players/{id}/') // 'PATCH /v1/players/{*}'
 */
export function normalizeRoute(route: string): string {
  const parts = splitRoute(route);
  if (parts === null) return route.trim();
  const path = parts.path.replace(/\{[^}]*\}/g, '{*}').replace(/\/+$/, '');
  return `${parts.method} ${path}`;
}

/**
 * Whether `availableRoute` (as reported by `GET /v1/capabilities`) covers the
 * `wanted` route.
 */
export function routeMatches(wanted: RouteId | string, availableRoute: string): boolean {
  return normalizeRoute(wanted) === normalizeRoute(availableRoute);
}
