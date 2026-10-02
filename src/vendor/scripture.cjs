// VENDORED — do not edit. @noble-collective/userdata/scripture 0.4.0 (Collective-Shared db637af).
// Regenerate with: bash scripts/vendor-scripture.sh
"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/scripture/index.ts
var scripture_exports = {};
__export(scripture_exports, {
  BOOKS: () => BOOKS,
  CHAPTER_COUNTS: () => CHAPTER_COUNTS,
  DASH: () => DASH,
  ITEM: () => ITEM,
  LIST: () => LIST,
  ONE_CHAPTER_BOOKS: () => ONE_CHAPTER_BOOKS,
  TEXT_ABBREVIATIONS: () => TEXT_ABBREVIATIONS,
  TEXT_NAMES: () => TEXT_NAMES,
  bookAt: () => bookAt,
  bookContext: () => bookContext,
  canonicalBook: () => canonicalBook,
  chapterLengthsFromKeys: () => chapterLengthsFromKeys,
  chapterLengthsFromTable: () => chapterLengthsFromTable,
  findReferences: () => findReferences,
  formatPassage: () => formatPassage,
  looksLikeClockTime: () => looksLikeClockTime,
  normalizeSpec: () => normalizeSpec,
  parseSpec: () => parseSpec,
  resolvePassage: () => resolvePassage
});
module.exports = __toCommonJS(scripture_exports);

// src/scripture/books.ts
var BOOKS = [
  "Genesis",
  "Exodus",
  "Leviticus",
  "Numbers",
  "Deuteronomy",
  "Joshua",
  "Judges",
  "Ruth",
  "1 Samuel",
  "2 Samuel",
  "1 Kings",
  "2 Kings",
  "1 Chronicles",
  "2 Chronicles",
  "Ezra",
  "Nehemiah",
  "Esther",
  "Job",
  "Psalm",
  "Proverbs",
  "Ecclesiastes",
  "Song of Solomon",
  "Isaiah",
  "Jeremiah",
  "Lamentations",
  "Ezekiel",
  "Daniel",
  "Hosea",
  "Joel",
  "Amos",
  "Obadiah",
  "Jonah",
  "Micah",
  "Nahum",
  "Habakkuk",
  "Zephaniah",
  "Haggai",
  "Zechariah",
  "Malachi",
  "Matthew",
  "Mark",
  "Luke",
  "John",
  "Acts",
  "Romans",
  "1 Corinthians",
  "2 Corinthians",
  "Galatians",
  "Ephesians",
  "Philippians",
  "Colossians",
  "1 Thessalonians",
  "2 Thessalonians",
  "1 Timothy",
  "2 Timothy",
  "Titus",
  "Philemon",
  "Hebrews",
  "James",
  "1 Peter",
  "2 Peter",
  "1 John",
  "2 John",
  "3 John",
  "Jude",
  "Revelation"
];
var CHAPTER_COUNTS = Object.fromEntries(
  BOOKS.map((b, i) => [
    b,
    [
      50,
      40,
      27,
      36,
      34,
      24,
      21,
      4,
      31,
      24,
      22,
      25,
      29,
      36,
      10,
      13,
      10,
      42,
      150,
      31,
      12,
      8,
      66,
      52,
      5,
      48,
      12,
      14,
      3,
      9,
      1,
      4,
      7,
      3,
      3,
      3,
      2,
      14,
      4,
      28,
      16,
      24,
      21,
      28,
      16,
      16,
      13,
      6,
      6,
      4,
      4,
      5,
      3,
      6,
      4,
      3,
      1,
      13,
      5,
      5,
      3,
      5,
      1,
      1,
      1,
      22
    ][i]
  ])
);
var ONE_CHAPTER_BOOKS = /* @__PURE__ */ new Set(["Obadiah", "Philemon", "2 John", "3 John", "Jude"]);
var TEXT_NAMES = {
  ...Object.fromEntries(BOOKS.map((b) => [b, b])),
  Psalms: "Psalm",
  "Song of Songs": "Song of Solomon",
  ...frenchNames()
};
function frenchNames() {
  const fr = {
    Gen\u00E8se: "Genesis",
    Exode: "Exodus",
    L\u00E9vitique: "Leviticus",
    Nombres: "Numbers",
    Deut\u00E9ronome: "Deuteronomy",
    Josu\u00E9: "Joshua",
    Juges: "Judges",
    "1 Rois": "1 Kings",
    "2 Rois": "2 Kings",
    "1 Chroniques": "1 Chronicles",
    "2 Chroniques": "2 Chronicles",
    Esdras: "Ezra",
    N\u00E9h\u00E9mie: "Nehemiah",
    Psaume: "Psalm",
    Psaumes: "Psalm",
    Proverbes: "Proverbs",
    Eccl\u00E9siaste: "Ecclesiastes",
    "Cantique des cantiques": "Song of Solomon",
    "Cantique des Cantiques": "Song of Solomon",
    \u00C9sa\u00EFe: "Isaiah",
    Esa\u00EFe: "Isaiah",
    Isa\u00EFe: "Isaiah",
    J\u00E9r\u00E9mie: "Jeremiah",
    \u00C9z\u00E9chiel: "Ezekiel",
    Ez\u00E9chiel: "Ezekiel",
    Os\u00E9e: "Hosea",
    Jo\u00EBl: "Joel",
    Abdias: "Obadiah",
    Jonas: "Jonah",
    Mich\u00E9e: "Micah",
    Habacuc: "Habakkuk",
    Sophonie: "Zephaniah",
    Agg\u00E9e: "Haggai",
    Zacharie: "Zechariah",
    Malachie: "Malachi",
    Matthieu: "Matthew",
    Marc: "Mark",
    Luc: "Luke",
    Jean: "John",
    Actes: "Acts",
    Romains: "Romans",
    "1 Corinthiens": "1 Corinthians",
    "2 Corinthiens": "2 Corinthians",
    Galates: "Galatians",
    \u00C9ph\u00E9siens: "Ephesians",
    Eph\u00E9siens: "Ephesians",
    Philippiens: "Philippians",
    Colossiens: "Colossians",
    "1 Thessaloniciens": "1 Thessalonians",
    "2 Thessaloniciens": "2 Thessalonians",
    "1 Timoth\xE9e": "1 Timothy",
    "2 Timoth\xE9e": "2 Timothy",
    Tite: "Titus",
    Phil\u00E9mon: "Philemon",
    H\u00E9breux: "Hebrews",
    Jacques: "James",
    "1 Pierre": "1 Peter",
    "2 Pierre": "2 Peter",
    "1 Jean": "1 John",
    "2 Jean": "2 John",
    "3 Jean": "3 John",
    Apocalypse: "Revelation"
  };
  return fr;
}
var TEXT_ABBREVIATIONS = {
  Gen: "Genesis",
  Exod: "Exodus",
  Lev: "Leviticus",
  Num: "Numbers",
  Deut: "Deuteronomy",
  Josh: "Joshua",
  Judg: "Judges",
  "1 Sam": "1 Samuel",
  "2 Sam": "2 Samuel",
  "1 Kgs": "1 Kings",
  "2 Kgs": "2 Kings",
  "1 Chr": "1 Chronicles",
  "2 Chr": "2 Chronicles",
  Neh: "Nehemiah",
  Esth: "Esther",
  Ps: "Psalm",
  Pss: "Psalm",
  Prov: "Proverbs",
  Eccl: "Ecclesiastes",
  Eccles: "Ecclesiastes",
  Isa: "Isaiah",
  Jer: "Jeremiah",
  Lam: "Lamentations",
  Ezek: "Ezekiel",
  Dan: "Daniel",
  Hos: "Hosea",
  Obad: "Obadiah",
  Mic: "Micah",
  Nah: "Nahum",
  Hab: "Habakkuk",
  Zeph: "Zephaniah",
  Hag: "Haggai",
  Zech: "Zechariah",
  Mal: "Malachi",
  Matt: "Matthew",
  Rom: "Romans",
  "1 Cor": "1 Corinthians",
  "2 Cor": "2 Corinthians",
  Gal: "Galatians",
  Eph: "Ephesians",
  Phil: "Philippians",
  Col: "Colossians",
  "1 Thess": "1 Thessalonians",
  "2 Thess": "2 Thessalonians",
  "1 Tim": "1 Timothy",
  "2 Tim": "2 Timothy",
  Phlm: "Philemon",
  Philem: "Philemon",
  Heb: "Hebrews",
  Jas: "James",
  "1 Pet": "1 Peter",
  "2 Pet": "2 Peter",
  Rev: "Revelation"
};
var LOOKUP = {};
for (const b of BOOKS) LOOKUP[squash(b)] = b;
for (const [k, v] of Object.entries(TEXT_NAMES)) LOOKUP[squash(k)] = v;
for (const [k, v] of Object.entries(TEXT_ABBREVIATIONS)) LOOKUP[squash(k)] = v;
var MORE = {
  Genesis: ["ge", "gn"],
  Exodus: ["exo", "ex"],
  Leviticus: ["le", "lv"],
  Numbers: ["nu", "nm", "nb"],
  Deuteronomy: ["dt", "de"],
  Joshua: ["jos", "jsh"],
  Judges: ["jdg", "jg", "jdgs"],
  Ruth: ["rth", "ru"],
  "1 Samuel": ["1sa", "1s"],
  "2 Samuel": ["2sa", "2s"],
  "1 Kings": ["1ki", "1k", "1kings"],
  "2 Kings": ["2ki", "2k"],
  "1 Chronicles": ["1ch"],
  "2 Chronicles": ["2ch"],
  Ezra: ["ezr"],
  Nehemiah: ["ne"],
  Esther: ["est", "es"],
  Job: ["jb"],
  Psalm: ["psa", "psm"],
  Proverbs: ["pro", "prv", "pr"],
  Ecclesiastes: ["ecc", "ec", "qoh"],
  "Song of Solomon": ["song", "sos", "ss", "canticles", "cant"],
  Isaiah: ["is"],
  Jeremiah: ["je", "jr"],
  Lamentations: ["la"],
  Ezekiel: ["eze", "ezk"],
  Daniel: ["da", "dn"],
  Hosea: ["ho"],
  Joel: ["joe", "jl"],
  Amos: ["amo", "am"],
  Obadiah: ["oba", "ob"],
  Jonah: ["jon", "jnh"],
  Micah: ["mc"],
  Nahum: ["na"],
  Habakkuk: ["hb"],
  Zephaniah: ["zep", "zp"],
  Haggai: ["hg"],
  Zechariah: ["zec", "zc"],
  Malachi: ["ml"],
  Matthew: ["mt"],
  Mark: ["mrk", "mk", "mr"],
  Luke: ["luk", "lk"],
  John: ["jn", "jhn", "joh"],
  Acts: ["act", "ac"],
  Romans: ["ro", "rm"],
  "1 Corinthians": ["1co"],
  "2 Corinthians": ["2co"],
  Galatians: ["ga"],
  Ephesians: ["ephes"],
  Philippians: ["php", "pp"],
  Colossians: ["co"],
  "1 Thessalonians": ["1th"],
  "2 Thessalonians": ["2th"],
  "1 Timothy": ["1ti"],
  "2 Timothy": ["2ti"],
  Titus: ["tit", "ti"],
  Philemon: ["phm", "pm"],
  James: ["jm"],
  "1 Peter": ["1pe", "1pt"],
  "2 Peter": ["2pe", "2pt"],
  "1 John": ["1jn", "1jo", "1j"],
  "2 John": ["2jn", "2jo", "2j"],
  "3 John": ["3jn", "3jo", "3j"],
  Jude: ["jud", "jd"],
  Revelation: ["re", "apoc", "apocalypse", "revelations"]
};
for (const [book, aliases] of Object.entries(MORE)) for (const a of aliases) LOOKUP[a] ??= book;
function squash(s) {
  return s.toLowerCase().replace(/[\s.]+/g, "");
}
function canonicalBook(name) {
  let s = name.trim().replace(/\s+/g, " ");
  if (!s) return null;
  s = s.replace(/^(?:first|1st|iii(?=\s)|ii(?=\s)|i(?=\s))\s*/i, (m) => ordinal(m) + " ").replace(/^(?:second|2nd|third|3rd)\s*/i, (m) => ordinal(m) + " ");
  return LOOKUP[squash(s)] ?? null;
}
function ordinal(prefix) {
  const p = prefix.trim().toLowerCase();
  if (p === "first" || p === "1st" || p === "i") return "1";
  if (p === "second" || p === "2nd" || p === "ii") return "2";
  return "3";
}

// src/scripture/spec.ts
var DASH = "[-\u2013\u2014\u2212\u2011]";
var ITEM = `\\d+(?::\\d+)?[a-c]?(?:${DASH}[ \\u00a0]?\\d+(?::\\d+)?[a-c]?)?(?!\\d|:\\d)`;
var CF = "c[fp]\\.?[ \\u00a0]?";
var LIST = `${ITEM}(?:(?:,[ \\u00a0]?(?:${CF})?|[ \\u00a0]${CF})${ITEM}(?![ \\u00a0]+[A-Z]))*`;
var ITEM_PARTS = new RegExp(`^(\\d+)(?::(\\d+))?[a-c]?(?:${DASH}(\\d+)(?::(\\d+))?[a-c]?)?$`);
function normalizeSpec(spec) {
  return spec.replace(/\s*,?\s*c[fp]\.?\s*/g, ",").replace(new RegExp(DASH, "g"), "-").replace(/[()\s]/g, "").replace(/^,+|[;,]+$/g, "");
}
function parseSpec(spec) {
  const norm = normalizeSpec(spec);
  if (!norm) return null;
  const items = [];
  for (const part of norm.split(",")) {
    const m = ITEM_PARTS.exec(part);
    if (!m) return null;
    items.push({
      a: +m[1],
      aVerse: m[2] == null ? null : +m[2],
      b: m[3] == null ? null : +m[3],
      bVerse: m[4] == null ? null : +m[4]
    });
  }
  return items;
}
function looksLikeClockTime(spec, after) {
  return /:0\d/.test(spec) || /^[ \u00a0]*(?:[ap]\.?m\b|o['’]?clock)/i.test(after);
}

// src/scripture/find.ts
var SP = "[ \\u00a0]";
var alt = (names) => names.sort((a, b) => b.length - a.length).map((n) => n.replace(/ /g, SP)).join("|");
var FULL = alt(Object.keys(TEXT_NAMES));
var ABBR = alt(Object.keys(TEXT_ABBREVIATIONS));
var NAMED = new RegExp(`(?<![A-Za-z0-9.])(?:(${FULL})|(${ABBR})\\.?)${SP}(${LIST})`, "g");
var CONTINUATION = new RegExp(`(?:${SP}?;${SP}?(?:${CF})?|${SP}and${SP})(?=\\d+:\\d)(${LIST})`, "y");
var SECTION = new RegExp(`(?:Biblical Narrative|R\xE9cit biblique) \\((${FULL})${SP}\\d+`, "g");
var GROUP = /\(([^()]*)\)|\[([^[\]]*)\]/g;
var BARE = new RegExp(`^(?:${CF}|[Ff]ocus${SP}on${SP})?(${LIST})${SP}*$`);
var LOOSE = new RegExp(`(?<![\\p{L}\\d:.,/\u2013-])(?=\\d+:\\d)(${LIST})`, "gu");
var BIBLIOGRAPHY = /^(#{1,6})[ \t]+[^\n]*\bBibliograph/gim;
var HEADING = /^(#{1,6})[ \t]/gm;
var SENTENCE_WORDS = /* @__PURE__ */ new Set(["In", "See", "As", "Also", "And", "But", "Compare", "Cf", "Cp", "From", "At", "On", "Like", "Per", "Read", "Then", "Dans", "Voir", "En"]);
function bookFor(full, abbr) {
  if (full) return TEXT_NAMES[full.replace(/\u00a0/g, " ")];
  return TEXT_ABBREVIATIONS[abbr.replace(/\u00a0/g, " ")];
}
function bookContext(text) {
  const bibliography = bibliographyRanges(text);
  const sections = [];
  for (const m of text.matchAll(SECTION)) sections.push({ pos: m.index, book: TEXT_NAMES[m[1].replace(/\u00a0/g, " ")] });
  if (sections.length) return { marks: sections, fromSections: true, bibliography };
  const marks = [];
  for (const m of text.matchAll(NAMED)) {
    const i = m.index;
    if (!m[1] || !/^\d+:\d/.test(m[3])) continue;
    const before = i > 0 ? text[i - 1] : "";
    if (before === '"' || before === "=" || before === "/") continue;
    if (insideTag(text, i)) continue;
    if (/cf\.\s?$/.test(text.slice(Math.max(0, i - 5), i))) continue;
    if (/;\s?$/.test(text.slice(Math.max(0, i - 3), i))) continue;
    marks.push({ pos: i, book: bookFor(m[1], m[2]) });
  }
  return { marks, fromSections: false, bibliography };
}
function bibliographyRanges(text) {
  const out = [];
  for (const b of text.matchAll(BIBLIOGRAPHY)) {
    const level = b[1].length;
    let end = text.length;
    HEADING.lastIndex = b.index + b[0].length;
    for (let h = HEADING.exec(text); h; h = HEADING.exec(text)) {
      if (h[1].length <= level) {
        end = h.index;
        break;
      }
    }
    out.push([b.index, end]);
  }
  return out;
}
function bookAt(context, pos) {
  let book = context.fromSections && context.marks.length ? context.marks[0].book : null;
  for (const m of context.marks) {
    if (m.pos > pos) break;
    book = m.book;
  }
  return book;
}
function insideTag(text, i) {
  const close = text.lastIndexOf(">", i);
  for (let j = text.lastIndexOf("<", i); j > close; j = text.lastIndexOf("<", j - 1)) {
    if (/[A-Za-z/]/.test(text[j + 1] ?? "")) return true;
    if (j === 0) break;
  }
  return false;
}
function findReferences(text, options = {}) {
  const context = options.context ?? bookContext(text);
  const offset = options.contextOffset ?? 0;
  const found = [];
  const add = (start, written, spec, book, implied, continuation) => found.push({ start, end: start + written.length, text: written, book, spec: normalizeSpec(spec), implied, continuation });
  for (const m of text.matchAll(NAMED)) {
    const book = bookFor(m[1], m[2]);
    const spec = m[3];
    const end = m.index + m[0].length;
    if (insideTag(text, m.index)) continue;
    if (looksLikeClockTime(spec, text.slice(end))) continue;
    const items = parseSpec(spec);
    if (!items) continue;
    const first = items[0];
    if (first.aVerse == null) {
      if (m[2]) continue;
      if (/^\d+,\d/.test(spec) || /^[.,]\d/.test(text.slice(end))) continue;
      if (!ONE_CHAPTER_BOOKS.has(book) && first.a > (CHAPTER_COUNTS[book] ?? 0)) continue;
    }
    add(m.index, m[0], spec, book, false, false);
    let at = end;
    for (; ; ) {
      CONTINUATION.lastIndex = at;
      const c = CONTINUATION.exec(text);
      if (!c) break;
      const written = c[1];
      const cEnd = at + c[0].length;
      if (looksLikeClockTime(written, text.slice(cEnd))) break;
      add(cEnd - written.length, written, written, book, false, true);
      at = cEnd;
    }
  }
  const taken = (s, e) => found.some((f) => f.start < e && s < f.end);
  for (const p of text.matchAll(GROUP)) {
    const inner = p[1] ?? p[2];
    let pos = p.index + 1;
    let local = null;
    for (const part of inner.split(";")) {
      const start = pos;
      const end = pos + part.length;
      pos = end + 1;
      const named = found.filter((f) => !f.implied && f.start >= start && f.start < end);
      if (named.length) {
        local = named[named.length - 1].book;
        continue;
      }
      if (taken(start, end)) continue;
      const lead = part.length - part.trimStart().length;
      const m = BARE.exec(part.trimStart());
      if (!m) continue;
      const written = m[1];
      const wStart = start + lead + m[0].indexOf(written);
      if (insideTag(text, wStart)) continue;
      if (looksLikeClockTime(written, text.slice(wStart + written.length))) continue;
      if (!parseSpec(written)?.[0]?.aVerse) continue;
      const book = local ?? bookAt(context, offset + wStart);
      if (!book) continue;
      add(wStart, written, written, book, local == null, local != null);
    }
  }
  for (const m of text.matchAll(LOOSE)) {
    const written = m[1];
    const s = m.index;
    const e = s + written.length;
    if (taken(s, e)) continue;
    if (insideTag(text, s) || looksLikeClockTime(written, text.slice(e))) continue;
    if (/<sup[^>]*>[^<]*$/i.test(text.slice(Math.max(0, s - 40), s))) continue;
    const line = text.slice(text.lastIndexOf("\n", s - 1) + 1, s);
    if (/^[\s>]*$/.test(line)) continue;
    const emphasis = line.replace(/\*\*|__/g, "");
    if ((emphasis.match(/[_*]/g) ?? []).length % 2 === 1) continue;
    if (/[_*][,:]?\s*$/.test(emphasis)) continue;
    const word = /(\p{Lu}[\p{L}’'.-]*)[  ]$/u.exec(line);
    if (word && !SENTENCE_WORDS.has(word[1].replace(/[.,]$/, ""))) continue;
    const at = offset + s;
    if (context.bibliography.some(([a, b]) => at >= a && at < b)) continue;
    if (!parseSpec(written)?.[0]?.aVerse) continue;
    const book = bookAt(context, at);
    if (!book) continue;
    add(s, written, written, book, true, false);
  }
  return found.sort((a, b) => a.start - b.start);
}

// src/scripture/resolve.ts
function chapterLengthsFromKeys(keys) {
  const byBook = /* @__PURE__ */ new Map();
  const key = /^(.+) (\d+):(\d+)$/;
  for (const k of keys) {
    const m = key.exec(k);
    if (!m) continue;
    const book = canonicalBook(m[1]) ?? m[1];
    let lengths = byBook.get(book);
    if (!lengths) byBook.set(book, lengths = /* @__PURE__ */ new Map());
    const c = +m[2];
    const v = +m[3];
    if ((lengths.get(c) ?? 0) < v) lengths.set(c, v);
  }
  return (book) => byBook.get(book) ?? null;
}
function chapterLengthsFromTable(table) {
  const byBook = /* @__PURE__ */ new Map();
  for (const [book, counts] of Object.entries(table)) {
    byBook.set(canonicalBook(book) ?? book, new Map(counts.map((n, i) => [i + 1, n])));
  }
  return (book) => byBook.get(book) ?? null;
}
function resolvePassage(bookName, spec, lengths, options = {}) {
  const book = canonicalBook(bookName) ?? bookName;
  const out = { book, verses: [], problems: [], continuesThrough: null };
  const chapters = lengths(book);
  if (!chapters) {
    out.problems.push(`no book "${bookName}"`);
    return out;
  }
  const items = parseSpec(spec);
  if (!items) {
    out.problems.push(`can't read "${spec}"`);
    return out;
  }
  const seen = /* @__PURE__ */ new Set();
  const problem = (p) => {
    if (!out.problems.includes(p)) out.problems.push(p);
  };
  const add = (c, v) => {
    const last = chapters.get(c);
    if (last == null) return problem(`${book} ${c} does not exist`);
    if (v < 1 || v > last) return problem(`${book} ${c}:${v} does not exist (${book} ${c} has ${last} verses)`);
    const k = `${c}:${v}`;
    if (seen.has(k)) return;
    seen.add(k);
    out.verses.push({ chapter: c, verse: v });
  };
  const span = (c, from, to) => {
    const last = chapters.get(c);
    if (last == null) return add(c, from);
    for (let v = from; v <= to; v++) {
      if (v > last) return add(c, v);
      add(c, v);
    }
  };
  const through = (c1, v1, c2, v2) => {
    if (c2 < c1 || c2 === c1 && v2 < v1) {
      problem(`${book} ${c1}:${v1}\u2013${c2}:${v2} runs backwards`);
      return add(c1, v1);
    }
    for (let c = c1; c <= c2; c++) {
      const last = chapters.get(c);
      if (last == null) {
        add(c, 1);
        continue;
      }
      span(c, c === c1 ? v1 : 1, c === c2 ? v2 : last);
    }
  };
  let chapter = ONE_CHAPTER_BOOKS.has(book) ? 1 : null;
  for (const { a, aVerse, b, bVerse } of items) {
    if (aVerse != null) {
      chapter = a;
      if (b == null) add(a, aVerse);
      else if (bVerse == null) {
        if (b < aVerse) {
          problem(`${book} ${a}:${aVerse}\u2013${b} runs backwards`);
          add(a, aVerse);
        } else span(a, aVerse, b);
      } else through(a, aVerse, b, bVerse);
    } else if (chapter != null) {
      if (b == null) add(chapter, a);
      else if (bVerse == null) {
        if (b < a) {
          problem(`${book} ${chapter}:${a}\u2013${b} runs backwards`);
          add(chapter, a);
        } else span(chapter, a, b);
      } else through(chapter, a, b, bVerse);
    } else {
      const end = b ?? a;
      if (end < a) {
        problem(`${book} ${a}\u2013${end} runs backwards`);
        through(a, 1, a, chapters.get(a) ?? 1);
      } else through(a, 1, end, bVerse ?? chapters.get(end) ?? 1);
    }
  }
  const max = options.maxChapters;
  if (max != null && max > 0) {
    let n = 0;
    let prev = null;
    const cut = out.verses.findIndex((v) => {
      if (v.chapter !== prev) {
        prev = v.chapter;
        n++;
      }
      return n > max;
    });
    if (cut >= 0) {
      out.continuesThrough = out.verses[out.verses.length - 1];
      out.verses = out.verses.slice(0, cut);
    }
  }
  return out;
}
function formatPassage(bookName, verses, lengths) {
  const book = canonicalBook(bookName) ?? bookName;
  if (!verses.length) return book;
  const chapters = lengths?.(book) ?? null;
  const one = ONE_CHAPTER_BOOKS.has(book);
  const runs = [];
  for (const v of verses) {
    const run = runs[runs.length - 1];
    const end = run?.[1];
    const next = end && (v.chapter === end.chapter && v.verse === end.verse + 1 || v.chapter === end.chapter + 1 && v.verse === 1 && chapters?.get(end.chapter) === end.verse);
    if (next) run[1] = v;
    else runs.push([v, v]);
  }
  let out = "";
  let inChapter = null;
  for (const [a, b] of runs) {
    const sameChapter = a.chapter === b.chapter;
    let part;
    if (one && a.chapter === 1 && b.chapter === 1) part = a.verse === b.verse ? `${a.verse}` : `${a.verse}\u2013${b.verse}`;
    else if (sameChapter && a.chapter === inChapter) part = a.verse === b.verse ? `${a.verse}` : `${a.verse}\u2013${b.verse}`;
    else if (sameChapter) part = a.verse === b.verse ? `${a.chapter}:${a.verse}` : `${a.chapter}:${a.verse}\u2013${b.verse}`;
    else part = `${a.chapter}:${a.verse}\u2013${b.chapter}:${b.verse}`;
    if (out) out += a.chapter === inChapter && sameChapter ? ", " : "; ";
    out += part;
    inChapter = b.chapter;
  }
  return `${book} ${out}`;
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  BOOKS,
  CHAPTER_COUNTS,
  DASH,
  ITEM,
  LIST,
  ONE_CHAPTER_BOOKS,
  TEXT_ABBREVIATIONS,
  TEXT_NAMES,
  bookAt,
  bookContext,
  canonicalBook,
  chapterLengthsFromKeys,
  chapterLengthsFromTable,
  findReferences,
  formatPassage,
  looksLikeClockTime,
  normalizeSpec,
  parseSpec,
  resolvePassage
});
