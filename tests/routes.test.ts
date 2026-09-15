/**
 * Conformance with the vendored API spec.
 *
 * The API this library wraps is an unofficial community reference that can
 * change without notice. These tests are the tripwire: they compare the shipped
 * route list and the typed request/response surface against
 * `spec/openapi.json`, so a server-side change fails CI here rather than
 * surfacing as "route not supported" in someone's dashboard.
 *
 * No network access — the spec is a file in the repo.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  ROUTE_IDS,
  isRouteId,
  normalizeRoute,
  routeMatches,
  splitRoute,
} from '../src/core/routes.js';
import type {
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
} from '../src/index.js';
import { SPEC_UPDATED, SPEC_VERSION } from '../src/version.js';

const here = dirname(fileURLToPath(import.meta.url));
const specPath = join(here, '..', 'spec', 'openapi.json');

interface OpenApiSpec {
  info: { version: string; 'x-lastUpdated': string; 'x-apiVersion': string };
  paths: Record<string, Record<string, unknown>>;
  components: { schemas: Record<string, unknown> };
}

const spec = JSON.parse(readFileSync(specPath, 'utf8')) as OpenApiSpec;

/** Every `"METHOD /path"` the spec declares. */
function specRoutes(): string[] {
  const routes: string[] = [];
  for (const [path, methods] of Object.entries(spec.paths)) {
    for (const method of Object.keys(methods)) {
      routes.push(`${method.toUpperCase()} ${path}`);
    }
  }
  return routes.sort();
}

describe('routes match the vendored spec', () => {
  it('declares every route the spec declares, and no others', () => {
    const expected = specRoutes();
    const actual = [...ROUTE_IDS].sort();

    expect(actual).toEqual(expected);
  });

  it('has no duplicate route ids', () => {
    expect(new Set(ROUTE_IDS).size).toBe(ROUTE_IDS.length);
  });

  it('reports the spec count the reference advertises', () => {
    // The reference page states "37 endpoints"; the spec has the same count
    // across 33 paths. Asserting the number catches a partial spec fetch being
    // vendored, which would otherwise silently shrink the library's surface.
    expect(ROUTE_IDS).toHaveLength(37);
    expect(Object.keys(spec.paths)).toHaveLength(33);
  });

  it('recognises every declared route via isRouteId', () => {
    for (const route of ROUTE_IDS) {
      expect(isRouteId(route), route).toBe(true);
    }
    expect(isRouteId('GET /v1/nope')).toBe(false);
    expect(isRouteId('get /v1/status')).toBe(false);
  });
});

describe('normalizeRoute', () => {
  it('collapses parameter names, which differ between spec and prose', () => {
    // The spec writes `{steamId}`; the reference's examples write `{id}`. The
    // parameter name is meaningless on the wire, so both must compare equal —
    // otherwise a capability check reports a supported route as unsupported.
    expect(normalizeRoute('PATCH /v1/players/{id}')).toBe('PATCH /v1/players/{*}');
    expect(normalizeRoute('PATCH /v1/players/{steamId}')).toBe('PATCH /v1/players/{*}');
    expect(routeMatches('PATCH /v1/players/{steamId}', 'patch /v1/players/{id}/')).toBe(true);
  });

  it('is case- and whitespace-insensitive on the method', () => {
    expect(normalizeRoute('  get   /v1/status  ')).toBe('GET /v1/status');
  });

  it('drops a trailing slash', () => {
    expect(normalizeRoute('GET /v1/status/')).toBe('GET /v1/status');
  });

  it('handles every parameterised route in the spec', () => {
    for (const route of ROUTE_IDS) {
      const normalized = normalizeRoute(route);
      if (route.includes('{')) {
        expect(normalized, route).toContain('{*}');
      } else {
        expect(normalized, route).not.toContain('{');
      }
    }
  });
});

describe('splitRoute', () => {
  it('splits on the first space', () => {
    expect(splitRoute('GET /v1/a b')).toEqual({ method: 'GET', path: '/v1/a b' });
  });

  it('rejects malformed input rather than guessing', () => {
    expect(splitRoute('GET')).toBeNull();
    expect(splitRoute('GETv1/status')).toBeNull();
    expect(splitRoute('GET v1/status')).toBeNull();
    expect(splitRoute('')).toBeNull();
  });
});

describe('typed surface covers the spec schemas', () => {
  /**
   * Compile-time assertion, spelled as a runtime no-op.
   *
   * `satisfies` turns any name that is not actually exported into a type
   * error, so a schema added to the spec without an accompanying type cannot
   * pass typecheck. The runtime half then checks the list is complete.
   */
  const covered = {
    Ok: null as unknown as Ok,
    Error: null as unknown as ErrorBody,
    FactionScore: null as unknown as FactionScore,
    Status: null as unknown as Status,
    Player: null as unknown as Player,
    Players: null as unknown as Players,
    Capabilities: null as unknown as Capabilities,
    Ban: null as unknown as Ban,
    Bans: null as unknown as Bans,
    ReservedSlots: null as unknown as ReservedSlots,
    AuditEntry: null as unknown as AuditEntry,
    Audit: null as unknown as Audit,
    RotationEntry: null as unknown as RotationEntry,
    Rotation: null as unknown as Rotation,
    Catalog: null as unknown as Catalog,
    Sponsor: null as unknown as Sponsor,
    Config: null as unknown as Config,
    ConfigResult: null as unknown as ConfigResult,
    ConfigError: null as unknown as ConfigError,
    ConfigChange: null as unknown as ConfigChange,
    ServerId: null as unknown as ServerId,
    Health: null as unknown as Health,
    MapSelection: null as unknown as MapSelection,
    ReasonRequest: null as unknown as ReasonRequest,
    BanRequest: null as unknown as BanRequest,
    SteamIdRequest: null as unknown as SteamIdRequest,
    MessageRequest: null as unknown as MessageRequest,
    FactionRequest: null as unknown as FactionRequest,
    LightingRequest: null as unknown as LightingRequest,
    MoveRequest: null as unknown as MoveRequest,
    SettingsPatch: null as unknown as SettingsPatch,
    SponsorRequest: null as unknown as SponsorRequest,
  } satisfies Record<string, unknown>;

  it('has a type for every component schema', () => {
    expect(Object.keys(covered).sort()).toEqual(Object.keys(spec.components.schemas).sort());
  });

  it('keeps the deliberate types that go beyond the spec', () => {
    // The spec types both catalog sub-endpoints as a plain `Ok`, which cannot
    // be right — they are named for and documented as returning lists. These
    // types are additions, not omissions, so they are excluded from the
    // schema-name comparison above and pinned here instead.
    const additions = {
      MapExperiences: null as unknown as MapExperiences,
      MapAlternators: null as unknown as MapAlternators,
    } satisfies Record<string, unknown>;

    expect(Object.keys(additions).sort()).toEqual(['MapAlternators', 'MapExperiences']);
  });
});

describe('vendored spec provenance', () => {
  it('matches the version the library declares it was written against', () => {
    // If the spec file is refreshed, src/version.ts must be updated too — the
    // published constants are what a user checks when something looks wrong.
    expect(spec.info['x-apiVersion']).toBe('v1');
    expect(typeof spec.info.version).toBe('string');
    expect(typeof spec.info['x-lastUpdated']).toBe('string');
  });

  it('pins the declared constants to the vendored file', () => {
    // `SPEC_VERSION` and `SPEC_UPDATED` are hand-maintained while the spec
    // file is a verbatim snapshot, so nothing else stops one being refreshed
    // without the other — which is exactly how this library quietly drifted
    // two spec releases behind. Anchor them to the file itself.
    expect(SPEC_VERSION).toBe(spec.info.version);
    expect(SPEC_UPDATED).toBe(spec.info['x-lastUpdated']);
  });

  it('documents bearer auth on the only security scheme', () => {
    const schemes = (
      spec as unknown as {
        components: { securitySchemes: Record<string, { scheme?: string }> };
      }
    ).components.securitySchemes;

    expect(Object.keys(schemes)).toEqual(['bearerAuth']);
    expect(schemes['bearerAuth']?.scheme).toBe('bearer');
  });

  it('keeps the two text/plain endpoints, which are the odd ones out', () => {
    const putConfig = spec.paths['/v1/config']?.['put'] as
      { requestBody?: { content?: Record<string, unknown> } } | undefined;
    const validate = spec.paths['/v1/config/validate']?.['post'] as
      { requestBody?: { content?: Record<string, unknown> } } | undefined;

    expect(Object.keys(putConfig?.requestBody?.content ?? {})).toEqual(['text/plain']);
    expect(Object.keys(validate?.requestBody?.content ?? {})).toEqual(['text/plain']);
  });

  it('keeps If-Match on the config write, which is what detects a stale edit', () => {
    const putConfig = spec.paths['/v1/config']?.['put'] as
      { parameters?: { name: string }[] } | undefined;

    const names = (putConfig?.parameters ?? []).map((p) => p.name);
    expect(names).toContain('If-Match');
  });
});
