// GET /api/home — shared Home content for every Noble Collective product (the app first; later this
// site, Coram Deo, the Institute). Curated/editorial pieces only: Resource of the day + Partner with
// us. Personal pieces (Continue reading, notebook) come from the shared user-data store via the SDK's
// dashboard selectors, not from here. Plan: plans/2026-09-24-api-home-endpoint.md and
// Collective-Shared/plans/2026-09-24-shared-home-dashboard.md.
//
// Config lives in this site's Firestore (`siteConfig/home`), edited from the admin console's Home tab,
// so what shows can change without a deploy or an app release.

const admin = require('firebase-admin');
const content = require('./content');

const CONFIG_COLLECTION = 'siteConfig';
const CONFIG_DOC = 'home';

// Starting list (Steve, 2026-09-24): the audiobooks, minus the Bible and L'Appel du Christ (both have
// audio; left out by choice).
const DEFAULT_CONFIG = Object.freeze({
  resourceOfTheDay: {
    books: [
      'series/Narrative Journey Series/Foundations/The Call of Christ',
      'series/Passage Series/HomeStead',
      'series/Vade Mecum/Proverbs and Faith Formation',
      'series/A Library of Classics/A Pastoral Shelf/Oration II',
      'series/A Library of Classics/A Philosophical Shelf/On the Shortness of Life',
    ],
    excludeSessions: {},
  },
  partner: {
    title: 'Partner with us',
    body: 'Keep these books and Bibles free for every church.',
    buttonLabel: 'Donate',
    url: 'https://give.noblecollective.org/',
  },
});

const SITE_ORIGIN = process.env.PUBLIC_SITE_ORIGIN || 'https://resources.noblecollective.org';

// ---------------------------------------------------------------------------
// Pure helpers (unit-tested)
// ---------------------------------------------------------------------------

/** 'YYYY-MM-DD' → that calendar date's day number (UTC midnight / 86400000), or null. */
function dayNumberOf(dateKey) {
  if (typeof dateKey !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) return null;
  const ms = Date.parse(dateKey + 'T00:00:00Z');
  return Number.isFinite(ms) ? Math.floor(ms / 86400000) : null;
}

/** Today's date key in America/New_York (fallback when the caller doesn't send its local date). */
function todayKeyNewYork(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  return parts; // en-CA formats as YYYY-MM-DD
}

/** Merge a stored config over the defaults, keeping only known, well-typed fields. */
function normalizeConfig(stored) {
  const s = stored && typeof stored === 'object' ? stored : {};
  const rotd = s.resourceOfTheDay && typeof s.resourceOfTheDay === 'object' ? s.resourceOfTheDay : {};
  const books = Array.isArray(rotd.books) ? rotd.books.filter((b) => typeof b === 'string' && b.trim()) : DEFAULT_CONFIG.resourceOfTheDay.books;
  const excl = rotd.excludeSessions && typeof rotd.excludeSessions === 'object' ? rotd.excludeSessions : {};
  const excludeSessions = {};
  for (const [bp, files] of Object.entries(excl)) {
    if (Array.isArray(files)) excludeSessions[bp] = files.filter((f) => typeof f === 'string');
  }
  const p = s.partner && typeof s.partner === 'object' ? s.partner : {};
  const str = (v, d, max = 300) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : d);
  const url = str(p.url, DEFAULT_CONFIG.partner.url, 500);
  return {
    resourceOfTheDay: { books, excludeSessions },
    partner: {
      title: str(p.title, DEFAULT_CONFIG.partner.title, 80),
      body: str(p.body, DEFAULT_CONFIG.partner.body, 300),
      buttonLabel: str(p.buttonLabel, DEFAULT_CONFIG.partner.buttonLabel, 40),
      url: /^https:\/\//i.test(url) ? url : DEFAULT_CONFIG.partner.url,
    },
  };
}

/**
 * The eligible sessions, in rotation order: the configured books in list order; within a book its
 * sessions in order, keeping only real sessions (the site's own numbered-session rule — front matter,
 * orientation and similar have no number) and dropping per-book exclusions. Books missing from the
 * tree (renamed/unpublished) are skipped. Only public books.
 */
function eligibleSessions(tree, config) {
  const perBook = [];
  for (const bookPath of config.resourceOfTheDay.books) {
    const hit = content.findByRepoPath(tree, bookPath, null);
    if (!hit || !hit.book || (hit.book.status || 'public') !== 'public') continue;
    const excluded = new Set(config.resourceOfTheDay.excludeSessions[bookPath] || []);
    const list = [];
    for (const session of hit.book.sessions || []) {
      if (excluded.has(session.filename)) continue;
      if (content.sessionNumber(hit.book, session) === '') continue;
      list.push({ series: hit.series, subseries: hit.subseries, book: hit.book, session });
    }
    if (list.length) perBook.push(list);
  }
  // Interleave the books (round-robin: each book's 1st session, then each book's 2nd, …) so
  // consecutive days bring different books instead of one book for a week.
  const out = [];
  const longest = Math.max(0, ...perBook.map((l) => l.length));
  for (let i = 0; i < longest; i++) {
    for (const list of perBook) if (i < list.length) out.push(list[i]);
  }
  return out;
}

/** Deterministic pick for a date: same date ⇒ same session for everyone. Not random. */
function pickForDate(eligible, dateKey) {
  const day = dayNumberOf(dateKey);
  if (!eligible.length || day == null) return null;
  const n = eligible.length;
  return eligible[((day % n) + n) % n];
}

/** The ready-to-show card for a picked session. */
function toCard(pick) {
  if (!pick) return null;
  const { series, subseries, book, session } = pick;
  const audio = book.audiobook;
  return {
    bookPath: book.repoPath,
    sessionFile: session.filename,
    sessionTitle: session.title || session.displayName || session.filename,
    bookTitle: book.title,
    subtitle: book.subtitle || '',
    accent: book.accent || null,
    hasAudio: !!(audio && audio.enabled === true),
    webUrl: SITE_ORIGIN + content.sessionUrl(series, subseries, book, session),
  };
}

/** The whole /api/home payload (pure given a tree + config). */
function buildHome(tree, config, dateKey) {
  const eligible = eligibleSessions(tree, config);
  return {
    date: dateKey,
    resourceOfTheDay: toCard(pickForDate(eligible, dateKey)),
    partner: { ...config.partner },
    version: 1,
  };
}

/** The next `days` picks from `startKey` (admin preview). */
function previewPicks(tree, config, startKey, days = 14) {
  const eligible = eligibleSessions(tree, config);
  const start = dayNumberOf(startKey);
  if (start == null) return [];
  const out = [];
  for (let i = 0; i < days; i++) {
    const key = new Date((start + i) * 86400000).toISOString().slice(0, 10);
    const card = toCard(pickForDate(eligible, key));
    out.push({ date: key, sessionTitle: card?.sessionTitle || null, bookTitle: card?.bookTitle || null });
  }
  return { eligibleCount: eligible.length, picks: out };
}

// ---------------------------------------------------------------------------
// Config I/O (Firestore, cached)
// ---------------------------------------------------------------------------

let cached = null;
let cachedAt = 0;
const CONFIG_TTL_MS = 5 * 60 * 1000;

async function getConfig({ fresh = false } = {}) {
  if (!fresh && cached && Date.now() - cachedAt < CONFIG_TTL_MS) return cached;
  try {
    const snap = await admin.firestore().collection(CONFIG_COLLECTION).doc(CONFIG_DOC).get();
    cached = normalizeConfig(snap.exists ? snap.data() : null);
  } catch (err) {
    console.error('[home] config read failed, using defaults:', err.message);
    cached = cached || normalizeConfig(null);
  }
  cachedAt = Date.now();
  return cached;
}

/** Validate + save a config from the admin editor. Returns the normalized config. */
async function saveConfig(input, byEmail) {
  const cfg = normalizeConfig(input);
  await admin.firestore().collection(CONFIG_COLLECTION).doc(CONFIG_DOC).set({
    ...cfg,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedBy: byEmail || null,
  });
  cached = cfg;
  cachedAt = Date.now();
  return cfg;
}

module.exports = {
  DEFAULT_CONFIG,
  dayNumberOf,
  todayKeyNewYork,
  normalizeConfig,
  eligibleSessions,
  pickForDate,
  toCard,
  buildHome,
  previewPicks,
  getConfig,
  saveConfig,
};
