/**
 * ServerSettings.ini parsing, serialization and editing.
 *
 * The document is sent back whole to `PUT /v1/config`, so anything the parser
 * drops is effectively deleted on the server. Round-tripping is the property
 * most of these tests exist to protect.
 */

import { describe, expect, it } from 'vitest';

import {
  createConfigDocument,
  parseIni,
  parseRotationEntries,
  parseRotationEntryValue,
  serializeRotationEntryValue,
  stringifyIni,
  WardogsConfigDocument,
} from '../src/index.js';

/** The reference's own starter template, abridged. */
const TEMPLATE = `[/Script/WDRCON.WDRCONSettings]
bEnabled=true
BindAddress=127.0.0.1
Port=7776
Password=
PasswordHash=""

[/Script/WDGame.WDGameSession]
ServerName=My Server
ServerPassword=
MaxReservedSlots=20
+DefaultReservedPlayerIds="76561198000000002"
+DefaultBannedPlayerIds="76561198000000009"

[/Script/WDGame.WDServerMapRotationSettings]
bEnabled=true
RotationMode=Ordered
+RotationEntries=(Map="Kavkazi",Experience="Bakurani_KOTH_01",Lighting="DayClear",ZoneAlternator="ZoneAlternator.Factory.Circle")
+RotationEntries=(Map="Europe",Experiences="Madrid_KOTH_01+KOTH_InfantryOnly",Lighting="DayLateGray")
`;

/* -------------------------------------------------------------------------- */
/* Parsing                                                                     */
/* -------------------------------------------------------------------------- */

describe('parseIni', () => {
  it('reads sections and entries in order', () => {
    const doc = parseIni(TEMPLATE);
    expect(doc.sections.map((s) => s.name)).toEqual([
      '/Script/WDRCON.WDRCONSettings',
      '/Script/WDGame.WDGameSession',
      '/Script/WDGame.WDServerMapRotationSettings',
    ]);
    expect(doc.sections[0]?.entries.map((e) => e.name)).toEqual([
      'bEnabled',
      'BindAddress',
      'Port',
      'Password',
      'PasswordHash',
    ]);
  });

  it('preserves repeated keys as separate entries', () => {
    // `+RotationEntries=` appears twice and each is a distinct rotation entry.
    // A Record<string, string> would keep only the last and silently truncate
    // the rotation.
    const doc = parseIni(TEMPLATE);
    const rotation = doc.sections[2]?.entries.filter((e) => e.name === '+RotationEntries');
    expect(rotation).toHaveLength(2);
  });

  it('strips surrounding quotes from values, remembering they were quoted', () => {
    const doc = parseIni(TEMPLATE);
    const reserved = doc.sections[1]?.entries.find((e) => e.name === '+DefaultReservedPlayerIds');
    expect(reserved?.value).toBe('76561198000000002');
    expect(reserved?.quoted).toBe(true);
  });

  it('keeps an empty value as an empty string, not as missing', () => {
    // `Password=` with nothing after it is a meaningful, deliberate setting.
    const doc = parseIni(TEMPLATE);
    const password = doc.sections[0]?.entries.find((e) => e.name === 'Password');
    expect(password?.value).toBe('');
    expect(password?.quoted).toBe(false);
  });

  it('ignores full-line comments', () => {
    const doc = parseIni('; a comment\n# another\n[A]\nx=1');
    expect(doc.sections).toHaveLength(1);
    expect(doc.sections[0]?.entries).toHaveLength(1);
  });

  it('ignores blank lines and CRLF endings', () => {
    const doc = parseIni('[A]\r\n\r\nx=1\r\n\r\ny=2\r\n');
    expect(doc.sections[0]?.entries.map((e) => e.name)).toEqual(['x', 'y']);
  });

  it('strips a trailing comment that follows whitespace', () => {
    const doc = parseIni('[A]\nx=1 ; the answer');
    expect(doc.sections[0]?.entries[0]?.value).toBe('1');
  });

  it('does NOT strip a # that is part of the value', () => {
    // The whitespace rule is what keeps a password containing a hash intact.
    // Stripping it here would silently truncate the credential.
    const doc = parseIni('[A]\nPassword=s3cret#1');
    expect(doc.sections[0]?.entries[0]?.value).toBe('s3cret#1');
  });

  it('does not treat a comment marker inside quotes as a comment', () => {
    const doc = parseIni('[A]\nServerName="My ; Server"');
    expect(doc.sections[0]?.entries[0]?.value).toBe('My ; Server');
  });

  it('records the source line of each entry', () => {
    const doc = parseIni('[A]\nx=1\ny=2');
    expect(doc.sections[0]?.entries[0]?.line).toBe(2);
    expect(doc.sections[0]?.entries[1]?.line).toBe(3);
  });

  it('accepts the Export form of a section header', () => {
    const doc = parseIni('Export [/Script/Foo]\nx=1');
    expect(doc.sections[0]?.name).toBe('/Script/Foo');
    expect(doc.sections[0]?.exported).toBe(true);
  });

  it('collects unparseable lines instead of throwing', () => {
    // One stray line in a hand-edited config must not make the whole document
    // unusable — the caller decides what to do about it.
    const doc = parseIni('[A]\nx=1\nthis is not valid\ny=2');
    expect(doc.malformed).toEqual([{ line: 3, text: 'this is not valid' }]);
    expect(doc.sections[0]?.entries.map((e) => e.name)).toEqual(['x', 'y']);
  });

  it('keeps entries that appear before any section header', () => {
    const doc = parseIni('orphan=1\n[A]\nx=2');
    expect(doc.sections[0]?.name).toBe('');
    expect(doc.sections[0]?.entries[0]?.name).toBe('orphan');
  });

  it('handles a value containing an equals sign', () => {
    const doc = parseIni('[A]\nx=a=b=c');
    expect(doc.sections[0]?.entries[0]?.value).toBe('a=b=c');
  });
});

/* -------------------------------------------------------------------------- */
/* Serialization                                                               */
/* -------------------------------------------------------------------------- */

describe('stringifyIni', () => {
  it('round-trips a document to a semantically equivalent one', () => {
    const first = parseIni(TEMPLATE);
    const second = parseIni(stringifyIni(first));

    expect(second.sections.map((s) => s.name)).toEqual(first.sections.map((s) => s.name));
    for (let i = 0; i < first.sections.length; i++) {
      // Names and values are the contract — that is what the server reads.
      // `raw` and `quoted` record how the source happened to spell a value, and
      // are deliberately not preserved: `x=""` and `x=` mean the same thing, and
      // re-emiting whichever the source chose would make the output a function
      // of formatting rather than of content.
      const before = first.sections[i]?.entries.map((e) => [e.name, e.value]);
      const after = second.sections[i]?.entries.map((e) => [e.name, e.value]);
      expect(after).toEqual(before);
    }
  });

  it('collapses an empty value to the unquoted spelling', () => {
    expect(parseIni(stringifyIni(parseIni('[A]\nx=""'))).sections[0]?.entries[0]).toMatchObject({
      name: 'x',
      value: '',
      quoted: false,
    });
  });

  it('re-quotes a value that was quoted', () => {
    const doc = parseIni('[A]\nx="76561198000000002"');
    expect(stringifyIni(doc)).toContain('x="76561198000000002"');
  });

  it('truncates an unquoted value at a trailing comment', () => {
    // Unavoidable and correct: `[A]\nx = a ; b` is ambiguous, and standard INI
    // reads it as `a` with a comment. `stringifyIni` re-quotes anything that
    // would be truncated, so a value written by this library survives.
    const doc = parseIni('[A]\nx = a ; b');
    expect(doc.sections[0]?.entries[0]?.value).toBe('a');
  });

  it('preserves a quoted value containing a comment marker', () => {
    // The parser and serializer are quote-aware, so a value already quoted in
    // the source — which is how the server writes a password or a name
    // containing `;` — survives a full round trip.
    const original = '[A]\nx="a ; b"';
    const doc = parseIni(original);
    expect(doc.sections[0]?.entries[0]?.value).toBe('a ; b');

    const text = stringifyIni(doc);
    expect(text).toContain('x="a ; b"');
    expect(parseIni(text).sections[0]?.entries[0]?.value).toBe('a ; b');
  });

  it('re-quotes a synthesized value that would otherwise be truncated', () => {
    const doc = createConfigDocument('[A]').set('A', 'x', 'a ; b');
    expect(stringifyIni(doc.raw)).toContain('x="a ; b"');
    expect(parseIni(stringifyIni(doc.raw)).sections[0]?.entries[0]?.value).toBe('a ; b');
  });

  it('does not quote an ordinary value', () => {
    expect(stringifyIni(parseIni('[A]\nx=DayClear'))).toBe('[A]\nx=DayClear');
  });

  it('writes an empty value without quotes', () => {
    // `Password=` is the reference template's own spelling for "set to empty",
    // which is different from the key being absent.
    expect(stringifyIni(parseIni('[A]\nx='))).toBe('[A]\nx=');
    expect(stringifyIni(parseIni('[A]\nx=""'))).toBe('[A]\nx=');
  });

  it('omits the header for a synthetic root section', () => {
    const text = stringifyIni(parseIni('orphan=1\n[A]\nx=2'));
    expect(text).not.toContain('[]');
    expect(text).toContain('orphan=1');
  });

  it('preserves the Export keyword', () => {
    expect(stringifyIni(parseIni('Export [A]\nx=1'))).toContain('Export [A]');
  });
});

/* -------------------------------------------------------------------------- */
/* Config document                                                             */
/* -------------------------------------------------------------------------- */

describe('WardogsConfigDocument', () => {
  it('reads a key case-insensitively, matching Unreal', () => {
    const doc = createConfigDocument(TEMPLATE);
    expect(doc.get('/Script/WDRCON.WDRCONSettings', 'bEnabled')).toBe('true');
    expect(doc.get('/Script/WDRCON.WDRCONSettings', 'benabled')).toBe('true');
    expect(doc.get('/script/wdrcon.wdrconsettings', 'BENABLED')).toBe('true');
  });

  it('reads section names case-insensitively', () => {
    const doc = createConfigDocument(TEMPLATE);
    expect(doc.get('[/SCRIPT/WDRCON.WDRCONSETTINGS]'.slice(1, -1), 'Port')).toBe('7776');
  });

  it('returns undefined for a missing key or section', () => {
    const doc = createConfigDocument(TEMPLATE);
    expect(doc.get('/Script/WDRCON.WDRCONSettings', 'nope')).toBeUndefined();
    expect(doc.get('/No/Such/Section', 'x')).toBeUndefined();
  });

  it('reads typed values', () => {
    const doc = createConfigDocument(TEMPLATE);
    expect(doc.getNumber('/Script/WDRCON.WDRCONSettings', 'Port')).toBe(7776);
    expect(doc.getBoolean('/Script/WDRCON.WDRCONSettings', 'bEnabled')).toBe(true);
    expect(doc.getNumber('/Script/WDRCON.WDRCONSettings', 'nope')).toBeUndefined();
  });

  it('lists section names', () => {
    expect(createConfigDocument(TEMPLATE).sectionNames()).toHaveLength(3);
  });

  it('preserves unknown sections rather than stripping them', () => {
    // The server strips what it does not recognise, but discarding it here
    // would hide the very thing an operator needs to see when a setting
    // silently does not apply.
    const doc = createConfigDocument('[Custom.Section]\nFoo=bar\n[A]\nx=1');
    expect(doc.sectionNames()).toContain('Custom.Section');
    expect(doc.get('Custom.Section', 'Foo')).toBe('bar');
  });

  it('surfaces malformed lines', () => {
    const doc = createConfigDocument('[A]\nx=1\ngarbage');
    expect(doc.malformed).toHaveLength(1);
  });

  it('exposes the source text unchanged', () => {
    expect(createConfigDocument(TEMPLATE).text).toBe(stringifyIni(parseIni(TEMPLATE)));
  });
});

describe('editing', () => {
  it('sets a scalar key, replacing every occurrence', () => {
    const doc = createConfigDocument('[A]\nx=1\nx=2\ny=3').set('A', 'x', '9');
    expect(doc.getAll('A', 'x')).toEqual(['9']);
    expect(doc.get('A', 'y')).toBe('3');
  });

  it('creates the section when it does not exist', () => {
    const doc = createConfigDocument('[A]\nx=1').set('New.Section', 'key', 'value');
    expect(doc.get('New.Section', 'key')).toBe('value');
    expect(doc.get('A', 'x')).toBe('1');
  });

  it('finds an existing section regardless of case when setting', () => {
    const doc = createConfigDocument('[/Script/WDRCON.WDRCONSettings]\nbEnabled=true').set(
      '/script/wdrcon.wdrconsettings',
      'Port',
      7777,
    );

    expect(doc.sectionNames()).toHaveLength(1);
    expect(doc.getNumber('/Script/WDRCON.WDRCONSettings', 'Port')).toBe(7777);
  });

  it('serializes numbers and booleans as strings', () => {
    const doc = createConfigDocument('[A]').set('A', 'n', 24).set('A', 'b', true);
    expect(doc.get('A', 'n')).toBe('24');
    expect(doc.get('A', 'b')).toBe('true');
  });

  it('does not mutate the original document', () => {
    // Holding the original you fetched alongside the edit you are about to
    // send is exactly what If-Match concurrency asks of you.
    const original = createConfigDocument('[A]\nx=1');
    const edited = original.set('A', 'x', '2');

    expect(original.get('A', 'x')).toBe('1');
    expect(edited.get('A', 'x')).toBe('2');
  });

  it('removes a key and every duplicate of it', () => {
    const doc = createConfigDocument('[A]\n+list=1\n+list=2\nkeep=3').remove('A', 'list');
    expect(doc.getAll('A', 'list')).toEqual([]);
    expect(doc.get('A', 'keep')).toBe('3');
  });

  it('removing an absent key is a no-op', () => {
    const doc = createConfigDocument('[A]\nx=1').remove('A', 'nope').remove('B', 'x');
    expect(doc.get('A', 'x')).toBe('1');
  });

  it('replaces a repeated key with a fresh list, writing + prefixes', () => {
    const doc = createConfigDocument('[A]\n+list=old1\n+list=old2').setList('A', 'list', [
      'new1',
      'new2',
    ]);

    expect(doc.getAll('A', 'list')).toEqual(['new1', 'new2']);
    expect(doc.text).toContain('+list=new1');
    expect(doc.text).not.toContain('old1');
  });

  it('appends to a list without disturbing existing entries', () => {
    const doc = createConfigDocument('[A]\n+list=1').appendToList('A', 'list', '2');
    expect(doc.getAll('A', 'list')).toEqual(['1', '2']);
  });

  it('keepSections drops everything else', () => {
    const doc = createConfigDocument('[A]\nx=1\n[B]\ny=2\n[C]\nz=3').keepSections(['A', 'C']);
    expect(doc.sectionNames()).toEqual(['A', 'C']);
  });
});

describe('moderation lists', () => {
  it('reads banned and reserved ids', () => {
    const doc = createConfigDocument(TEMPLATE);
    expect(doc.bannedPlayerIds()).toEqual(['76561198000000009']);
    expect(doc.reservedPlayerIds()).toEqual(['76561198000000002']);
  });

  it('replaces the banned id list', () => {
    const doc = createConfigDocument(TEMPLATE).setBannedPlayerIds([
      '76561198000000009',
      '76561198000000010',
    ]);

    expect(doc.bannedPlayerIds()).toEqual(['76561198000000009', '76561198000000010']);
  });

  it('clears a list when given an empty array', () => {
    const doc = createConfigDocument(TEMPLATE).setBannedPlayerIds([]);
    expect(doc.bannedPlayerIds()).toEqual([]);
  });

  it('leaves the other list untouched', () => {
    const doc = createConfigDocument(TEMPLATE).setBannedPlayerIds([]);
    expect(doc.reservedPlayerIds()).toEqual(['76561198000000002']);
  });
});

/* -------------------------------------------------------------------------- */
/* Rotation entries                                                            */
/* -------------------------------------------------------------------------- */

describe('parseRotationEntryValue', () => {
  it('parses the singular Experience form', () => {
    const entry = parseRotationEntryValue(
      '(Map="Kavkazi",Experience="Bakurani_KOTH_01",Lighting="DayClear",ZoneAlternator="ZoneAlternator.Factory.Circle")',
    );

    expect(entry).toEqual({
      map: 'Kavkazi',
      experiences: ['Bakurani_KOTH_01'],
      lighting: 'DayClear',
      zoneAlternator: 'ZoneAlternator.Factory.Circle',
      plusPrefixed: false,
    });
  });

  it('parses the plural Experiences + form', () => {
    const entry = parseRotationEntryValue(
      '(Map="Europe",Experiences="Madrid_KOTH_01+KOTH_InfantryOnly",Lighting="DayLateGray")',
    );

    expect(entry?.experiences).toEqual(['Madrid_KOTH_01', 'KOTH_InfantryOnly']);
    expect(entry?.zoneAlternator).toBeUndefined();
  });

  it('recognizes a leading +', () => {
    expect(parseRotationEntryValue('+(Map="A")')?.plusPrefixed).toBe(true);
  });

  it('returns null when there is no Map', () => {
    expect(parseRotationEntryValue('(Lighting="DayClear")')).toBeNull();
  });

  it('returns null for a value that is not an entry list', () => {
    expect(parseRotationEntryValue('garbage')).toBeNull();
  });

  it('handles a comma inside a quoted value', () => {
    const entry = parseRotationEntryValue('(Map="A,B",Lighting="Night")');
    expect(entry?.map).toBe('A,B');
    expect(entry?.lighting).toBe('Night');
  });
});

describe('serializeRotationEntryValue', () => {
  it('emits Experience= for a single experience', () => {
    const text = serializeRotationEntryValue({ map: 'Kavkazi', experiences: ['Mode'] });
    expect(text).toContain('Experience="Mode"');
    expect(text).not.toContain('Experiences=');
  });

  it('emits Experiences= joined with + for several', () => {
    const text = serializeRotationEntryValue({
      map: 'Europe',
      experiences: ['A', 'B'],
    });
    expect(text).toContain('Experiences="A+B"');
  });

  it('omits the experience key entirely when there are none', () => {
    // Omitting selects the map's authored default; an empty value would not.
    const text = serializeRotationEntryValue({ map: 'Kavkazi', experiences: [] });
    expect(text).toBe('+(Map="Kavkazi")');
  });

  it('omits ZoneAlternator when unset', () => {
    const text = serializeRotationEntryValue({ map: 'K', experiences: [], lighting: 'L' });
    expect(text).not.toContain('ZoneAlternator');
  });

  it('round-trips through the parser', () => {
    const original = '+(Map="Kavkazi",Experiences="A+B",Lighting="DayClear",ZoneAlternator="Z")';
    const parsed = parseRotationEntryValue(original);
    expect(parsed).not.toBeNull();

    const reserialized = serializeRotationEntryValue(parsed!);
    expect(parseRotationEntryValue(reserialized)).toEqual(parsed);
  });

  it('honours an explicit plusPrefix override', () => {
    const text = serializeRotationEntryValue({ map: 'K', experiences: [] }, { plusPrefix: false });
    expect(text.startsWith('(')).toBe(true);
  });
});

describe('parseRotationEntries', () => {
  it('extracts every entry from a document', () => {
    const entries = parseRotationEntries(TEMPLATE);
    expect(entries).toHaveLength(2);
    expect(entries[0]?.map).toBe('Kavkazi');
    expect(entries[1]?.experiences).toEqual(['Madrid_KOTH_01', 'KOTH_InfantryOnly']);
  });

  it('matches the key with or without a + prefix', () => {
    expect(parseRotationEntries('RotationEntries=(Map="A")')).toHaveLength(1);
    expect(parseRotationEntries('+RotationEntries=(Map="A")')).toHaveLength(1);
  });

  it('ignores commented-out entries', () => {
    expect(parseRotationEntries('; +RotationEntries=(Map="A")')).toHaveLength(0);
  });

  it('returns nothing for a document with no rotation', () => {
    expect(parseRotationEntries('[A]\nx=1')).toEqual([]);
  });
});

describe('document rotation helpers', () => {
  it('reads the entries from the document', () => {
    expect(createConfigDocument(TEMPLATE).rotationEntries()).toHaveLength(2);
  });

  it('replaces the rotation and leaves the rest of the file alone', () => {
    const doc = createConfigDocument(TEMPLATE).setRotationEntries([
      { map: 'NewMap', experiences: ['NewMode'], lighting: 'DayClear' },
    ]);

    const entries = doc.rotationEntries();
    expect(entries).toHaveLength(1);
    expect(entries[0]?.map).toBe('NewMap');
    expect(doc.get('/Script/WDGame.WDGameSession', 'MaxReservedSlots')).toBe('20');
  });

  it('accepts a MapSelection, which is what the API returns', () => {
    const doc = createConfigDocument(TEMPLATE).setRotationEntries([{ map: 'Kavkazi' }]);
    expect(doc.rotationEntries()[0]?.map).toBe('Kavkazi');
  });
});

/* -------------------------------------------------------------------------- */
/* Round-trip on a realistic document                                          */
/* -------------------------------------------------------------------------- */

describe('full round trip', () => {
  it('survives parse → edit → stringify → parse without losing content', () => {
    const edited = createConfigDocument(TEMPLATE)
      .set('/Script/WDGame.WDGameSession', 'ServerName', 'Renamed Server')
      .set('/Script/WDGame.WDGameSession', 'MaxPlayers', 64)
      .setBannedPlayerIds(['76561198000000009', '76561198000000011'])
      .setRotationEntries([{ map: 'Europe', experiences: ['A', 'B'] }]);

    const reparsed = WardogsConfigDocument.parse(edited.text);

    expect(reparsed.get('/Script/WDGame.WDGameSession', 'ServerName')).toBe('Renamed Server');
    expect(reparsed.getNumber('/Script/WDGame.WDGameSession', 'MaxPlayers')).toBe(64);
    expect(reparsed.bannedPlayerIds()).toEqual(['76561198000000009', '76561198000000011']);
    expect(reparsed.rotationEntries()).toHaveLength(1);
    expect(reparsed.rotationEntries()[0]?.experiences).toEqual(['A', 'B']);
    // Untouched sections are still there.
    expect(reparsed.get('/Script/WDRCON.WDRCONSettings', 'Port')).toBe('7776');
  });

  it('toString() matches text, so a document can be passed where a string is expected', () => {
    const doc = createConfigDocument(TEMPLATE);
    expect(String(doc)).toBe(doc.text);
  });
});
