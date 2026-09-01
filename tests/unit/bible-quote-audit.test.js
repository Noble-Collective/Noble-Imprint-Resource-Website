// Unit tests for the "Fix quote" span alignment (bible-quote-audit.correctQuote).
// These use real findings Steve flagged where the old code dumped the WHOLE verse
// instead of the aligned fragment the quote actually covers.
const test = require('node:test');
const assert = require('node:assert');
const a = require('../../src/server/bible-quote-audit');

test('correctQuote: John 10:10 — aligns past a tense difference at the boundary', () => {
  const quote = 'came that [you] may have life and have it abundantly';
  const verse = 'The thief comes only to steal and kill and destroy. I have come that they may have life, and have it in all its fullness.';
  // The quote covers "come … fullness"; not the whole verse (no thief/steal/kill). The
  // quote had no trailing period, so the span keeps none either.
  assert.strictEqual(a.correctQuote(quote, verse),
    'come that they may have life, and have it in all its fullness');
});

test('correctQuote: 1 Peter 2:9 — returns only the quoted clause, not the whole verse', () => {
  const quote = 'proclaim the excellencies of him who called you out of darkness into his marvelous light';
  const verse = "But you are a chosen people, a royal priesthood, a holy nation, a people for God's own possession, to proclaim the virtues of Him who called you out of darkness into His marvelous light.";
  assert.strictEqual(a.correctQuote(quote, verse),
    'proclaim the virtues of Him who called you out of darkness into His marvelous light');
});

test('correctQuote: Genesis 37:24 — anchors a repeated word compactly, no trailing period', () => {
  const quote = 'threw him into a pit';
  const verse = 'and they took him and threw him into the pit. Now the pit was empty, with no water in it.';
  // Must NOT spread to the second "pit" ("…the pit. Now the pit").
  assert.strictEqual(a.correctQuote(quote, verse), 'threw him into the pit');
});

test('correctQuote: Genesis 40:23 — whole-verse coverage keeps the quote-embedded (no) period', () => {
  const quote = 'the chief cupbearer did not remember Joseph, but forgot him';
  const verse = 'The chief cupbearer, however, did not remember Joseph; he forgot all about him.';
  assert.strictEqual(a.correctQuote(quote, verse),
    'The chief cupbearer, however, did not remember Joseph; he forgot all about him');
});

test('correctQuote: John 1:9 — trims the trailing clause the quote does not cover', () => {
  const quote = 'the true Light who gives light to every man';
  const verse = 'The true Light, who gives light to everyone, was coming into the world.';
  // Should stop at the quoted portion, not run into "was coming into the world."
  const got = a.correctQuote(quote, verse);
  assert.ok(/^The true Light, who gives light to everyone,?$/.test(got), 'got: ' + JSON.stringify(got));
});

test('correctQuote: returns the full verse span when the quote covers the whole verse', () => {
  const quote = 'For God so loved the world that He gave His only Son';
  const verse = 'For God so loved the world that He gave His one and only Son';
  const got = a.correctQuote(quote, verse);
  assert.ok(got && /^For God so loved the world/.test(got) && /only Son$/.test(got), 'got: ' + JSON.stringify(got));
});

test('correctQuote: returns null when there is no real alignment (paraphrase)', () => {
  const quote = 'this is a wholly unrelated sentence about nothing';
  const verse = 'In the beginning God created the heavens and the earth.';
  assert.strictEqual(a.correctQuote(quote, verse), null);
});

// ── peelRaw: separate wrapper markup from the scripture core ────────────────────
test('peelRaw peels blockquote + italics, leaving sentence punctuation in the core', () => {
  const r = a.peelRaw('> _Christ, having been offered once, will appear._ ');
  assert.strictEqual(r.open, '> _');
  assert.strictEqual(r.close, '_ ');
  assert.strictEqual(r.core, 'Christ, having been offered once, will appear.');
});

test('peelRaw returns empty wrappers for a bare inline quote', () => {
  const r = a.peelRaw('came that may have life and have it abundantly');
  assert.strictEqual(r.open, '');
  assert.strictEqual(r.close, '');
});

// ── computeFix: the replacement preserves the quote's markdown wrappers ──────────
test('computeFix keeps the blockquote + italics around an attribution replacement', () => {
  const q = {
    kind: 'attribution',
    quote: '_Christ, having been offered once to bear the sins of many, will appear a second time, not to deal with sin but to save those who are eagerly waiting for him._',
    raw: '> _Christ, having been offered once to bear the sins of many, will appear a second time, not to deal with sin but to save those who are eagerly waiting for him._ ',
  };
  const verse = 'so also Christ was offered once to bear the sins of many; and He will appear a second time, not to bear sin, but to bring salvation to those who eagerly await Him.';
  const fix = a.computeFix(q, { status: 'deviation' }, verse);
  assert.strictEqual(fix.ok, true);
  assert.ok(fix.replacement.startsWith('> _'), 'replacement keeps "> _": ' + JSON.stringify(fix.replacement));
  assert.ok(/_$/.test(fix.replacement), 'replacement keeps trailing "_": ' + JSON.stringify(fix.replacement));
  assert.ok(!/^> [A-Za-z]/.test(fix.replacement), 'must NOT flatten to a plain blockquote');
  assert.ok(!fix.span.includes('_') && !fix.span.includes('>'), 'span stays plain for verse highlighting');
  assert.strictEqual(fix.oldRaw, q.raw);
});

test('computeFix leaves a bare inline quote unwrapped', () => {
  const q = {
    kind: 'inline',
    quote: 'came that [you] may have life and have it abundantly',
    raw: 'came that [you] may have life and have it abundantly',
  };
  const verse = 'The thief comes only to steal and kill and destroy. I have come that they may have life, and have it in all its fullness.';
  const fix = a.computeFix(q, { status: 'deviation' }, verse);
  assert.strictEqual(fix.ok, true);
  assert.ok(!/[>_*`]/.test(fix.replacement), 'inline replacement stays plain: ' + JSON.stringify(fix.replacement));
  assert.strictEqual(fix.replacement, fix.span);
});

test('computeFix does not double the closing quote or append a period (Matt 28:20 style)', () => {
  // Blockquote ending in the scripture's own closing quote; quote has an extra word so a
  // fix is produced. Must end "...age.”" — not "...age.”.”" / "...age.”.".
  const q = {
    kind: 'attribution',
    quote: 'Then the eleven disciples went to Galilee. And Jesus said, "All authority has been given to Me. Go therefore, even to the end of the age."',
    raw: '> Then the eleven disciples went to Galilee. And Jesus said, "All authority has been given to Me. Go therefore, even to the end of the age."',
  };
  const verse = 'Then eleven disciples went to Galilee. And Jesus said, “All authority has been given to Me. Go therefore, even to the end of the age.”';
  const fix = a.computeFix(q, { status: 'deviation' }, verse);
  assert.strictEqual(fix.ok, true);
  assert.ok(!/[.”"']\s*[”"']\s*$/.test(fix.replacement) || /age\.”$/.test(fix.replacement),
    'no doubled quote/period tail: ' + JSON.stringify(fix.replacement));
  assert.ok(/age\.”$/.test(fix.replacement), 'ends with a single closing quote: ' + JSON.stringify(fix.replacement));
  assert.ok(fix.replacement.startsWith('> '), 'keeps the blockquote');
});

test('peelRaw peels quote marks only when asked (inline yes, blockquote no)', () => {
  assert.strictEqual(a.peelRaw('“come to Me.”', true).open, '“');
  assert.strictEqual(a.peelRaw('“come to Me.”', true).close, '”');
  // Blockquote: a trailing quote is scripture, not a wrapper — leave it in the core.
  const r = a.peelRaw('> Jesus said, “come to Me.”', false);
  assert.strictEqual(r.open, '> ');
  assert.strictEqual(r.close, '');
  assert.ok(r.core.endsWith('”'));
});

test('computeFix keeps the surrounding quote marks when raw includes them', () => {
  const q = {
    kind: 'inline',
    quote: 'came that [you] may have life and have it abundantly',
    raw: '"came that [you] may have life and have it abundantly"',
  };
  const verse = 'The thief comes only to steal and kill and destroy. I have come that they may have life, and have it in all its fullness.';
  const fix = a.computeFix(q, { status: 'deviation' }, verse);
  assert.strictEqual(fix.ok, true);
  assert.ok(fix.replacement.startsWith('"') && fix.replacement.endsWith('"'), 'keeps quote marks: ' + JSON.stringify(fix.replacement));
  assert.ok(!fix.span.startsWith('"'), 'span stays unquoted for verse highlighting');
});
