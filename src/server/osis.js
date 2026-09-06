// Map the Bible reader's book names to OSIS book codes, so Bible annotations can be stored under
// the shared user-data SDK's `bibleLocator` (corpus 'bible', keyed by osisRef like "Prov.1.7").
// The SDK exposes OSIS_BOOKS as an array indexed by canonical book number (1=Gen … 66=Rev); we zip
// it with the site's book names in that same canonical order. Validated (all 66 resolve) by
// tests/unit/osis.test.js. Book names must match bible.getBookList() exactly (note "Psalm",
// "Song of Solomon").
const { OSIS_BOOKS } = require('@noble-collective/userdata/core');

const CANON = [
  'Genesis', 'Exodus', 'Leviticus', 'Numbers', 'Deuteronomy', 'Joshua', 'Judges', 'Ruth',
  '1 Samuel', '2 Samuel', '1 Kings', '2 Kings', '1 Chronicles', '2 Chronicles', 'Ezra', 'Nehemiah',
  'Esther', 'Job', 'Psalm', 'Proverbs', 'Ecclesiastes', 'Song of Solomon', 'Isaiah', 'Jeremiah',
  'Lamentations', 'Ezekiel', 'Daniel', 'Hosea', 'Joel', 'Amos', 'Obadiah', 'Jonah', 'Micah',
  'Nahum', 'Habakkuk', 'Zephaniah', 'Haggai', 'Zechariah', 'Malachi', 'Matthew', 'Mark', 'Luke',
  'John', 'Acts', 'Romans', '1 Corinthians', '2 Corinthians', 'Galatians', 'Ephesians',
  'Philippians', 'Colossians', '1 Thessalonians', '2 Thessalonians', '1 Timothy', '2 Timothy',
  'Titus', 'Philemon', 'Hebrews', 'James', '1 Peter', '2 Peter', '1 John', '2 John', '3 John',
  'Jude', 'Revelation',
];

const NAME_TO_OSIS = {};
CANON.forEach((name, i) => { const code = OSIS_BOOKS[i + 1]; if (code) NAME_TO_OSIS[name] = code; });

/** OSIS book code for a Bible reader book name (e.g. "Proverbs" → "Prov"), or null if unknown. */
function osisCodeForBook(name) {
  return NAME_TO_OSIS[name] || null;
}

module.exports = { osisCodeForBook, OSIS_CANON: CANON };
