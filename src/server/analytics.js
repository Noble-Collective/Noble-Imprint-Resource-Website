// First-party site analytics — ingestion + BigQuery sink.
//
// P0 scope: accept beacon events (pageview + dwell heartbeats) at
// POST /api/analytics/collect, enrich server-side with the fields the client
// must NOT be trusted for (ts, ip_hash, is_bot, user_email), do a coarse
// path -> content classification, and stream rows into BigQuery
// `analytics.events`. Device/browser/os + geo come in P1; audio events in P2.
//
// Design notes:
//  - Best-effort: analytics must NEVER break a page. Every failure is swallowed
//    and logged; readers are unaffected.
//  - The raw `path` is stored verbatim, so even where the coarse content parse
//    is approximate (subseries book-index vs series/book/session are
//    ambiguous without the content tree), the exact identity can be recovered
//    or re-labelled later.

const crypto = require('crypto');
const { BigQuery } = require('@google-cloud/bigquery');

const DATASET = process.env.BQ_ANALYTICS_DATASET || 'analytics';
const TABLE = process.env.BQ_ANALYTICS_TABLE || 'events';
const IP_SALT = process.env.ANALYTICS_IP_SALT || 'dev-unsalted-change-me';
const ENABLED = process.env.ANALYTICS_ENABLED !== 'false'; // on unless explicitly disabled

const FLUSH_MS = 5000;   // flush the buffer at least this often
const FLUSH_MAX = 50;    // ...or as soon as it reaches this many rows
const MAX_EVENTS_PER_REQUEST = 50;

const PROJECT_ID = process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT || 'noble-imprint-website';

let bq = null;
function client() {
  // Credentials from ADC (local key / Cloud Run SA); project pinned explicitly
  // because the SA key's project isn't always auto-detected.
  if (!bq) bq = new BigQuery({ projectId: PROJECT_ID });
  return bq;
}

// --- buffered streaming insert -------------------------------------------------

let buffer = [];
let flushTimer = null;

function scheduleFlush() {
  if (flushTimer) return;
  flushTimer = setTimeout(() => { flush().catch(() => {}); }, FLUSH_MS);
  if (flushTimer.unref) flushTimer.unref(); // don't keep the process alive
}

async function flush() {
  if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
  if (!buffer.length) return;
  const rows = buffer;
  buffer = [];
  try {
    await client().dataset(DATASET).table(TABLE).insert(rows, { ignoreUnknownValues: true });
  } catch (err) {
    // Surface BigQuery partial-row errors compactly; drop the batch (best-effort).
    const detail = err && err.errors ? JSON.stringify(err.errors).slice(0, 500) : (err && err.message) || String(err);
    console.error(`[ANALYTICS] insert of ${rows.length} row(s) failed: ${detail}`);
  }
}

// --- enrichment helpers --------------------------------------------------------

function hashIp(ip) {
  return crypto.createHash('sha256').update(`${IP_SALT}|${ip || ''}`).digest('hex').slice(0, 32);
}

// Conservative UA-based bot classification. Flagged, not dropped, so dashboards
// can include/exclude. Refined with datacenter-IP heuristics later (P5).
const BOT_RE = /bot|crawl|spider|slurp|bing|yandex|baidu|duckduck|semrush|ahrefs|facebookexternal|python-|curl|wget|monitor|uptime|headless|scan|census|expanse|masscan|gptbot|claudebot|ccbot|dataforseo|meta-external|preview|fetch\b|http-client|axios|okhttp|java\//i;
function isBot(ua) { return BOT_RE.test(ua || ''); }

const RESERVED_FIRST_SEG = new Set(['admin', 'api', 'notifications', 'static', 'cover', 'image', 'login', 'profile', 'logout']);

// Coarse URL -> content identity. Bible + home are exact; book/session are
// best-effort (see file header). Never touches the content tree (no I/O, no
// rate-limit cost).
function parsePath(rawPath) {
  const out = {
    content_type: 'other', series: null, book: null, session: null,
    bible_translation: null, bible_book: null, bible_chapter: null,
  };
  const clean = String(rawPath || '/').split('?')[0].split('#')[0];
  const segs = clean.split('/').filter(Boolean).map((s) => { try { return decodeURIComponent(s); } catch { return s; } });

  if (segs.length === 0) { out.content_type = 'home'; return out; }

  const first = segs[0].toLowerCase();
  if (first === 'bible') {
    out.bible_translation = segs[1] || null;
    out.bible_book = segs[2] || null;
    out.bible_chapter = segs[3] || null;
    out.content_type = segs.length >= 4 ? 'bible_chapter' : (segs.length === 3 ? 'bible_book' : 'bible_index');
    return out;
  }
  if (RESERVED_FIRST_SEG.has(first)) { out.content_type = first; return out; }

  // Content hierarchy: series / (subseries) / book / (session).
  out.series = segs[0];
  if (segs.length === 1) {
    out.content_type = 'series_index';
  } else if (segs.length === 2) {
    out.book = segs[1];
    out.content_type = 'book_index';
  } else {
    // A session page is always a leaf: .../book/session. book is second-to-last,
    // session is last, regardless of subseries depth. (Ambiguous only for a
    // 3-segment subseries book-index; raw path retained for exact re-derivation.)
    out.book = segs[segs.length - 2];
    out.session = segs[segs.length - 1];
    out.content_type = 'book_session';
  }
  return out;
}

// --- field coercion ------------------------------------------------------------

function str(v, max) {
  if (v == null) return null;
  const s = String(v);
  return s.length > max ? s.slice(0, max) : s;
}
function int(v) { const n = parseInt(v, 10); return Number.isFinite(n) ? n : null; }
function flt(v) { const n = parseFloat(v); return Number.isFinite(n) ? n : null; }

// Keep only external referrers (drop same-origin navigation noise).
function cleanReferrer(ref, host) {
  if (!ref) return null;
  try {
    const u = new URL(ref);
    if (host && u.host === host) return null;
    return `${u.protocol}//${u.host}${u.pathname}`;
  } catch {
    return null;
  }
}

// --- public API ----------------------------------------------------------------

function record(req, ev) {
  if (!ENABLED || !ev || typeof ev !== 'object') return;
  const ua = req.get('user-agent') || '';
  const parsed = parsePath(ev.path);
  const row = {
    event_id: str(ev.event_id, 64) || crypto.randomUUID(),
    ts: new Date().toISOString(),
    session_id: str(ev.session_id, 64),
    visitor_id: str(ev.visitor_id, 64),
    event_type: str(ev.event_type, 32) || 'unknown',
    path: str(ev.path, 1024),
    referrer: cleanReferrer(ev.referrer, req.get('host')),
    ...parsed,
    dwell_ms: int(ev.dwell_ms),
    scroll_depth: flt(ev.scroll_depth),
    audio_position_sec: flt(ev.audio_position_sec),
    audio_duration_sec: flt(ev.audio_duration_sec),
    audio_percent: flt(ev.audio_percent),
    device_type: null, // P1
    browser: null,     // P1
    os: null,          // P1
    country: null,     // P1
    is_bot: isBot(ua),
    ip_hash: hashIp(req.ip),
    user_email: (req.user && req.user.email) || null,
  };
  buffer.push(row);
  if (buffer.length >= FLUSH_MAX) flush().catch(() => {});
  else scheduleFlush();
}

// Express handler for POST /api/analytics/collect. Accepts a single event object
// or { events: [...] }. Always 204 (beacons ignore the response body).
function collect(req, res) {
  try {
    const body = req.body || {};
    const events = Array.isArray(body.events) ? body.events : [body];
    for (const ev of events.slice(0, MAX_EVENTS_PER_REQUEST)) record(req, ev);
  } catch (err) {
    console.error('[ANALYTICS] collect error:', err && err.message);
  }
  res.status(204).end();
}

module.exports = { collect, record, flush, parsePath, isBot, _table: `${DATASET}.${TABLE}` };
