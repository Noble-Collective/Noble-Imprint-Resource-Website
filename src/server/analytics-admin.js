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

async function q(sql) {
  const [rows] = await client().query({ query: sql, location: 'US' });
  return rows;
}

async function getDashboard(range = '30d', opts = {}) {
  const includeBots = !!opts.includeBots;
  if (range !== 'all' && !RANGE_DAYS[range]) range = '30d';
  const base = baseConditions(range, includeBots);

  const [
    totals, trend, topBooks, topSessions, topBible, contentSplit,
    devices, browsers, os, countries, referrers, audio, dwellTop,
  ] = await Promise.all([
    // headline totals
    q(`SELECT
         COUNTIF(event_type='pageview') AS pageviews,
         COUNT(DISTINCT visitor_id) AS visitors,
         COUNT(DISTINCT session_id) AS sessions,
         ROUND(SUM(IFNULL(dwell_ms,0))/60000, 1) AS engaged_minutes
       FROM ${FQ} ${whereOf(base)}`),
    // daily traffic trend
    q(`SELECT FORMAT_DATE('%Y-%m-%d', DATE(ts)) AS day,
              COUNTIF(event_type='pageview') AS pageviews,
              COUNT(DISTINCT visitor_id) AS visitors
       FROM ${FQ} ${whereOf(base)} GROUP BY day ORDER BY day`),
    // top books
    q(`SELECT ARRAY_AGG(book ORDER BY ts DESC LIMIT 1)[OFFSET(0)] AS label,
              COUNTIF(event_type='pageview') AS pageviews,
              COUNT(DISTINCT visitor_id) AS visitors
       FROM ${FQ} ${whereOf(base, "content_type='book_session'", 'book IS NOT NULL')}
       GROUP BY COALESCE(content_id, book)
       ORDER BY pageviews DESC LIMIT 15`),
    // top sessions
    q(`SELECT ARRAY_AGG(book ORDER BY ts DESC LIMIT 1)[OFFSET(0)] AS book,
              ARRAY_AGG(session ORDER BY ts DESC LIMIT 1)[OFFSET(0)] AS session,
              COUNTIF(event_type='pageview') AS pageviews,
              COUNT(DISTINCT visitor_id) AS visitors
       FROM ${FQ} ${whereOf(base, "content_type='book_session'", 'session IS NOT NULL')}
       GROUP BY COALESCE(content_id, CONCAT(IFNULL(book,''),'|',IFNULL(session,'')))
       ORDER BY pageviews DESC LIMIT 15`),
    // top bible chapters
    q(`SELECT CONCAT(IFNULL(bible_book,'?'), ' ', IFNULL(bible_chapter,'')) AS label,
              ANY_VALUE(bible_translation) AS translation,
              COUNTIF(event_type='pageview') AS pageviews,
              COUNT(DISTINCT visitor_id) AS visitors
       FROM ${FQ} ${whereOf(base, "content_type='bible_chapter'", 'bible_book IS NOT NULL')}
       GROUP BY label ORDER BY pageviews DESC LIMIT 15`),
    // content split (Bible vs Books vs Home vs Other)
    q(`SELECT
         CASE
           WHEN content_type IN ('bible_chapter','bible_book','bible_index') THEN 'Bible'
           WHEN content_type IN ('book_session','book_index','series_index') THEN 'Books'
           WHEN content_type='home' THEN 'Home'
           ELSE 'Other'
         END AS category,
         COUNTIF(event_type='pageview') AS pageviews
       FROM ${FQ} ${whereOf(base)} GROUP BY category ORDER BY pageviews DESC`),
    // device / browser / os / country / referrer
    q(`SELECT IFNULL(device_type,'unknown') AS label, COUNTIF(event_type='pageview') AS pageviews
       FROM ${FQ} ${whereOf(base)} GROUP BY label ORDER BY pageviews DESC`),
    q(`SELECT IFNULL(browser,'unknown') AS label, COUNTIF(event_type='pageview') AS pageviews
       FROM ${FQ} ${whereOf(base)} GROUP BY label ORDER BY pageviews DESC LIMIT 8`),
    q(`SELECT IFNULL(os,'unknown') AS label, COUNTIF(event_type='pageview') AS pageviews
       FROM ${FQ} ${whereOf(base)} GROUP BY label ORDER BY pageviews DESC LIMIT 8`),
    q(`SELECT IFNULL(country,'unknown') AS label, COUNT(DISTINCT visitor_id) AS visitors
       FROM ${FQ} ${whereOf(base)} GROUP BY label ORDER BY visitors DESC LIMIT 12`),
    q(`SELECT referrer AS label, COUNTIF(event_type='pageview') AS pageviews
       FROM ${FQ} ${whereOf(base, 'referrer IS NOT NULL')}
       GROUP BY label ORDER BY pageviews DESC LIMIT 10`),
    // audio: plays, listeners, completions, avg % heard on end
    q(`SELECT
         COUNTIF(event_type='audio_play') AS plays,
         COUNT(DISTINCT IF(event_type='audio_play', visitor_id, NULL)) AS listeners,
         COUNTIF(event_type='audio_ended') AS completions,
         ROUND(AVG(IF(event_type='audio_ended', audio_percent, NULL)), 3) AS avg_pct_on_end
       FROM ${FQ} ${whereOf(base)}`),
    // dwell per top content (avg engaged seconds per pageview)
    q(`SELECT ARRAY_AGG(book ORDER BY ts DESC LIMIT 1)[OFFSET(0)] AS book,
              ARRAY_AGG(session ORDER BY ts DESC LIMIT 1)[OFFSET(0)] AS session,
              ROUND(SUM(IFNULL(dwell_ms,0))/1000.0 / NULLIF(COUNTIF(event_type='pageview'),0), 0) AS avg_dwell_sec,
              COUNTIF(event_type='pageview') AS pageviews
       FROM ${FQ} ${whereOf(base, "content_type='book_session'", 'session IS NOT NULL')}
       GROUP BY COALESCE(content_id, CONCAT(IFNULL(book,''),'|',IFNULL(session,'')))
       HAVING pageviews >= 1 ORDER BY avg_dwell_sec DESC LIMIT 10`),
  ]);

  return {
    range, includeBots,
    totals: totals[0] || {},
    trend, topBooks, topSessions, topBible, contentSplit,
    devices, browsers, os, countries, referrers,
    audio: audio[0] || {}, dwellTop,
  };
}

module.exports = { getDashboard };
