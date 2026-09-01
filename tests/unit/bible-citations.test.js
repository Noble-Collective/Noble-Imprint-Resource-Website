// Unit tests for citation detection + quotation audit (bible-citations.js).
const test = require('node:test');
const assert = require('node:assert');
const c = require('../../src/server/bible-citations');

// ── detectFullCitations ────────────────────────────────────────────────────────
test('detectFullCitations finds full Book Ch:V refs including ranges/lists', () => {
  const text = 'As it says (Genesis 30:22), and also John 3:16 and Genesis 37:5, 8 elsewhere.';
  const refs = c.detectFullCitations(text).map(x => x.refString);
  assert.ok(refs.includes('Genesis 30:22'));
  assert.ok(refs.includes('John 3:16'));
  assert.ok(refs.includes('Genesis 37:5, 8'));
});

// ── citationCoversRef ──────────────────────────────────────────────────────────
test('citationCoversRef matches single, list, range, and cross-chapter', () => {
  assert.ok(c.citationCoversRef('Mark 12:29', 'Mark 12:29'));
  assert.ok(c.citationCoversRef('Genesis 37:5, 8', 'Genesis 37:8'));
  assert.ok(c.citationCoversRef('Psalm 145:17-19', 'Psalm 145:18'));
  assert.ok(c.citationCoversRef('Genesis 29:31-30:21', 'Genesis 30:5'));
  assert.ok(!c.citationCoversRef('Mark 12:29', 'Mark 12:30'));
  assert.ok(!c.citationCoversRef('John 3:16', 'Mark 3:16')); // different book
});

// ── quoteForCitation ───────────────────────────────────────────────────────────
test('quoteForCitation extracts an inline "quote" (Ref)', () => {
  const text = 'Then, "they became even more silent" (Acts 22:2), and Paul spoke.';
  const idx = text.indexOf('Acts 22:2');
  const q = c.quoteForCitation(text, idx);
  assert.strictEqual(q.kind, 'inline');
  assert.strictEqual(q.quote, 'they became even more silent');
});

test('quoteForCitation extracts a blockquote above a << attribution', () => {
  const text = '> The Lord is righteous in all His ways\n> and kind in all His deeds.\n\n<< Psalm 145:17';
  const idx = text.indexOf('Psalm 145:17');
  const q = c.quoteForCitation(text, idx);
  assert.strictEqual(q.kind, 'attribution');
  assert.ok(q.quote.includes('The Lord is righteous'));
  assert.ok(q.quote.includes('kind in all His deeds'));
});

test('quoteForCitation returns null when no quote sits beside the citation', () => {
  const text = 'The theme of the passage (Acts 22:2) is boldness.';
  const idx = text.indexOf('Acts 22:2');
  assert.strictEqual(c.quoteForCitation(text, idx), null);
});

// ── classifyQuote ──────────────────────────────────────────────────────────────
const OLD = 'When they heard him speak to them in Hebrew, they became even more silent. Then Paul declared,';
const NEW = 'When they heard him speak to them in Hebrew, they became even more quiet. Then Paul declared,';

test('classifyQuote: quote matching the NEW verse is current', () => {
  assert.deepStrictEqual(c.classifyQuote('they became even more quiet. Then Paul declared', OLD, NEW), { status: 'current' });
});

test('classifyQuote: verbatim old quote is stale AND auto-fixable', () => {
  const r = c.classifyQuote('they became even more silent. Then Paul declared', OLD, NEW);
  assert.strictEqual(r.status, 'stale');
  assert.ok(r.apply, 'a clean verbatim apply is offered');
  assert.ok(r.apply.oldText.includes('silent'));
  assert.ok(r.apply.newText.includes('quiet'));
});

test('classifyQuote: stale quote with mismatched encoding is stale but NOT auto-fixable', () => {
  const oldRaw = 'He replied, “silent watch.”';
  const newRaw = 'He replied, “quiet watch.”';
  // Quote copied with STRAIGHT quotes — normalizes equal to old, but the raw
  // anchor (curly) isn't verbatim in it, so no one-click apply.
  const r = c.classifyQuote('He replied, "silent watch."', oldRaw, newRaw);
  assert.strictEqual(r.status, 'stale');
  assert.ok(!r.apply, 'no verbatim apply when encoding differs → manual review');
});

test('classifyQuote: unrelated paraphrase is divergent', () => {
  const r = c.classifyQuote('Paul kept speaking boldly to the hostile crowd', OLD, NEW);
  assert.strictEqual(r.status, 'divergent');
});

test('classifyQuote: too-short fragment is ignored', () => {
  assert.strictEqual(c.classifyQuote('even more', OLD, NEW), null);
});

// ── expandCitationRefs ─────────────────────────────────────────────────────────
test('expandCitationRefs enumerates single, list, and same-chapter ranges', () => {
  const has = () => true;
  assert.deepStrictEqual(c.expandCitationRefs('Mark 12:29', has), ['Mark 12:29']);
  assert.deepStrictEqual(c.expandCitationRefs('Genesis 37:5, 8', has), ['Genesis 37:5', 'Genesis 37:8']);
  assert.deepStrictEqual(c.expandCitationRefs('Psalm 145:17-19', has), ['Psalm 145:17', 'Psalm 145:18', 'Psalm 145:19']);
});

test('expandCitationRefs stops a range at the first missing verse (via hasRef)', () => {
  const has = r => r !== 'Psalm 145:19'; // 19 does not exist
  assert.deepStrictEqual(c.expandCitationRefs('Psalm 145:17-19', has), ['Psalm 145:17', 'Psalm 145:18']);
});

// ── auditQuoteAgainstText ──────────────────────────────────────────────────────
test('auditQuoteAgainstText: exact substring is exact', () => {
  const r = c.auditQuoteAgainstText('the righteous for the unrighteous',
    'For Christ suffered, the righteous for the unrighteous, to bring you to God.');
  assert.strictEqual(r.status, 'exact');
});

test('auditQuoteAgainstText: only-casing difference is case-only (Lord vs LORD)', () => {
  const r = c.auditQuoteAgainstText('Praise the Lord, O my soul', 'Praise the LORD, O my soul, and forget not');
  assert.strictEqual(r.status, 'case-only');
});

test('auditQuoteAgainstText: a real added word is a deviation', () => {
  const r = c.auditQuoteAgainstText('Then the little children were brought to Jesus',
    'Then little children were brought to Jesus for Him to place His hands on them');
  assert.strictEqual(r.status, 'deviation');
  assert.ok(r.coverage >= 0.6);
});

test('auditQuoteAgainstText: an editorial [Name] insertion + verbatim rest is a bracketed-match', () => {
  // "[Jesus] You are the Christ…" — remove the bracket and it's verbatim BSB.
  const r = c.auditQuoteAgainstText('[Jesus] you are the Christ, the Son of the living God',
    'Simon Peter answered, You are the Christ, the Son of the living God');
  assert.strictEqual(r.status, 'bracketed-match');
  assert.strictEqual(r.tier, 'faithful');
});

test('auditQuoteAgainstText: a [pronoun] substitution is a bracketed-match', () => {
  // BSB "He"; author quotes "[Jesus]" — the only difference is the bracketed pronoun.
  const r = c.auditQuoteAgainstText('Therefore [Jesus] is able to save completely those who draw near to God',
    'Therefore He is able to save completely those who draw near to God through Him');
  assert.strictEqual(r.status, 'bracketed-match');
});

test('auditQuoteAgainstText: a real non-bracket word difference is still a deviation despite a bracket', () => {
  // "[you] may have life and have it abundantly" — de-bracketed still differs on "abundantly".
  const r = c.auditQuoteAgainstText('that [you] may have life and have it abundantly',
    'I have come that they may have life and have it to the full');
  assert.strictEqual(r.status, 'deviation');
  assert.ok((r.onlyInQuote || []).includes('abundantly'));
});

test('auditQuoteAgainstText: unrelated text is paraphrase', () => {
  const r = c.auditQuoteAgainstText('a completely different sentence with no overlap at all',
    'For God so loved the world that He gave His one and only Son');
  assert.strictEqual(r.status, 'paraphrase');
});

test('auditQuoteAgainstText: punctuation-only difference is format-only, not a deviation', () => {
  const r = c.auditQuoteAgainstText('the world has hated them; for they are not of the world',
    'the world has hated them. For they are not of the world, just as I am not');
  assert.strictEqual(r.status, 'format-only');
});

test('auditQuoteAgainstText: a few off words → word-difference (review tier)', () => {
  const r = c.auditQuoteAgainstText('Then the little children were brought to Jesus for Him',
    'Then little children were brought to Jesus for Him to place His hands');
  assert.strictEqual(r.reason, 'word-difference');
  assert.strictEqual(r.tier, 'review');
  assert.deepStrictEqual(r.onlyInQuote, ['the']);
});

test('auditQuoteAgainstText: many off words but high overlap → heavy-difference (different translation)', () => {
  const r = c.auditQuoteAgainstText(
    'The Lord is my shepherd I lack nothing He makes me lie down in green meadows and leads me beside quiet waters',
    'The LORD is my shepherd, I shall not want. He makes me lie down in green pastures, He leads me beside still waters.');
  assert.strictEqual(r.reason, 'heavy-difference');
  assert.strictEqual(r.tier, 'different-translation');
  assert.ok(r.onlyInQuote.length > 4);
});

test('auditQuoteAgainstText: markdown emphasis underscores do not count as differences', () => {
  const r = c.auditQuoteAgainstText('_by the grace of God I am what I am_',
    'But by the grace of God I am what I am, and His grace to me was not in vain.');
  assert.strictEqual(r.status, 'exact');
});
