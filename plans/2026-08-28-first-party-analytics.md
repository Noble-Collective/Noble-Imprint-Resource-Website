# Plan — First-party analytics in the admin console

_2026-08-28. Goal: detailed, privacy-clean usage analytics owned entirely in our GCP
project and surfaced inside `/admin` for admins. Answers: which **books** and **chapters**
(incl. Bible) people read, **how long** they stay, **how** they reach the site (device /
browser / referrer / country), and whether they **read vs. listen** to audio (and how much
of a chapter they hear)._

Decision locked (2026-08-28): **first-party pipeline embedded in the admin console**, storage
in **BigQuery**. Alternatives considered and rejected: PostHog / GA4 / Plausible (external
dashboards, weak on domain-specific book/chapter/audio metrics, don't live in `/admin`).

---

## Why BigQuery (not Firestore)

Analytics is ad-hoc group-by over a growing append-only event stream (by book, chapter,
device, country, date range, audio %). That's SQL's home turf. Firestore would force
pre-computed rollup docs for every breakdown and gets read-expensive for arbitrary queries.
Volume is tiny (~few hundred visitors/day → low-millions of rows/year): BigQuery streaming
inserts cost pennies, first 1 TB of queries/month is free, storage is negligible. The server
writes events with a direct streaming insert — no separate pipeline/Dataflow needed.

---

## Architecture (one clean event stream we control)

```
browser (analytics.js)                server (/api/analytics/collect)         BigQuery
  pageview  ─┐                          ├─ validate + size/rate cap            dataset: analytics
  heartbeat  ├─ navigator.sendBeacon ─▶ ├─ server-derive: device/browser/os    table:   events
  audio_*   ─┘   (survives unload)      │   (UA parse), country (IP), is_bot,   (partitioned by day)
                                        │   ip_hash (salted) — never trust client
                                        └─ streaming insert (small buffer)
                                                                                      │
admin console  ◀── /api/admin/analytics/* (requireAdmin) ── parameterized BQ SQL ◀────┘
  "Analytics" tab: charts + tables
```

**Key existing hooks we reuse (so this is incremental, not greenfield):**
- Server already resolves every URL to `series / book / session` (`content.resolveRoute`)
  and Bible routes to `/bible/:tx/:book/:chapter` → the pageview carries real **content
  identity**, injected server-side as `window.__analyticsContext` at render.
- `window.__audioPlayer` + the `<audio>` element already fire standard media events
  (`play`/`pause`/`timeupdate`/`ended`); we subscribe and emit audio events.
- Admin console exists: `admin-routes.js` (`page` + `api` routers, `requireAdmin`-gated in
  `index.js`), single `admin.ejs` view. New tab + JSON endpoints drop in here.

---

## Data model — BigQuery table `analytics.events` (append-only, day-partitioned)

One wide event row per event. Client sends a thin payload; **server derives the trust-
sensitive fields** (device, geo, is_bot, ip_hash).

| Field | Source | Notes |
|---|---|---|
| `event_id` STRING | client uuid | dedupe |
| `ts` TIMESTAMP | server | partition key |
| `session_id` STRING | client | rotates after ~30 min inactivity; sessionization + dwell |
| `visitor_id` STRING | client | anonymous, localStorage; stable-ish, no PII |
| `event_type` STRING | client | `pageview` \| `heartbeat` \| `audio_play` \| `audio_pause` \| `audio_progress` \| `audio_ended` |
| `path` STRING | client | raw URL path |
| `referrer` STRING | client | external referrer only (strip same-origin) |
| `content_type` STRING | server | `book_session` \| `bible_chapter` \| `home` \| `book_index` \| `other` |
| `series`,`book`,`session` STRING | server | from route resolution |
| `bible_translation`,`bible_book`,`bible_chapter` | server | for `/bible/*` |
| `dwell_ms` INT | client (heartbeat/unload) | active (tab-visible) time increment |
| `scroll_depth` FLOAT | client | optional (max % scrolled) |
| `audio_position_sec`,`audio_duration_sec` FLOAT | client | on audio events |
| `audio_percent` FLOAT | client | position/duration |
| `device_type` STRING | server (UA) | mobile \| tablet \| desktop |
| `browser`,`os` STRING | server (UA) | parsed |
| `country` STRING | server (IP) | GeoLite2 country (or 'unknown' in P0) |
| `is_bot` BOOL | server | UA classification (+ later datacenter-IP heuristics) |
| `ip_hash` STRING | server | salted SHA-256 of IP; raw IP never stored |
| `user_email` STRING | server | only if a logged-in admin/editor; null for readers |

Optional P5: nightly rollup tables (`daily_content_stats`, `daily_traffic`) via a scheduled
query so dashboards read small aggregates instead of scanning raw events.

---

## Client — `src/public/js/analytics.js` (new, loaded from footer.ejs)

- **Identity:** `visitor_id` (localStorage, random), `session_id` (sessionStorage + 30-min
  idle rotation). No cookies → no consent banner needed.
- **pageview** on load: `path`, external `referrer`, screen size; content identity comes from
  the server-injected `window.__analyticsContext`.
- **Dwell:** accumulate active time only while `document.visibilityState==='visible'`;
  heartbeat every 15 s; flush accumulated `dwell_ms` on `visibilitychange`→hidden and on
  `pagehide`, via `navigator.sendBeacon` (non-blocking, survives unload). AJAX session
  auto-advance (`__ajaxNav`) emits a new pageview on swap.
- **Audio:** subscribe to the `<audio>` element / `__audioPlayer`:
  `play`→`audio_play`, `pause`→`audio_pause`, `timeupdate` throttled to ~30 s→`audio_progress`
  (carrying position/duration/percent), `ended`→`audio_ended`. Enables listen-vs-read ratio,
  % of chapter heard, completion rate.
- **Transport:** all events batched and sent with `sendBeacon('/api/analytics/collect', json)`.
- **Respect Do-Not-Track / Global Privacy Control** if we choose to (open question).

## Server — ingestion `POST /api/analytics/collect` (public, in `index.js`/new module)

- Public (readers aren't logged in). Body-size cap + simple per-IP rate limit; ignore
  malformed payloads silently (200 no-op).
- **Enrich server-side (authoritative):** parse UA (`ua-parser-js` or a slim homegrown map)
  → device/browser/os; classify `is_bot`; `country` from IP via GeoLite2 country DB (bundled
  ~9 MB) — or 'unknown' in P0; `ip_hash = sha256(salt + ip)` (salt in env, raw IP discarded);
  attach `user_email` if a session cookie is present.
- **Content identity:** re-resolve from `path` server-side (don't trust client) so book/
  chapter are canonical.
- **Write:** buffer events in memory, flush to BigQuery `insertAll` every ~5 s or N events
  (Cloud Run instances are short-lived but a few-second buffer is safe; low volume also
  makes per-event insert acceptable as a fallback).
- Never accept client-supplied `is_bot`/`country`/`device`/`ip_hash`.

## Admin dashboard — `/admin` "Analytics" tab

- New section in `admin.ejs` + `/api/admin/analytics/*` endpoints (`requireAdmin`) that run
  **parameterized BigQuery SQL** for a chosen date range and return JSON. Charts rendered
  client-side (Chart.js single-file vendored, or inline SVG to honor the no-build ethos) —
  will apply the `dataviz` skill for palette/mark/legend consistency, light+dark.
- **Views:**
  - Traffic: pageviews + unique visitors trend; bot vs. human toggle.
  - Top content: books, sessions, and Bible chapters by views + unique visitors + avg dwell;
    Bible-reader vs. discipleship-book split (we already know Bible dominates today).
  - Engagement: avg/median dwell per content; scroll depth (if enabled).
  - Acquisition: device / browser / OS breakdown; top external referrers; country map/table.
  - Audio: chapters played, completion rate, % listened distribution, listen-vs-read ratio.

---

## Infra / IAM / ops

- Create BQ dataset `analytics` (US) + table `events` (day-partitioned, clustered on
  `content_type`,`book`).
- Grant the Cloud Run runtime service account `roles/bigquery.dataEditor` +
  `roles/bigquery.jobUser` on the dataset. (Identify the runtime SA for `resource-website`.)
- New env: `ANALYTICS_IP_SALT`, `BQ_ANALYTICS_DATASET`. GeoLite2 DB committed or fetched at
  build (license: MaxMind GeoLite2, free with account) — or defer geo to P-later.
- New deps: `@google-cloud/bigquery`, a UA parser, optional `maxmind`. Keep the front-end
  dependency-light (analytics.js is hand-written, no framework).
- Cost: negligible at current volume. Add a cache-buster bump (`footer.ejs` script `?v=`)
  when shipping client changes.

## Privacy stance (readers are anonymous)

- No cookies; IDs in local/sessionStorage. Raw IP never stored (salted hash only). No PII for
  logged-out visitors. Bot traffic flagged, not dropped, so dashboards can include/exclude.
- Add a short privacy note to the site footer/privacy page describing anonymous analytics.

---

## Phasing (ship each increment; verify events land before building on them)

- **P0 — pipeline skeleton:** BQ dataset+table+IAM; `/api/analytics/collect`; `analytics.js`
  pageview + dwell only (no audio, minimal enrichment). Verify rows landing in BQ. No
  dashboard yet.
- **P1 — server enrichment:** UA→device/browser/os, bot classification, ip_hash, content
  re-resolution + `window.__analyticsContext` injection so book/chapter are canonical; geo
  (or defer).
- **P2 — audio events:** emit `audio_*` from the player; verify % listened / completion.
- **P3 — admin dashboard v1:** Analytics tab with traffic + top-content + acquisition charts.
- **P4 — audio + engagement charts:** listen-vs-read, completion, dwell-per-content; polish
  (bot toggle, date range, CSV export).
- **P5 (optional):** nightly rollup tables for cheaper/faster dashboards; Cloud Logging→BQ
  sink as a server-truth cross-check + datacenter-IP bot heuristics; DNT/GPC handling.

Rough effort: P0–P2 ~ a few days; P3–P4 the bulk of the polish; ~1–2 weeks total.

---

## Open questions for Steve

1. **Geo precision:** country-only (bundle GeoLite2, ~9 MB) — or skip geo for v1 and add
   later? (Country is the high-value one; city adds little for this audience.)
2. **Do-Not-Track / Global Privacy Control:** honor it (drop analytics for those users) or
   ignore since data is already anonymous? Default recommendation: honor it — cheap goodwill.
3. **Bots in the default view:** exclude by default with a toggle to include (recommended),
   or show both side by side?
4. **Charting:** vendor Chart.js (single file, fast to build, richer) vs. hand-rolled inline
   SVG (zero deps, matches the no-build ethos, more work). Recommendation: Chart.js.
5. **Retention:** keep raw events forever (cheap) or auto-expire the raw table after e.g.
   400 days and keep only rollups? Recommendation: 400-day partition expiry on raw + keep
   rollups indefinitely.
```
