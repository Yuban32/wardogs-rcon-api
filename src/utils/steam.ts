/**
 * SteamID64 helpers.
 *
 * Player-facing endpoints identify people by SteamID64 — a 17-digit number in
 * the `7656119...` range. The API returns it as a string, and that is how it
 * must be handled: the value exceeds `Number.MAX_SAFE_INTEGER`, so any trip
 * through a numeric type silently corrupts the low digits and produces a
 * plausible-looking ID belonging to someone else.
 */

/**
 * The first seven digits of every individual-account SteamID64.
 *
 * A SteamID64 is `<universe><type><instance>:32><accountId:32>`, and the
 * combination identifying an individual account in the public universe is
 * fixed. This is what rejects a game-server id like `90071996842321411`, which
 * is otherwise a well-formed 17-digit number but cannot be kicked, banned or
 * granted a reserved slot.
 *
 * String comparisons throughout, never arithmetic: a 17-digit value exceeds
 * `Number.MAX_SAFE_INTEGER`, so any trip through a `number` silently corrupts
 * the low digits and yields an id belonging to someone else.
 */
const INDIVIDUAL_ACCOUNT_PREFIX = '7656119';

/** The lowest individual-account SteamID64: the prefix with an account id of 0. */
const MIN_INDIVIDUAL_ACCOUNT_ID = '76561197960265728';

/**
 * Whether `value` is a well-formed individual-account SteamID64.
 *
 * Two checks, and both are load-bearing:
 *
 * - The **prefix** rules out the other Steam ID spaces (game servers, groups,
 *   clans), whose ids are also 17 digits but address something un-bannable.
 * - The **lower bound** rules out ids just below the individual range itself,
 *   which the prefix alone accepts because they share it.
 *
 * Both compare as strings. Lexicographic ordering is exact for equal-length
 * digit strings, and it is the only ordering available here that does not
 * destroy the value.
 */
export function isSteamId64(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  if (!/^\d{17}$/.test(value)) return false;
  if (!value.startsWith(INDIVIDUAL_ACCOUNT_PREFIX)) return false;
  return value >= MIN_INDIVIDUAL_ACCOUNT_ID;
}

/**
 * Coerces a SteamID64 to its canonical string form.
 *
 * Accepts a string or a `bigint`, and throws on anything else. It does **not**
 * accept a `number`. That is the point of the `unknown` parameter: the one
 * mistake worth blocking here is a caller writing `steamId: 76561198000000000`,
 * which TypeScript would happily allow against a `number`-tolerant signature.
 * A 17-digit value exceeds `Number.MAX_SAFE_INTEGER`, so by the time it
 * arrives the low digits are already gone and it may well belong to a
 * different person. Banning the wrong player is not a recoverable failure, so
 * this throws instead of guessing.
 *
 * @throws {TypeError} when the value is a number.
 * @throws {RangeError} when the value is not an individual-account SteamID64.
 */
export function toSteamId64(value: unknown): string {
  if (typeof value === 'number') {
    throw new TypeError(
      'SteamID64 must not be passed as a number — a JS number cannot represent ' +
        'a 17-digit id exactly. Pass the string the API gave you.',
    );
  }

  if (typeof value === 'bigint') {
    const asString = value.toString();
    if (!isSteamId64(asString)) {
      throw new RangeError(`Not an individual-account SteamID64: ${asString}`);
    }
    return asString;
  }

  const trimmed = typeof value === 'string' ? value.trim() : '';
  if (!isSteamId64(trimmed)) {
    throw new RangeError(`Not an individual-account SteamID64: ${String(value)}`);
  }
  return trimmed;
}

/**
 * Derives the 32-bit account ID from a SteamID64.
 *
 * The low 32 bits of a SteamID64 are the `accountId` used by several Steam Web
 * API endpoints and by Steam's profile permalinks.
 */
export function steamId64ToAccountId(steamId64: string): number {
  if (!isSteamId64(steamId64)) {
    throw new RangeError(`Not an individual-account SteamID64: ${steamId64}`);
  }
  // The low 32 bits are well within Number's safe range, so this is exact.
  return Number(BigInt(steamId64) & 0xffffffffn);
}

/**
 * Builds a SteamID64 from a 32-bit account ID.
 *
 * @throws {RangeError} when the account id is not a 32-bit unsigned integer.
 */
export function accountIdToSteamId64(accountId: number): string {
  if (!Number.isInteger(accountId) || accountId < 0 || accountId > 0xffffffff) {
    throw new RangeError(`accountId must be a 32-bit unsigned integer, received: ${accountId}`);
  }
  // 76561197960265728 is the lowest individual-account SteamID64 — the value
  // that pairs the individual-account prefix with an account id of zero.
  return (76561197960265728n + BigInt(accountId)).toString();
}

/**
 * Turns a SteamID64 into the `STEAM_X:Y:Z` legacy format.
 *
 * Provided because server configs and third-party tools still speak it. The
 * RCON API itself only ever uses SteamID64.
 */
export function steamId64ToLegacy(steamId64: string): string {
  if (!isSteamId64(steamId64)) {
    throw new RangeError(`Not an individual-account SteamID64: ${steamId64}`);
  }
  const accountId = BigInt(steamId64ToAccountId(steamId64));
  const universe = 1n;
  const y = accountId & 1n;
  const z = accountId >> 1n;
  return `STEAM_${universe}:${y}:${z}`;
}
