// Unit tests for the BSB text-integrity validation core (src/server/bible-validation.js).
// Pure functions + a self-built ZIP fixture — no server, no GitHub, no network.
// Run with:  npm run test:unit
const test = require('node:test');
const assert = require('node:assert');
const zlib = require('node:zlib');
const v = require('../../src/server/bible-validation');

// ── Fixture builder: a minimal but real ZIP (deflate) we can round-trip ───────
// CRC-32 and timestamps are left zero (the reader doesn't validate them).
function makeZip(entries) {
  const parts = [];
  const central = [];
  let offset = 0;
  for (const [name, content] of Object.entries(entries)) {
    const nameBuf = Buffer.from(name, 'utf-8');
    const raw = Buffer.from(content, 'utf-8');
    const comp = zlib.deflateRawSync(raw);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);          // version needed
    local.writeUInt16LE(8, 8);           // method = deflate
    local.writeUInt32LE(comp.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    parts.push(local, nameBuf, comp);

    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(20, 4);
    cd.writeUInt16LE(20, 6);
    cd.writeUInt16LE(8, 10);             // method
    cd.writeUInt32LE(comp.length, 20);
    cd.writeUInt32LE(raw.length, 24);
    cd.writeUInt16LE(nameBuf.length, 28);
    cd.writeUInt32LE(offset, 42);        // local header offset
    central.push(cd, nameBuf);

    offset += local.length + nameBuf.length + comp.length;
  }
  const cdBuf = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(Object.keys(entries).length, 8);
  eocd.writeUInt16LE(Object.keys(entries).length, 10);
  eocd.writeUInt32LE(cdBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);        // central dir offset
  return Buffer.concat([...parts, cdBuf, eocd]);
}

// ── parseBsbTxt ───────────────────────────────────────────────────────────────
test('parseBsbTxt keeps verses and skips header/attribution rows', () => {
  const txt = [
    'The Holy Bible, Berean Standard Bible, BSB ...\t',
    'This text ... public domain ...\t',
    'Verse\tBerean Standard Bible',
    'Genesis 1:1\tIn the beginning God created the heavens and the earth.',
    '1 Samuel 3:10\tThen the LORD called Samuel.',
    'Song of Solomon 2:1\tI am a rose of Sharon.',
  ].join('\n');
  const m = v.parseBsbTxt(txt);
  assert.strictEqual(m.size, 3);
  assert.strictEqual(m.get('Genesis 1:1'), 'In the beginning God created the heavens and the earth.');
  assert.ok(m.has('1 Samuel 3:10'));
  assert.ok(m.has('Song of Solomon 2:1'));
  assert.ok(!m.has('Verse'));
});

test('parseBsbTxt preserves an intentionally empty (omitted) verse', () => {
  const m = v.parseBsbTxt('Matthew 17:21\t\nMatthew 17:22\tAs they were gathering...');
  assert.strictEqual(m.get('Matthew 17:21'), '');
  assert.strictEqual(m.size, 2);
});

// ── parseReferences ───────────────────────────────────────────────────────────
test('parseReferences drops non-verse metadata keys', () => {
  const json = JSON.stringify({
    'This text of God\'s Word has been dedicated to the public domain.': '',
    'Verse': 'Berean Standard Bible',
    'Genesis 1:1': 'In the beginning God created the heavens and the earth.',
    'Revelation 22:21': 'The grace of the Lord Jesus be with all. Amen.',
  });
  const m = v.parseReferences(json);
  assert.strictEqual(m.size, 2);
  assert.ok(m.has('Genesis 1:1'));
  assert.ok(m.has('Revelation 22:21'));
});

// ── normalizeVerse ────────────────────────────────────────────────────────────
test('normalizeVerse folds cosmetic quote/dash/space differences', () => {
  const curly = 'God said, “Let there be light,” and there was light—light.';
  const straight = 'God said, "Let there be light," and there was light-light.';
  assert.strictEqual(v.normalizeVerse(curly), v.normalizeVerse(straight));
});

test('normalizeVerse collapses NBSP, zero-width chars, and whitespace', () => {
  const messy = 'the LORD​  said\t\tso.';
  assert.strictEqual(v.normalizeVerse(messy), 'the LORD said so.');
});

test('normalizeVerse does NOT mask a real word difference', () => {
  assert.notStrictEqual(v.normalizeVerse('the heavens'), v.normalizeVerse('the heaven'));
});

// ── diffVerses ────────────────────────────────────────────────────────────────
test('diffVerses categorizes matched / mismatch / cosmetic / missing / extra', () => {
  const official = new Map([
    ['Genesis 1:1', 'In the beginning God created the heavens and the earth.'],
    ['Genesis 1:2', 'Now the earth was formless and void.'],
    ['Genesis 1:3', 'And God said, “Let there be light.”'], // curly
    ['Genesis 1:4', 'And God saw that the light was good.'],           // missing in ours
  ]);
  const ours = new Map([
    ['Genesis 1:1', 'In the beginning God created the heavens and the earth.'], // exact
    ['Genesis 1:2', 'Now the earth was formless and empty.'],                   // real diff
    ['Genesis 1:3', 'And God said, "Let there be light."'],                     // cosmetic
    ['Genesis 1:99', 'Bogus extra verse.'],                                     // extra
  ]);
  const r = v.diffVerses(ours, official);
  assert.strictEqual(r.totals.matched, 1, 'one exact match');
  assert.strictEqual(r.totals.textMismatch, 1);
  assert.strictEqual(r.totals.cosmeticOnly, 1);
  assert.strictEqual(r.totals.missingInOurs, 1);
  assert.strictEqual(r.totals.extraInOurs, 1);
  assert.strictEqual(r.textMismatch[0].ref, 'Genesis 1:2');
  assert.strictEqual(r.missingInOurs[0].ref, 'Genesis 1:4');
  assert.strictEqual(r.extraInOurs[0].ref, 'Genesis 1:99');
  assert.ok(r.textMismatch[0].divergence.index > 0);
});

test('diffVerses on identical maps reports a clean pass', () => {
  const a = new Map([['John 3:16', 'For God so loved the world.']]);
  const b = new Map([['John 3:16', 'For God so loved the world.']]);
  const r = v.diffVerses(a, b);
  assert.strictEqual(r.totals.textMismatch, 0);
  assert.strictEqual(r.totals.missingInOurs, 0);
  assert.strictEqual(r.totals.extraInOurs, 0);
  assert.strictEqual(r.totals.matched, 1);
});

// ── parseZip ──────────────────────────────────────────────────────────────────
test('parseZip round-trips deflated entries and skips directories', () => {
  const zip = makeZip({
    '01GENBSB.SFM': '\\id GEN\n\\c 1\n\\v 1 In the beginning...',
    '67REVBSB.SFM': '\\id REV\n\\c 22\n\\v 21 The grace of the Lord Jesus...',
  });
  const m = v.parseZip(zip);
  assert.strictEqual(m.size, 2);
  assert.match(m.get('01GENBSB.SFM'), /In the beginning/);
  assert.match(m.get('67REVBSB.SFM'), /The grace of the Lord Jesus/);
});

// ── bookCode ──────────────────────────────────────────────────────────────────
test('bookCode canonicalizes both our and official filename styles', () => {
  assert.strictEqual(v.bookCode('01GENBSB.SFM'), 'GEN');
  assert.strictEqual(v.bookCode('091SABSB.SFM'), '1SA');   // 2-digit index stripped, book number kept
  assert.strictEqual(v.bookCode('67REVBSB.SFM'), 'REV');
  assert.strictEqual(v.bookCode('bsb_usfm/GEN.usfm'), 'GEN');
  assert.strictEqual(v.bookCode('bsb_usfm/1CH.usfm'), '1CH'); // single leading digit preserved
});

// ── extractHeadings / extractFootnotes ────────────────────────────────────────
test('extractHeadings pulls \\s1/\\s2 heading text and strips inline markers', () => {
  const usfm = [
    '\\c 1',
    '\\s1 The Creation',
    '\\v 1 In the beginning...',
    '\\s2 The \\nd First\\nd* Day',
    '\\v 3 And God said...',
  ].join('\n');
  const h = v.extractHeadings(usfm);
  assert.deepStrictEqual(h, ['The Creation', 'The First Day']);
});

test('extractFootnotes pulls note prose and drops caller + \\fr + submarkers', () => {
  const usfm = '\\v 3 And God said, "Let there be light," \\f + \\fr 1:3 \\ft Cited in 2 Corinthians 4:6\\f* and there was light.';
  const f = v.extractFootnotes(usfm);
  assert.deepStrictEqual(f, ['Cited in 2 Corinthians 4:6']);
});

test('extractFootnotes handles multiple footnotes across a book', () => {
  const usfm = [
    '\\v 5 ...the first day.\\f + \\fr 1:5 \\ft Literally day one\\f*',
    '\\v 6 ...\\f + \\fr 1:6 \\ft Or a canopy\\f*',
  ].join('\n');
  assert.deepStrictEqual(v.extractFootnotes(usfm), ['Literally day one', 'Or a canopy']);
});

// ── diffStructure ─────────────────────────────────────────────────────────────
test('diffStructure compares headings + footnotes across naming styles', () => {
  const ours = new Map([
    ['01GENBSB.SFM', '\\s1 The Creation\n\\v 1 x\\f + \\fr 1:1 \\ft Note A\\f*'],
    ['99EXTRABSB.SFM', '\\v 1 not a real book'],
  ]);
  const official = new Map([
    // Genesis: heading reworded + footnote changed → both flagged
    ['bsb_usfm/GEN.usfm', '\\s1 The Creation Account\n\\v 1 x\\f + \\fr 1:1 \\ft Note B\\f*'],
    ['bsb_usfm/EXO.usfm', '\\v 1 exodus'],
  ]);
  const r = v.diffStructure(ours, official);
  assert.strictEqual(r.totals.booksChecked, 2);
  assert.strictEqual(r.totals.missingBooks, 1);          // Exodus absent from ours
  assert.strictEqual(r.totals.extraBooks, 1);            // our bogus extra book
  assert.strictEqual(r.totals.booksWithHeadingDiffs, 1);
  assert.strictEqual(r.totals.booksWithFootnoteDiffs, 1);
  const gen = r.books.find(b => b.book.includes('GEN'));
  assert.match(gen.headings.onlyInOfficial[0], /Creation Account/);
  assert.deepStrictEqual(gen.footnotes.onlyInOurs, ['Note A']);
  assert.deepStrictEqual(gen.footnotes.onlyInOfficial, ['Note B']);
});

test('diffStructure with footnotes disabled ignores footnote differences', () => {
  const ours = new Map([['01GENBSB.SFM', '\\s1 H\n\\v 1 x\\f + \\ft Note A\\f*']]);
  const official = new Map([['bsb_usfm/GEN.usfm', '\\s1 H\n\\v 1 x\\f + \\ft Note B\\f*']]);
  const r = v.diffStructure(ours, official, { footnotes: false });
  assert.strictEqual(r.totals.booksMatched, 1);
  assert.strictEqual(r.totals.booksWithFootnoteDiffs, 0);
});

// ── overallStatus ─────────────────────────────────────────────────────────────
test('overallStatus passes when clean (cosmetic-only allowed) and fails otherwise', () => {
  const cleanVerse = { totals: { textMismatch: 0, missingInOurs: 0, extraInOurs: 0, cosmeticOnly: 5 } };
  const cleanStruct = { totals: { booksWithHeadingDiffs: 0, booksWithFootnoteDiffs: 0, missingBooks: 0, extraBooks: 0 } };
  assert.strictEqual(v.overallStatus(cleanVerse, cleanStruct), 'pass');

  const dirtyVerse = { totals: { textMismatch: 2, missingInOurs: 0, extraInOurs: 0, cosmeticOnly: 0 } };
  assert.strictEqual(v.overallStatus(dirtyVerse, cleanStruct), 'fail');

  const dirtyStruct = { totals: { booksWithHeadingDiffs: 1, booksWithFootnoteDiffs: 0, missingBooks: 0, extraBooks: 0 } };
  assert.strictEqual(v.overallStatus(cleanVerse, dirtyStruct), 'fail');
});
