// Every Bible book the reader shows must find its audio. The audiobook pipeline stores a book under
// slugify(its USFM \h name) — "Psalms", "Song" — but the reader names books by their references.json
// keys ("Psalm", "Song of Solomon"), so a plain slugify of the reader's name missed those two books
// entirely (no player on any Psalm or Song of Solomon chapter, 2026-09-27).
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { bibleAudioSlug } = require('../../src/server/audio');

// The pipeline's slug source: the \h line of each BSB USFM file (Noble-Imprint-Resources bibles/bsb/content).
const USFM_H_NAMES = ['Genesis', 'Exodus', 'Leviticus', 'Numbers', 'Deuteronomy', 'Joshua', 'Judges', 'Ruth',
  '1 Samuel', '2 Samuel', '1 Kings', '2 Kings', '1 Chronicles', '2 Chronicles', 'Ezra', 'Nehemiah', 'Esther',
  'Job', 'Psalms', 'Proverbs', 'Ecclesiastes', 'Song', 'Isaiah', 'Jeremiah', 'Lamentations', 'Ezekiel',
  'Daniel', 'Hosea', 'Joel', 'Amos', 'Obadiah', 'Jonah', 'Micah', 'Nahum', 'Habakkuk', 'Zephaniah', 'Haggai',
  'Zechariah', 'Malachi', 'Matthew', 'Mark', 'Luke', 'John', 'Acts', 'Romans', '1 Corinthians',
  '2 Corinthians', 'Galatians', 'Ephesians', 'Philippians', 'Colossians', '1 Thessalonians',
  '2 Thessalonians', '1 Timothy', '2 Timothy', 'Titus', 'Philemon', 'Hebrews', 'James', '1 Peter', '2 Peter',
  '1 John', '2 John', '3 John', 'Jude', 'Revelation'];
const pipelineSlug = (h) => h.toLowerCase().replace(/['’]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

test('the two books whose reader name differs from the USFM \\h name', () => {
  assert.strictEqual(bibleAudioSlug('Psalm'), 'psalms');
  assert.strictEqual(bibleAudioSlug('Song of Solomon'), 'song');
  assert.strictEqual(bibleAudioSlug('1 Samuel'), '1-samuel');
});

test('every BSB book in the reader resolves to the slug its audio is stored under', () => {
  const cache = require(path.join(__dirname, '../../.bible-cache/bsb-v1.json'));
  const readerBooks = [...new Set(Object.keys(cache.verses).map((k) => k.match(/^(.+?)\s+\d+:\d+$/)[1]))];
  assert.strictEqual(readerBooks.length, 66);
  const audioSlugs = new Set(USFM_H_NAMES.map(pipelineSlug));
  const missing = readerBooks.filter((b) => !audioSlugs.has(bibleAudioSlug(b)));
  assert.deepStrictEqual(missing, []);
});
