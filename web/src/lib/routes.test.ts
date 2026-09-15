/**
 * The registry is the panel's map of the API, so the test that matters is the
 * one comparing it against the library's own list.
 *
 * `ROUTE_IDS` is already proven against `spec/openapi.json` by the library's
 * test suite. Asserting the registry covers it exactly means the panel cannot
 * quietly fall behind the API: a route added to the spec turns up here as a
 * failure, not as a missing row in a dropdown.
 */

import { ROUTE_IDS } from '@wardogs/api';
import { describe, expect, it } from 'vitest';

import {
  GROUP_ORDER,
  ROUTE_SPECS,
  buildQuery,
  fillParams,
  routeSpec,
  routesInGroup,
  splitRouteId,
} from './routes';

describe('route registry', () => {
  it('covers every route the library declares, and no others', () => {
    const declared = [...ROUTE_IDS].sort();
    const registered = ROUTE_SPECS.map((spec) => spec.id).sort();
    expect(registered).toEqual(declared);
  });

  it('has no duplicates', () => {
    const ids = ROUTE_SPECS.map((spec) => spec.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('puts every route in a group the UI knows how to order', () => {
    for (const spec of ROUTE_SPECS) {
      expect(GROUP_ORDER, spec.id).toContain(spec.group);
    }
  });

  it('orders every group without dropping one', () => {
    const grouped = GROUP_ORDER.flatMap((group) => routesInGroup(group)).map((spec) => spec.id);
    expect(grouped.sort()).toEqual([...ROUTE_IDS].sort());
  });

  it('marks every non-GET route as mutating, except the config validator', () => {
    for (const spec of ROUTE_SPECS) {
      const { method } = splitRouteId(spec.id);
      if (method === 'GET') {
        expect(spec.mutating, spec.id).toBe(false);
        continue;
      }
      // `POST /v1/config/validate` is the exception, and deliberately so: the
      // whole point of the route is that it applies nothing. Marking it
      // mutating would hide the safest way to check an edit behind the
      // read-only guard.
      if (spec.id === 'POST /v1/config/validate') {
        expect(spec.mutating).toBe(false);
        continue;
      }
      expect(spec.mutating, spec.id).toBe(true);
    }
  });

  it('gives every placeholder in a path a matching spec field', () => {
    for (const spec of ROUTE_SPECS) {
      const { path } = splitRouteId(spec.id);
      const placeholders = [...path.matchAll(/\{([^}]*)\}/g)].map((match) => match[1]);
      const fields = (spec.params ?? []).map((param) => param.name);
      expect(fields.sort(), spec.id).toEqual(placeholders.sort());
    }
  });

  it('routes the two text/plain bodies to the config panel', () => {
    const textRoutes = ROUTE_SPECS.filter((spec) => spec.body?.kind === 'text');
    expect(textRoutes.map((spec) => spec.id).sort()).toEqual([
      'POST /v1/config/validate',
      'PUT /v1/config',
    ]);
    for (const spec of textRoutes) {
      expect(spec.owner, spec.id).toBe('config');
    }
  });

  it('throws rather than inventing a spec for an unknown route', () => {
    expect(() => routeSpec('GET /v1/nope' as never)).toThrow(/No registry entry/);
  });
});

describe('splitRouteId', () => {
  it('splits on the first space', () => {
    expect(splitRouteId('POST /v1/players/{steamId}/kick')).toEqual({
      method: 'POST',
      path: '/v1/players/{steamId}/kick',
    });
  });
});

describe('fillParams', () => {
  it('substitutes and percent-encodes', () => {
    expect(fillParams('/v1/players/{steamId}/kick', { steamId: '76561198000000002' })).toBe(
      '/v1/players/76561198000000002/kick',
    );
    expect(fillParams('/v1/catalog/maps/{id}/alternators', { id: 'a/b' })).toBe(
      '/v1/catalog/maps/a%2Fb/alternators',
    );
  });

  it('refuses to send a path with a hole in it', () => {
    expect(() => fillParams('/v1/players/{steamId}', {})).toThrow(/Missing value/);
    expect(() => fillParams('/v1/players/{steamId}', { steamId: '' })).toThrow(/Missing value/);
  });
});

describe('buildQuery', () => {
  it('drops empty values, because ?limit= is not the same as no limit', () => {
    expect(buildQuery({ limit: '' })).toBeUndefined();
    expect(buildQuery({ limit: '   ' })).toBeUndefined();
    expect(buildQuery({ limit: '10' })).toEqual({ limit: '10' });
  });
});
