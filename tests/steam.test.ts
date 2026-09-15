/**
 * SteamID64 helpers.
 *
 * These exist to stop one specific, unrecoverable mistake: passing a SteamID64
 * through a JS number. The value needs 64 bits and a double carries 53, so the
 * low digits are gone by the time it arrives — and the rounded result is still
 * a plausible SteamID64 belonging to somebody else. Since the ids end up in
 * kick and ban requests, guessing is not an option.
 */

import { describe, expect, it } from 'vitest';

import {
  accountIdToSteamId64,
  isSteamId64,
  steamId64ToAccountId,
  steamId64ToLegacy,
  toSteamId64,
} from '../src/index.js';

const VALID = '76561198000000001';

describe('isSteamId64', () => {
  it('accepts a 17-digit individual-account id', () => {
    expect(isSteamId64(VALID)).toBe(true);
    expect(isSteamId64('76561197960265728')).toBe(true);
  });

  it('rejects a number, which cannot represent it exactly', () => {
    expect(isSteamId64(76561198000000001)).toBe(false);
  });

  it('rejects a string of the wrong length', () => {
    expect(isSteamId64('123')).toBe(false);
    expect(isSteamId64('765611980000000011')).toBe(false);
  });

  it('rejects non-digits', () => {
    expect(isSteamId64('7656119800000000a')).toBe(false);
    expect(isSteamId64(' 76561198000000001')).toBe(false);
  });

  it('rejects group and game-server ids below the individual range', () => {
    // These are structurally valid Steam ID *spaces* but cannot be kicked,
    // banned or granted a reserved slot, so accepting them only defers the
    // failure to the server.
    expect(isSteamId64('90071996842321411')).toBe(false);
    expect(isSteamId64('76561197960265727')).toBe(false);
  });

  it('rejects non-strings', () => {
    expect(isSteamId64(null)).toBe(false);
    expect(isSteamId64(undefined)).toBe(false);
    expect(isSteamId64({})).toBe(false);
  });
});

describe('toSteamId64', () => {
  it('passes a valid string through', () => {
    expect(toSteamId64(VALID)).toBe(VALID);
  });

  it('trims surrounding whitespace', () => {
    expect(toSteamId64(`  ${VALID}  `)).toBe(VALID);
  });

  it('accepts a bigint', () => {
    expect(toSteamId64(76561198000000001n)).toBe(VALID);
  });

  it('throws on a number, naming the reason', () => {
    // The whole point of the helper. A silently coerced number here bans
    // whoever the rounded value happens to point at.
    expect(() => toSteamId64(76561198000000001)).toThrow(TypeError);
    expect(() => toSteamId64(76561198000000001)).toThrow(/cannot represent/);
  });

  it('throws on a malformed string', () => {
    expect(() => toSteamId64('not-an-id')).toThrow(RangeError);
    expect(() => toSteamId64('')).toThrow(RangeError);
  });

  it('throws on a bigint outside the individual range', () => {
    expect(() => toSteamId64(1n)).toThrow(RangeError);
  });

  it('rejects the value a naive Number() conversion would produce', () => {
    // Demonstrates the hazard concretely: the rounded double is a different
    // id, and it is not obviously different to a reader.
    const asNumber = 76561198000000001;
    expect(String(asNumber)).toBe('76561198000000000');
    expect(toSteamId64(String(asNumber))).not.toBe(VALID);
  });
});

describe('steamId64ToAccountId', () => {
  it('extracts the low 32 bits', () => {
    expect(steamId64ToAccountId(VALID)).toBe(39734273);
  });

  it('round-trips through accountIdToSteamId64', () => {
    for (const id of [VALID, '76561197960265728', '76561199999999999']) {
      expect(accountIdToSteamId64(steamId64ToAccountId(id))).toBe(id);
    }
  });

  it('throws on an invalid input', () => {
    expect(() => steamId64ToAccountId('123')).toThrow(RangeError);
  });
});

describe('accountIdToSteamId64', () => {
  it('builds an individual-account id from an account id', () => {
    expect(accountIdToSteamId64(39734273)).toBe(VALID);
  });

  it('accepts the top of the 32-bit range, which lands just inside valid', () => {
    expect(accountIdToSteamId64(0)).toBe('76561197960265728');
    expect(() => accountIdToSteamId64(0xffffffff)).not.toThrow();
  });

  it('rejects a value outside the 32-bit unsigned range', () => {
    expect(() => accountIdToSteamId64(-1)).toThrow(RangeError);
    expect(() => accountIdToSteamId64(2 ** 32)).toThrow(RangeError);
    expect(() => accountIdToSteamId64(1.5)).toThrow(RangeError);
  });
});

describe('steamId64ToLegacy', () => {
  it('produces the STEAM_X:Y:Z form', () => {
    // Legacy format still appears in server configs and third-party tools.
    expect(steamId64ToLegacy(VALID)).toBe('STEAM_1:1:19867136');
  });

  it('throws on an invalid input', () => {
    expect(() => steamId64ToLegacy('nope')).toThrow(RangeError);
  });
});
