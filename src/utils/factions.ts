/**
 * Faction resolution.
 *
 * `GET /v1/players` gives each player a `faction` string. `GET /v1/status`
 * gives `factionScores`, one row per faction, each with a `name` and a
 * `colorHex`. The reference is explicit that the *colour* is the stable key
 * across servers.
 *
 * What it does not promise is that a `factionScores[].name` is byte-identical
 * to the `faction` string on a player. It usually is, and these helpers use
 * that join because it needs no extra request — but they degrade honestly when
 * it fails. A player whose faction matches no row comes back with the colour
 * left `undefined` rather than being dropped or assigned a wrong colour, and
 * {@link groupPlayersByFaction} still buckets them so a roster stays complete.
 */

import type { FactionScore, Player, Status } from '../core/types.js';

/** A faction row from `factionScores`. */
export type FactionInfo = FactionScore;

/** Faction lookup, as built by {@link buildFactionIndex}. */
export interface FactionIndex {
  /** Resolves a player's faction string to its score row, if the names agree. */
  byName(factionName: string): FactionInfo | undefined;
  /** Resolves a colour to its score row. Case-insensitive. */
  byColor(colorHex: string): FactionInfo | undefined;
  /** Every faction row, in the order the server listed them. */
  all(): FactionInfo[];
}

/** Colour comparison is case-insensitive; servers are not consistent about it. */
function colorKey(colorHex: string): string {
  return colorHex.trim().toLowerCase();
}

function nameKey(name: string): string {
  return name.trim().toLowerCase();
}

/**
 * Builds a lookup over a `Status` payload's faction rows.
 *
 * Matching is case- and whitespace-insensitive, because a faction named
 * `"NATO"` in the score table and `"nato"` on a player is the same faction and
 * treating it as two would silently split a team in half.
 */
export function buildFactionIndex(status: Pick<Status, 'factionScores'>): FactionIndex {
  const byColorMap = new Map<string, FactionInfo>();
  const byNameMap = new Map<string, FactionInfo>();

  for (const score of status.factionScores) {
    byColorMap.set(colorKey(score.colorHex), score);
    byNameMap.set(nameKey(score.name), score);
  }

  return {
    byName: (factionName) => byNameMap.get(nameKey(factionName)),
    byColor: (colorHex) => byColorMap.get(colorKey(colorHex)),
    all: () => Array.from(byNameMap.values()),
  };
}

/** Builds an index straight from a `factionScores` array. */
export function buildFactionIndexFromScores(scores: readonly FactionScore[]): FactionIndex {
  return buildFactionIndex({ factionScores: [...scores] });
}

/** A player with its faction colour resolved. */
export interface ResolvedPlayer extends Player {
  /**
   * Colour of the player's faction. `undefined` when the server exposed no
   * score row whose name matches the player's `faction` string.
   */
  factionColorHex?: string;
}

/** Accepts either a prepared index, or the raw material to build one. */
export type FactionSource = FactionIndex | readonly FactionScore[] | Pick<Status, 'factionScores'>;

function toIndex(source: FactionSource): FactionIndex {
  if (typeof (source as FactionIndex).byName === 'function') {
    return source as FactionIndex;
  }
  if (Array.isArray(source)) {
    return buildFactionIndexFromScores(source as readonly FactionScore[]);
  }
  return buildFactionIndex(source as Pick<Status, 'factionScores'>);
}

/**
 * Attaches `factionColorHex` to each player.
 *
 * Players whose faction matches no row are returned with the colour omitted —
 * not dropped, and not assigned a neighbouring faction's colour. Losing a
 * player from a roster, or showing one in the wrong team's colour, are both
 * worse than rendering a neutral swatch.
 */
export function resolvePlayerFactions(
  players: readonly Player[],
  source: FactionSource,
): ResolvedPlayer[] {
  const index = toIndex(source);

  return players.map((player) => {
    const info = index.byName(player.faction);
    return info === undefined ? { ...player } : { ...player, factionColorHex: info.colorHex };
  });
}

/**
 * Groups players by faction colour.
 *
 * Keyed by `colorHex` where one was resolved. Players without a match land
 * under their raw faction string instead, so the grouping is complete and the
 * key itself shows what needs reconciling.
 */
export function groupPlayersByFaction(
  players: readonly Player[],
  source: FactionSource,
): Map<string, ResolvedPlayer[]> {
  const index = toIndex(source);
  const grouped = new Map<string, ResolvedPlayer[]>();

  for (const player of resolvePlayerFactions(players, index)) {
    const key = player.factionColorHex ?? player.faction;
    const bucket = grouped.get(key);
    if (bucket === undefined) {
      grouped.set(key, [player]);
    } else {
      bucket.push(player);
    }
  }

  return grouped;
}

/**
 * Whether two players share a faction, compared by colour where possible.
 *
 * Falls back to comparing the raw names when neither player's faction matched
 * a score row.
 */
export function isSameFaction(a: Player, b: Player, source: FactionSource): boolean {
  const index = toIndex(source);
  const colorA = index.byName(a.faction)?.colorHex;
  const colorB = index.byName(b.faction)?.colorHex;
  if (colorA === undefined || colorB === undefined) {
    return nameKey(a.faction) === nameKey(b.faction);
  }
  return colorKey(colorA) === colorKey(colorB);
}
