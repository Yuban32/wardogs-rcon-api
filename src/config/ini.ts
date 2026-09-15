/**
 * ServerSettings.ini parsing and serialization.
 *
 * The dedicated server reads a single Unreal-style INI file. Three properties
 * of that format drive this implementation:
 *
 * 1. **Duplicate keys are meaningful.** `+RotationEntries=...` may appear many
 *    times, and each occurrence is a separate entry rather than an override.
 *    A plain `Record<string, string>` would destroy every entry but the last,
 *    so sections hold ordered arrays and `+`-prefixed names are kept verbatim.
 *
 * 2. **The server strips what it does not recognise.** Only allow-listed
 *    sections and keys survive a round trip. This parser preserves unknown
 *    content anyway — silently discarding a key client-side would hide the very
 *    information an operator needs to see when a setting "does not apply".
 *
 * 3. **Round-tripping matters.** Editing a config means sending the whole
 *    document back with `PUT /v1/config`, so anything dropped in parsing is
 *    dropped on the server.
 */

/** A `key=value` line as it appeared in the source. */
export interface IniEntry {
  /** Key exactly as written, including any `+` / `-` / `.` prefix. */
  name: string;
  /**
   * Value with surrounding quotes removed and comment text stripped from the
   * *meaning* while keeping any text a comment marker would swallow.
   */
  value: string;
  /** The value text exactly as it appeared, before any unquoting or trimming. */
  raw: string;
  /** Whether the value was quoted in the source, so it can be re-quoted. */
  quoted: boolean;
  /** 1-based source line, for reporting parse problems. */
  line: number;
}

/** An `[Section]` and its entries, in source order. */
export interface IniSection {
  /** Section name with brackets removed, e.g. `"/Script/WDRCON.WDRCONSettings"`. */
  name: string;
  /** Whether the source wrote `Export [Section]` rather than `[Section]`. */
  exported: boolean;
  entries: IniEntry[];
  /** 1-based source line of the section header. */
  line: number;
}

/** A parsed INI document. */
export interface IniDocument {
  sections: IniSection[];
  /** Lines that were not blank, comments, a section header, or an entry. */
  malformed: { line: number; text: string }[];
}

/**
 * Strips an inline comment.
 *
 * `;` and `#` start a comment only outside quotes and only after whitespace.
 * The whitespace rule is what keeps `Password=s3cret#1` intact — without it,
 * a `#` in a password would silently truncate the credential.
 */
function stripInlineComment(line: string): string {
  let inQuote: '"' | "'" | null = null;

  for (let i = 0; i < line.length; i++) {
    const char = line[i]!;

    if (inQuote !== null) {
      if (char === inQuote) inQuote = null;
      continue;
    }

    if (char === '"' || char === "'") {
      inQuote = char;
      continue;
    }

    if ((char === ';' || char === '#') && (i === 0 || /\s/.test(line[i - 1]!))) {
      return line.slice(0, i);
    }
  }

  return line;
}

/** Removes one layer of matching surrounding quotes. */
function unquote(text: string): { value: string; quoted: boolean } {
  if (text.length >= 2) {
    const first = text[0]!;
    const last = text[text.length - 1]!;
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return { value: text.slice(1, -1), quoted: true };
    }
  }
  return { value: text, quoted: false };
}

const SECTION_PATTERN = /^\s*(?:Export\s+)?\[([^\]]*)\]\s*$/i;

/**
 * Parses an INI document.
 *
 * Never throws. A line that is neither a section header nor a `key=value` pair
 * is collected in `malformed` instead of aborting the parse — one stray line
 * in a hand-edited config should not make the whole document unusable, and the
 * caller can decide whether to surface it.
 */
export function parseIni(text: string): IniDocument {
  const sections: IniSection[] = [];
  const malformed: { line: number; text: string }[] = [];

  let current: IniSection | undefined;
  const lines = text.split(/\r\n|\r|\n/);

  for (let index = 0; index < lines.length; index++) {
    const lineNumber = index + 1;
    const rawLine = lines[index]!;

    if (rawLine.trim() === '') continue;
    if (/^\s*[;#]/.test(rawLine)) continue;

    const content = stripInlineComment(rawLine);
    if (content.trim() === '') continue;

    const sectionMatch = SECTION_PATTERN.exec(content);
    if (sectionMatch !== null) {
      current = {
        name: sectionMatch[1]!.trim(),
        exported: /^\s*Export\s+\[/i.test(content),
        entries: [],
        line: lineNumber,
      };
      sections.push(current);
      continue;
    }

    const equalsAt = content.indexOf('=');
    if (equalsAt > 0) {
      const name = content.slice(0, equalsAt).trim();
      const rawValue = content.slice(equalsAt + 1).trim();
      const { value, quoted } = unquote(rawValue);
      const entry: IniEntry = { name, value, raw: rawValue, quoted, line: lineNumber };

      if (current === undefined) {
        // Entries before any section header. Unreal writes `[/Script/...]`
        // first, so this is unusual — keep them in a synthetic root section
        // rather than lose them.
        current = { name: '', exported: false, entries: [], line: lineNumber };
        sections.push(current);
      }
      current.entries.push(entry);
      continue;
    }

    malformed.push({ line: lineNumber, text: rawLine });
  }

  return { sections, malformed };
}

/**
 * Whether a value needs quoting to survive a write-then-read cycle.
 *
 * Two cases: surrounding whitespace (trimmed on re-read), and a comment marker
 * preceded by whitespace (everything after it would be dropped on re-read).
 * The second is the one that silently corrupts a round trip, so it is the
 * reason this function exists rather than a blanket quote-everything rule.
 *
 * An empty value is deliberately excluded: `key=` is the reference template's
 * own spelling for "set to empty", which is distinct from the key being
 * absent.
 */
function needsQuoting(value: string): boolean {
  if (value === '') return false;
  if (/^\s|\s$/.test(value)) return true;
  return /\s[;#]/.test(value);
}

/**
 * Formats a value for output.
 *
 * Quoting is decided from the value alone, never from whether the source wrote
 * quotes: an empty value comes back as `key=` (the reference template's own
 * spelling, and equivalent to `key=""`), and a value that parses identically
 * either way is emitted unquoted so an untouched document comes back as it
 * went in.
 */
function formatValue(value: string, quoted: boolean): string {
  if (value === '') return '';
  if (quoted || needsQuoting(value)) {
    return `"${value.replace(/"/g, '')}"`;
  }
  return value;
}

/**
 * Serializes a document back to text.
 *
 * Produces `key=value` with no spaces around `=`, which is what the reference
 * template uses. A value that was quoted is re-quoted, and an unquoted one is
 * quoted only when a re-read would otherwise change it (see
 * {@link needsQuoting}) — so an untouched document comes back byte-identical
 * rather than sprouting quotes on every line.
 *
 * Comments and blank lines are not retained. The output re-parses to an
 * equivalent document, which is the property `PUT /v1/config` actually needs.
 */
export function stringifyIni(document: IniDocument): string {
  const out: string[] = [];

  for (const section of document.sections) {
    if (out.length > 0) out.push('');
    if (section.name !== '') {
      out.push(section.exported ? `Export [${section.name}]` : `[${section.name}]`);
    }
    for (const entry of section.entries) {
      out.push(`${entry.name}=${formatValue(entry.value, entry.quoted)}`);
    }
  }

  return out.join('\n');
}
