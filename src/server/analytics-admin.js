// Admin analytics dashboard — BigQuery aggregations for /admin (P3).
//
// getDashboard(range, { includeBots }) runs all views in parallel and returns a
// single JSON payload the client renders as charts. Read-only; admin-gated by the
// route. Groups content by the stable content_id (falling back to title for
// pre-registry / bot rows) so renamed books/sessions stay unified, and shows the
// most-recent title for each.

const { BigQuery } = require('@google-cloud/bigquery');

const PROJECT_ID = process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT || 'noble-imprint-website';
const DATASET = process.env.BQ_ANALYTICS_DATASET || 'analytics';
const TABLE = process.env.BQ_ANALYTICS_TABLE || 'events';
const FQ = '`' + `${PROJECT_ID}.${DATASET}.${TABLE}` + '`';

let bq = null;
function client() {
  if (!bq) bq = new BigQuery({ projectId: PROJECT_ID });
  return bq;
}

const RANGE_DAYS = { '7d': 7, '30d': 30, '90d': 90, '365d': 365 };

// Base filter conditions for the selected range + bot policy. `range` is
// validated against the whitelist, so nothing here is raw user input.
function baseConditions(range, includeBots) {
  const days = RANGE_DAYS[range]; // undefined => 'all'
  const c = [];
  if (days) c.push(`ts >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL ${days} DAY)`);
  if (!includeBots) c.push('NOT IFNULL(is_bot, FALSE)');
  return c;
}
// Compose a WHERE clause from conditions (drops falsy, prefixes WHERE if any).
function whereOf(...cond) {
  const c = cond.flat().filter(Boolean);
  return c.length ? 'WHERE ' + c.join(' AND ') : '';
}

async function q(sql, params) {
  const [rows] = await client().query({ query: sql, location: 'US', params: params || {} });
  return rows;
}

async function getDashboard(range = '30d', opts = {}) {
  const includeBots = !!opts.includeBots;
  if (range !== 'all' && !RANGE_DAYS[range]) range = '30d';
  const book = opts.book ? String(opts.book) : null; // filter to one book's title
  const base = baseConditions(range, includeBots);
  if (book) base.push('book = @book');
  const params = book ? { book } : undefined;
  const run = (sql) => q(sql, params); // thread the @book param through every query

  const [
    totals, trend, topBooks, topSessions, topBible, contentSplit,
    devices, browsers, os, countries, referrers, audio, dwellTop,
  ] = await Promise.all([
    // headline totals
    run(`SELECT
         COUNTIF(event_type='pageview') AS pageviews,
         COUNT(DISTINCT visitor_id) AS visitors,
         COUNT(DISTINCT session_id) AS sessions,
         ROUND(SUM(IFNULL(dwell_ms,0))/60000, 1) AS engaged_minutes
       FROM ${FQ} ${whereOf(base)}`),
    // daily traffic trend
    run(`SELECT FORMAT_DATE('%Y-%m-%d', DATE(ts)) AS day,
              COUNTIF(event_type='pageview') AS pageviews,
              COUNT(DISTINCT visitor_id) AS visitors
       FROM ${FQ} ${whereOf(base)} GROUP BY day ORDER BY day`),
    // top books
    run(`SELECT ARRAY_AGG(book ORDER BY ts DESC LIMIT 1)[OFFSET(0)] AS label,
              COUNTIF(event_type='pageview') AS pageviews,
              COUNT(DISTINCT visitor_id) AS visitors
       FROM ${FQ} ${whereOf(base, "content_type='book_session'", 'book IS NOT NULL')}
       GROUP BY COALESCE(content_id, book)
       ORDER BY pageviews DESC LIMIT 15`),
    // top sessions
    run(`SELECT ARRAY_AGG(book ORDER BY ts DESC LIMIT 1)[OFFSET(0)] AS book,
              ARRAY_AGG(session ORDER BY ts DESC LIMIT 1)[OFFSET(0)] AS session,
              COUNTIF(event_type='pageview') AS pageviews,
              COUNT(DISTINCT visitor_id) AS visitors
       FROM ${FQ} ${whereOf(base, "content_type='book_session'", 'session IS NOT NULL')}
       GROUP BY COALESCE(content_id, CONCAT(IFNULL(book,''),'|',IFNULL(session,'')))
       ORDER BY pageviews DESC LIMIT 15`),
    // top bible chapters
    run(`SELECT CONCAT(IFNULL(bible_book,'?'), ' ', IFNULL(bible_chapter,'')) AS label,
              ANY_VALUE(bible_translation) AS translation,
              COUNTIF(event_type='pageview') AS pageviews,
              COUNT(DISTINCT visitor_id) AS visitors
       FROM ${FQ} ${whereOf(base, "content_type='bible_chapter'", 'bible_book IS NOT NULL')}
       GROUP BY label ORDER BY pageviews DESC LIMIT 15`),
    // content split (Bible vs Books vs Home vs Other)
    run(`SELECT
         CASE
           WHEN content_type IN ('bible_chapter','bible_book','bible_index') THEN 'Bible'
           WHEN content_type IN ('book_session','book_index','series_index') THEN 'Books'
           WHEN content_type='home' THEN 'Home'
           ELSE 'Other'
         END AS category,
         COUNTIF(event_type='pageview') AS pageviews
       FROM ${FQ} ${whereOf(base)} GROUP BY category ORDER BY pageviews DESC`),
    // device / browser / os / country / referrer
    run(`SELECT IFNULL(device_type,'unknown') AS label, COUNTIF(event_type='pageview') AS pageviews
       FROM ${FQ} ${whereOf(base)} GROUP BY label ORDER BY pageviews DESC`),
    run(`SELECT IFNULL(browser,'unknown') AS label, COUNTIF(event_type='pageview') AS pageviews
       FROM ${FQ} ${whereOf(base)} GROUP BY label ORDER BY pageviews DESC LIMIT 8`),
    run(`SELECT IFNULL(os,'unknown') AS label, COUNTIF(event_type='pageview') AS pageviews
       FROM ${FQ} ${whereOf(base)} GROUP BY label ORDER BY pageviews DESC LIMIT 8`),
    run(`SELECT IFNULL(country,'unknown') AS label, COUNT(DISTINCT visitor_id) AS visitors
       FROM ${FQ} ${whereOf(base)} GROUP BY label ORDER BY visitors DESC LIMIT 12`),
    run(`SELECT referrer AS label, COUNTIF(event_type='pageview') AS pageviews
       FROM ${FQ} ${whereOf(base, 'referrer IS NOT NULL')}
       GROUP BY label ORDER BY pageviews DESC LIMIT 10`),
    // audio: plays, listeners, completions, avg % heard on end
    run(`SELECT
         COUNTIF(event_type='audio_play') AS plays,
         COUNT(DISTINCT IF(event_type='audio_play', visitor_id, NULL)) AS listeners,
         COUNTIF(event_type='audio_ended') AS completions,
         ROUND(AVG(IF(event_type='audio_ended', audio_percent, NULL)), 3) AS avg_pct_on_end
       FROM ${FQ} ${whereOf(base)}`),
    // dwell per top content (avg engaged seconds per pageview)
    run(`SELECT ARRAY_AGG(book ORDER BY ts DESC LIMIT 1)[OFFSET(0)] AS book,
              ARRAY_AGG(session ORDER BY ts DESC LIMIT 1)[OFFSET(0)] AS session,
              ROUND(SUM(IFNULL(dwell_ms,0))/1000.0 / NULLIF(COUNTIF(event_type='pageview'),0), 0) AS avg_dwell_sec,
              COUNTIF(event_type='pageview') AS pageviews
       FROM ${FQ} ${whereOf(base, "content_type='book_session'", 'session IS NOT NULL')}
       GROUP BY COALESCE(content_id, CONCAT(IFNULL(book,''),'|',IFNULL(session,'')))
       HAVING pageviews >= 1 ORDER BY avg_dwell_sec DESC LIMIT 10`),
  ]);

  return {
    range, includeBots, book: book || null,
    totals: totals[0] || {},
    trend, topBooks, topSessions, topBible, contentSplit,
    devices, browsers, os, countries, referrers,
    audio: audio[0] || {}, dwellTop,
  };
}

// ---- Book comparison (leaderboard + scatter + multi-book trend) ----

function findBookByTitle(tree, title) {
  for (const s of (tree.series || [])) {
    for (const child of (s.children || [])) {
      if (child.type === 'book' && child.title === title) return child;
      if (child.type === 'subseries') {
        for (const b of (child.books || [])) if (b.title === title) return b;
      }
    }
  }
  return null;
}

async function getBooksComparison(range = '30d', opts = {}) {
  const includeBots = !!opts.includeBots;
  if (range !== 'all' && !RANGE_DAYS[range]) range = '30d';
  const base = baseConditions(range, includeBots);

  // One row per book (grouped by title). readers=unique visitors, depth via
  // distinct sessions viewed + avg dwell, plus audio.
  const leaderboard = await q(`
    SELECT book,
      COUNT(DISTINCT visitor_id) AS readers,
      COUNTIF(event_type='pageview') AS pageviews,
      COUNT(DISTINCT session) AS sessions_viewed,
      ROUND(SUM(IFNULL(dwell_ms,0))/1000.0 / NULLIF(COUNTIF(event_type='pageview'),0), 0) AS avg_dwell_sec,
      COUNTIF(event_type='audio_play') AS audio_plays,
      ROUND(AVG(IF(event_type='audio_ended', audio_percent, NULL)), 3) AS avg_pct_heard
    FROM ${FQ} ${whereOf(base, "content_type='book_session'", 'book IS NOT NULL')}
    GROUP BY book ORDER BY pageviews DESC`);

  // Daily traffic for the top books, for the overlay chart.
  const top = leaderboard.slice(0, 8).map((r) => r.book);
  let trend = [];
  if (top.length) {
    trend = await q(`
      SELECT book, FORMAT_DATE('%Y-%m-%d', DATE(ts)) AS day, COUNTIF(event_type='pageview') AS pageviews
      FROM ${FQ} ${whereOf(base, "content_type='book_session'", 'book IN UNNEST(@books)')}
      GROUP BY book, day ORDER BY day`, { books: top });
  }
  return { range, includeBots, leaderboard, trend, topBooks: top };
}

// ---- Within-book drop-off funnel (session-by-session retention) ----

async function getBookFunnel(range = '30d', opts = {}, bookTitle = null) {
  const includeBots = !!opts.includeBots;
  if (!bookTitle) return { book: null, steps: [] };
  if (range !== 'all' && !RANGE_DAYS[range]) range = '30d';
  const base = baseConditions(range, includeBots);
  base.push('book = @book');

  const rows = await q(`
    SELECT session, COUNT(DISTINCT visitor_id) AS readers, COUNTIF(event_type='pageview') AS pageviews
    FROM ${FQ} ${whereOf(base, "content_type='book_session'", 'session IS NOT NULL')}
    GROUP BY session`, { book: bookTitle });
  const byTitle = {};
  rows.forEach((r) => { byTitle[r.session] = r; });

  // Order by the book's real session sequence (from the content tree), so even
  // never-viewed sessions show the drop to zero.
  const content = require('./content');
  const tree = await content.buildContentTree();
  const bookNode = findBookByTitle(tree, bookTitle);
  let steps = [];
  if (bookNode) {
    await content.loadSessionTitles(bookNode);
    steps = (bookNode.sessions || [])
      .map((s) => ({ num: content.sessionNumber(bookNode, s), title: s.title || s.displayName }))
      .filter((s) => s.num !== '' && s.num != null)
      .sort((a, b) => parseInt(a.num, 10) - parseInt(b.num, 10))
      .map((s) => ({ n: String(s.num), title: s.title, readers: byTitle[s.title] ? byTitle[s.title].readers : 0, pageviews: byTitle[s.title] ? byTitle[s.title].pageviews : 0 }));
  }
  if (!steps.length) {
    // Fallback: whatever sessions have data, by pageviews (unordered).
    steps = rows.sort((a, b) => b.pageviews - a.pageviews).map((r) => ({ n: '', title: r.session, readers: r.readers, pageviews: r.pageviews }));
  }
  return { book: bookTitle, steps };
}

module.exports = { getDashboard, getBooksComparison, getBookFunnel };
