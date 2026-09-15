/**
 * Individually-authored map rotation entries.
 *
 * The server stores each rotation entry as a single line in `ServerSettings.ini`:
 *
 * ```ini
 * +RotationEntries=(Map="Kavkazi",Experience="Bakurani_KOTH_01",Lighting="DayClear",ZoneAlternator="ZoneAlternator.Factory.Circle")
 * +RotationEntries=(Map="Europe",Experiences="Madrid_KOTH_01+KOTH_InfantryOnly",Lighting="DayLateGray")
 * ```
 *
 * Two details are easy to get wrong and are handled here:
 *
 * - **`Experience` vs `Experiences`.** The singular key holds one experience;
 *   the plural holds several joined by `+`. Emitting the wrong one for a given
 *   count produces an entry the server ignores.
 * - **`ZoneAlternator` is optional.** Omitting it selects the map's authored
 *   default, which is *not* the same as sending an empty string.
 */

/** A parsed `+RotationEntries=` value. */
export interface RotationEntryFields {
  map: string;
  /** Absent when the line carried no experience key. */
  experiences: string[];
  lighting?: string;
  zoneAlternator?: string;
  /** Whether the source line used the `+` prefix, so it can be reproduced. */
  plusPrefixed: boolean;
}

/**
 * Splits `key=value` pairs inside a parenthesised list, respecting quotes.
 *
 * A naive `split(',')` breaks on `Experiences="A+B"` only if a value contains a
 * comma — which map or alternator names may well do. This walks the string and
 * only treats a comma as a separator at quote depth zero.
 */
function splitTopLevel(input: string): string[] {
  const parts: string[] = [];
  let current = '';
  let inQuote = false;

  for (let i = 0; i < input.length; i++) {
    const char = input[i]!;
    if (char === '"') {
      inQuote = !inQuote;
      current += char;
      continue;
    }
    if (char === ',' && !inQuote) {
      parts.push(current);
      current = '';
      continue;
    }
    current += char;
  }

  parts.push(current);
  return parts;
}

/** Strips one layer of surrounding quotes. */
function unquote(text: string): string {
  const trimmed = text.trim();
  if (trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

/**
 * Parses the value side of a `RotationEntries` line.
 *
 * @param raw The value as it appears in the INI, with or without a leading `+`.
 * @returns The parsed fields, or `null` when the value is not an entry list.
 */
export function parseRotationEntryValue(raw: string): RotationEntryFields | null {
  const trimmed = raw.trim();
  const plusPrefixed = trimmed.startsWith('+');
  const body = plusPrefixed ? trimmed.slice(1).trim() : trimmed;

  const open = body.indexOf('(');
  const close = body.lastIndexOf(')');
  if (open === -1 || close === -1 || close < open) return null;

  const fields: RotationEntryFields = {
    map: '',
    experiences: [],
    plusPrefixed,
  };

  for (const pair of splitTopLevel(body.slice(open + 1, close))) {
    const equalsAt = pair.indexOf('=');
    if (equalsAt <= 0) continue;

    const key = pair.slice(0, equalsAt).trim().toLowerCase();
    const value = unquote(pair.slice(equalsAt + 1));

    switch (key) {
      case 'map':
        fields.map = value;
        break;
      case 'experience':
        if (value !== '') fields.experiences.push(value);
        break;
      case 'experiences':
        for (const item of value.split('+')) {
          const trimmedItem = item.trim();
          if (trimmedItem !== '') fields.experiences.push(trimmedItem);
        }
        break;
      case 'lighting':
        if (value !== '') fields.lighting = value;
        break;
      case 'zonealternator':
        if (value !== '') fields.zoneAlternator = value;
        break;
      default:
        break;
    }
  }

  if (fields.map === '') return null;
  return fields;
}

/**
 * Serializes rotation entry fields back to the value side of the INI line.
 *
 * Chooses `Experience=` or `Experiences=` from the number of experiences, and
 * omits `ZoneAlternator` entirely when unset rather than writing an empty one.
 *
 * @param fields A {@link RotationEntryFields}, or any object with the same
 *   shape — {@link import('../core/types.js').MapSelection} qualifies.
 * @param options.plusPrefix Prefix with `+`. Defaults to `true`, matching the
 *   reference template. Pass `false` for the `RotationEntries=` form.
 */
export function serializeRotationEntryValue(
  fields: Omit<RotationEntryFields, 'plusPrefixed'> & { plusPrefixed?: boolean },
  options: { plusPrefix?: boolean } = {},
): string {
  const parts = [`Map="${fields.map}"`];

  const experiences = fields.experiences ?? [];
  if (experiences.length === 1) {
    parts.push(`Experience="${experiences[0]!}"`);
  } else if (experiences.length > 1) {
    parts.push(`Experiences="${experiences.join('+')}"`);
  }

  if (fields.lighting !== undefined && fields.lighting !== '') {
    parts.push(`Lighting="${fields.lighting}"`);
  }
  if (fields.zoneAlternator !== undefined && fields.zoneAlternator !== '') {
    parts.push(`ZoneAlternator="${fields.zoneAlternator}"`);
  }

  const prefix = (options.plusPrefix ?? fields.plusPrefixed ?? true) ? '+' : '';
  return `${prefix}(${parts.join(',')})`;
}

/**
 * Extracts every rotation entry from a `ServerSettings.ini` document body.
 *
 * Returns entries in file order. Values are matched case-insensitively on a
 * key of `rotationentries`, with or without a leading `+` — the server treats
 * both spellings the same, and hand-edited configs use both.
 */
export function parseRotationEntries(iniText: string): RotationEntryFields[] {
  const entries: RotationEntryFields[] = [];

  for (const rawLine of iniText.split(/\r\n|\r|\n/)) {
    const line = rawLine.trim();
    if (line === '' || line.startsWith(';') || line.startsWith('#')) continue;

    const equalsAt = line.indexOf('=');
    if (equalsAt <= 0) continue;

    const key = line
      .slice(0, equalsAt)
      .trim()
      .replace(/^[+\-.]/, '')
      .toLowerCase();
    if (key !== 'rotationentries') continue;

    const parsed = parseRotationEntryValue(line.slice(equalsAt + 1));
    if (parsed !== null) entries.push(parsed);
  }

  return entries;
}
