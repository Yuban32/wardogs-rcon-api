/**
 * An ergonomic, immutable view over a `ServerSettings.ini` document.
 *
 * Wraps {@link parseIni} with the operations an operator actually performs:
 * read a key, change one, read or replace the list-valued entries (rotation
 * rows, banned ids, reserved ids), and send the result back.
 *
 * Two deliberate choices:
 *
 * - **Case-insensitive lookup, verbatim output.** Unreal's INI reader ignores
 *   case, and the template writes `bEnabled`, not `benabled`. Lookups lower-case
 *   both sides, but serialization emits whatever the source wrote, so a round
 *   trip does not rewrite every key in the file.
 *
 * - **Edits return a new document.** Nothing mutates in place, so you can hold
 *   the original you fetched alongside the edit you are about to send — which
 *   is exactly what `If-Match` optimistic concurrency asks of you.
 */

import type { MapSelection } from '../core/types.js';
import { parseIni, stringifyIni, type IniDocument, type IniEntry, type IniSection } from './ini.js';
import {
  parseRotationEntries,
  serializeRotationEntryValue,
  type RotationEntryFields,
} from './rotation.js';

/** Section holding reserved slots, banned ids and the sponsor banner. */
export const SESSION_SECTION = '/Script/WDGame.WDGameSession';
/** Section holding the map rotation. */
export const ROTATION_SECTION = '/Script/WDGame.WDServerMapRotationSettings';
/** Section holding the RCON listener settings. */
export const RCON_SECTION = '/Script/WDRCON.WDRCONSettings';

const ROTATION_KEY = 'RotationEntries';
const BANNED_KEY = 'DefaultBannedPlayerIds';
const RESERVED_KEY = 'DefaultReservedPlayerIds';

function normalizeKey(key: string): string {
  return key
    .trim()
    .replace(/^[+\-.]/, '')
    .toLowerCase();
}

function normalizeSection(name: string): string {
  return name.trim().toLowerCase();
}

/**
 * Builds a synthesized entry.
 *
 * `raw` mirrors `value` because these entries were never read from a file, so
 * there is no original spelling to preserve. `line: 0` marks them as generated
 * rather than source-derived.
 */
function makeEntry(name: string, value: string): IniEntry {
  return { name, value, raw: value, quoted: false, line: 0 };
}

/** An immutable config document. */
export class WardogsConfigDocument {
  readonly raw: IniDocument;
  readonly malformed: readonly { line: number; text: string }[];

  constructor(raw: IniDocument) {
    this.raw = raw;
    this.malformed = raw.malformed;
  }

  /** Parses `text` into a document. */
  static parse(text: string): WardogsConfigDocument {
    return new WardogsConfigDocument(parseIni(text));
  }

  /** Every section name present in the document. */
  sectionNames(): string[] {
    return this.raw.sections.map((section) => section.name);
  }

  /** The entries of a section, or `[]` when it is absent. */
  section(name: string): IniEntry[] {
    const target = normalizeSection(name);
    const found = this.raw.sections.find((section) => normalizeSection(section.name) === target);
    return found?.entries ?? [];
  }

  /**
   * The first value for a key.
   *
   * An exact key match wins over a prefix-insensitive one, so `get(section,
   * "RotationEntries")` reads the bare key if the file has both it and
   * `+RotationEntries`.
   */
  get(section: string, key: string): string | undefined {
    return this.findAll(section, key)[0]?.value;
  }

  /** Whether a key is present, even if its value is empty. */
  has(section: string, key: string): boolean {
    return this.findAll(section, key).length > 0;
  }

  /** Every value for a key, in file order. Empty when the key is absent. */
  getAll(section: string, key: string): string[] {
    return this.findAll(section, key).map((entry) => entry.value);
  }

  private findAll(section: string, key: string): IniEntry[] {
    const entries = this.section(section);
    const target = normalizeKey(key);

    const exact = entries.filter((entry) => entry.name === key);
    if (exact.length > 0) return exact;

    return entries.filter((entry) => normalizeKey(entry.name) === target);
  }

  /** Reads a numeric key, returning `undefined` when absent or unparseable. */
  getNumber(section: string, key: string): number | undefined {
    const raw = this.get(section, key);
    if (raw === undefined) return undefined;
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : undefined;
  }

  /** Reads a boolean key, accepting `true`/`false` in any case. */
  getBoolean(section: string, key: string): boolean | undefined {
    const raw = this.get(section, key)?.trim().toLowerCase();
    if (raw === 'true') return true;
    if (raw === 'false') return false;
    return undefined;
  }

  /* ---------------------------------------------------------------------- */
  /* Editing                                                                 */
  /* ---------------------------------------------------------------------- */

  /**
   * Sets a key to a single value, replacing **every** occurrence of it.
   *
   * Replacing all occurrences rather than the first is the safe reading: for
   * the scalar keys this is used on, two occurrences would be a corrupt file,
   * and leaving the stale one behind would silently win on some Unreal
   * versions.
   */
  set(section: string, key: string, value: string | number | boolean): WardogsConfigDocument {
    const text = typeof value === 'string' ? value : String(value);
    const target = normalizeKey(key);
    const next = this.cloneSections();

    const targetSection = this.ensureSection(next, section);
    const filtered = targetSection.entries.filter((entry) => normalizeKey(entry.name) !== target);

    filtered.push(makeEntry(key, text));
    targetSection.entries = filtered;

    return this.replaceSections(next);
  }

  /** Removes every occurrence of a key. A no-op when it is already absent. */
  remove(section: string, key: string): WardogsConfigDocument {
    const target = normalizeKey(key);
    const next = this.cloneSections();

    const targetSection = next.find(
      (candidate) => normalizeSection(candidate.name) === normalizeSection(section),
    );
    if (targetSection === undefined) return this;

    targetSection.entries = targetSection.entries.filter(
      (entry) => normalizeKey(entry.name) !== target,
    );

    return this.replaceSections(next);
  }

  /**
   * Replaces every occurrence of a repeated key with a fresh list.
   *
   * Writes `+Key=` per value, matching how the server itself emits list keys.
   * Use this for `DefaultBannedPlayerIds`, `DefaultReservedPlayerIds` and
   * `RotationEntries`; {@link set} would be wrong for them, since it collapses
   * the list to one line.
   */
  setList(section: string, key: string, values: readonly string[]): WardogsConfigDocument {
    const bare = key.trim().replace(/^[+\-.]/, '');
    const target = normalizeKey(bare);
    const next = this.cloneSections();

    const targetSection = this.ensureSection(next, section);
    targetSection.entries = targetSection.entries.filter(
      (entry) => normalizeKey(entry.name) !== target,
    );

    for (const value of values) {
      targetSection.entries.push(makeEntry(`+${bare}`, value));
    }

    return this.replaceSections(next);
  }

  /** Appends one value to a repeated key, keeping existing entries. */
  appendToList(section: string, key: string, value: string): WardogsConfigDocument {
    const next = this.cloneSections();
    const targetSection = this.ensureSection(next, section);
    const bare = key.trim().replace(/^[+\-.]/, '');

    targetSection.entries.push(makeEntry(`+${bare}`, value));
    return this.replaceSections(next);
  }

  /**
   * Drops every section that is not in `keep`.
   *
   * The reference is explicit that the server honours only allow-listed
   * sections and keys. This is available for callers who want to send a
   * minimal document; it is **not** applied automatically, because discarding
   * an unrecognised section client-side would turn a visible warning into a
   * silent no-op.
   */
  keepSections(keep: readonly string[]): WardogsConfigDocument {
    const allowed = new Set(keep.map(normalizeSection));
    const sections = this.cloneSections().filter((section) =>
      allowed.has(normalizeSection(section.name)),
    );
    return this.replaceSections(sections);
  }

  /* ---------------------------------------------------------------------- */
  /* Rotation                                                                */
  /* ---------------------------------------------------------------------- */

  /** Rotation entries parsed from the document, in file order. */
  rotationEntries(): RotationEntryFields[] {
    return parseRotationEntries(this.text);
  }

  /**
   * Replaces the rotation with `entries`.
   *
   * Entries are written with the `+` prefix the reference template and the
   * server's own writer both use.
   */
  setRotationEntries(
    entries: readonly (MapSelection | RotationEntryFields)[],
  ): WardogsConfigDocument {
    const values = entries.map((entry) =>
      serializeRotationEntryValue(
        {
          map: entry.map,
          experiences: entry.experiences ?? [],
          ...(entry.lighting !== undefined ? { lighting: entry.lighting } : {}),
          ...('zoneAlternator' in entry && entry.zoneAlternator !== undefined
            ? { zoneAlternator: entry.zoneAlternator }
            : {}),
        },
        { plusPrefix: true },
      ),
    );

    return this.setList(ROTATION_SECTION, ROTATION_KEY, values);
  }

  /* ---------------------------------------------------------------------- */
  /* Moderation lists                                                        */
  /* ---------------------------------------------------------------------- */

  /** SteamIDs from `+DefaultBannedPlayerIds`. */
  bannedPlayerIds(): string[] {
    return this.getAll(SESSION_SECTION, BANNED_KEY);
  }

  /** Replaces `+DefaultBannedPlayerIds`. */
  setBannedPlayerIds(steamIds: readonly string[]): WardogsConfigDocument {
    return this.setList(SESSION_SECTION, BANNED_KEY, steamIds);
  }

  /** SteamIDs from `+DefaultReservedPlayerIds`. */
  reservedPlayerIds(): string[] {
    return this.getAll(SESSION_SECTION, RESERVED_KEY);
  }

  /** Replaces `+DefaultReservedPlayerIds`. */
  setReservedPlayerIds(steamIds: readonly string[]): WardogsConfigDocument {
    return this.setList(SESSION_SECTION, RESERVED_KEY, steamIds);
  }

  /* ---------------------------------------------------------------------- */
  /* Output                                                                  */
  /* ---------------------------------------------------------------------- */

  /** Serializes back to INI text, ready for `PUT /v1/config`. */
  get text(): string {
    return stringifyIni(this.raw);
  }

  /** Alias for {@link text}, so a document can be passed where text is expected. */
  toString(): string {
    return this.text;
  }

  /* ---------------------------------------------------------------------- */
  /* Internals                                                               */
  /* ---------------------------------------------------------------------- */

  private cloneSections(): IniSection[] {
    return this.raw.sections.map((section) => ({
      ...section,
      entries: section.entries.map((entry) => ({ ...entry })),
    }));
  }

  private ensureSection(sections: IniSection[], name: string): IniSection {
    const target = normalizeSection(name);
    const found = sections.find((section) => normalizeSection(section.name) === target);
    if (found !== undefined) return found;

    const created: IniSection = {
      name,
      exported: false,
      entries: [],
      line: 0,
    };
    sections.push(created);
    return created;
  }

  private replaceSections(sections: IniSection[]): WardogsConfigDocument {
    return new WardogsConfigDocument({
      sections,
      malformed: this.raw.malformed,
    });
  }
}

/** Parses `text` into a {@link WardogsConfigDocument}. */
export function createConfigDocument(text: string): WardogsConfigDocument {
  return WardogsConfigDocument.parse(text);
}
