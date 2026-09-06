// Map the Bible reader's book names to OSIS book codes, so Bible annotations can be stored under
// the shared user-data SDK's `bibleLocator` (corpus 'bible', keyed by osisRef like "Prov.1.7").
//
// The codes are hardcoded (not imported from @noble-collective/userdata) ON PURPOSE: that package's
// core entry pulls in `zod`, which isn't a production dependency here, so requiring it in the server
// crashes the container on boot. tests/unit/osis.test.js cross-checks this table against the SDK's
// OSIS_BOOKS + bibleLocator so the two can never silently drift.
//
// CANON and OSIS_CODES are the 66-book Protestant canon in order; index i pairs them. Book names
// must match bible.getBookList() exactly (note "Psalm" singular, "Song of Solomon").
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
const OSIS_CODES = [
  'Gen', 'Exod', 'Lev', 'Num', 'Deut', 'Josh', 'Judg', 'Ruth', '1Sam', '2Sam', '1Kgs', '2Kgs',
  '1Chr', '2Chr', 'Ezra', 'Neh', 'Esth', 'Job', 'Ps', 'Prov', 'Eccl', 'Song', 'Isa', 'Jer', 'Lam',
  'Ezek', 'Dan', 'Hos', 'Joel', 'Amos', 'Obad', 'Jonah', 'Mic', 'Nah', 'Hab', 'Zeph', 'Hag',
  'Zech', 'Mal', 'Matt', 'Mark', 'Luke', 'John', 'Acts', 'Rom', '1Cor', '2Cor', 'Gal', 'Eph',
  'Phil', 'Col', '1Thess', '2Thess', '1Tim', '2Tim', 'Titus', 'Phlm', 'Heb', 'Jas', '1Pet', '2Pet',
  '1John', '2John', '3John', 'Jude', 'Rev',
];

const NAME_TO_OSIS = {};
CANON.forEach((name, i) => { NAME_TO_OSIS[name] = OSIS_CODES[i]; });

/** OSIS book code for a Bible reader book name (e.g. "Proverbs" → "Prov"), or null if unknown. */
function osisCodeForBook(name) {
  return NAME_TO_OSIS[name] || null;
}

module.exports = { osisCodeForBook, OSIS_CANON: CANON, OSIS_CODES };
