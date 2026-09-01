// Unit tests for the "Fix quote" span alignment (bible-quote-audit.correctQuote).
// These use real findings Steve flagged where the old code dumped the WHOLE verse
// instead of the aligned fragment the quote actually covers.
const test = require('node:test');
const assert = require('node:assert');
const a = require('../../src/server/bible-quote-audit');

test('correctQuote: John 10:10 — aligns past a tense difference at the boundary', () => {
  const quote = 'came that [you] may have life and have it abundantly';
  const verse = 'The thief comes only to steal and kill and destroy. I have come that they may have life, and have it in all its fullness.';
  // The quote covers "come … fullness"; not the whole verse (no thief/steal/kill).
  assert.strictEqual(a.correctQuote(quote, verse),
    'come that they may have life, and have it in all its fullness.');
});

test('correctQuote: 1 Peter 2:9 — returns only the quoted clause, not the whole verse', () => {
  const quote = 'proclaim the excellencies of him who called you out of darkness into his marvelous light';
  const verse = "But you are a chosen people, a royal priesthood, a holy nation, a people for God's own possession, to proclaim the virtues of Him who called you out of darkness into His marvelous light.";
  assert.strictEqual(a.correctQuote(quote, verse),
    'proclaim the virtues of Him who called you out of darkness into His marvelous light.');
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
