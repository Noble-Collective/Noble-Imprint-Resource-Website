# `GET /api/home` — shared Home content endpoint (build plan)

**Status:** PLAN — approved direction (Steve, 2026-09-24). Nothing built.
**Cross-product plan (read first):** `../Collective-Shared/plans/2026-09-24-shared-home-dashboard.md`.
**First consumer:** the mobile app's new Home (`Noble-Imprint-App/plans/2026-09-24-home-redesign.md`).
Later: this site's own home, Coram Deo, the Institute.

## Why here
This site already has the whole content library in its committed content-tree snapshot (book
`meta.json` incl. `subtitle` and `audiobook`, session H1 titles, route URLs via `content.sessionUrl`).
So it can return **ready-to-show cards** — no consumer has to resolve titles/subtitles itself.

## Endpoint
`GET /api/home?date=YYYY-MM-DD&product=app|web` — public, no auth, `Cache-Control: public,
max-age=3600`, rate-limited like `/api/analytics/collect`. Response shape: see the cross-product plan §3
(`resourceOfTheDay`, `partner`, `version`). Invalid/missing `date` ⇒ today in America/New_York.

**Pick rule (deterministic, not random):** take the configured books in list order, flatten their
sessions from the content tree, drop front matter (titles like "Front Matter", "Series Orientation",
"Further Resources", plus per-book exclusions from config), then `index = daysSinceEpoch(date) %
count`. `subtitle` = book `meta.json` `subtitle`; `hasAudio` = `meta.audiobook?.enabled === true`;
`webUrl` = the session's route URL. Pure function in `src/server/home.js` with unit tests
(`tests/unit/home.test.js`): same date ⇒ same pick; front matter skipped; excluded books never picked;
missing book in the tree ⇒ skipped, not an error.

## Config (edit without a deploy)
Store in this site's Firestore (project `noble-imprint-website`), doc `siteConfig/home`:
```json
{
  "resourceOfTheDay": {
    "books": [
      "series/Narrative Journey Series/Foundations/The Call of Christ",
      "series/Passage Series/HomeStead",
      "series/Vade Mecum/Proverbs and Faith Formation",
      "series/A Library of Classics/A Pastoral Shelf/Oration II",
      "series/A Library of Classics/A Philosophical Shelf/On the Shortness of Life"
    ],
    "excludeSessions": {}
  },
  "partner": { "title": "Partner with us", "body": "Keep these books and Bibles free for every church.",
               "buttonLabel": "Donate", "url": "<current donate URL>" }
}
```
Starting list = the audiobooks minus the Bible and L'Appel du Christ (both have audio; left out by
Steve's choice). Cached in memory ~5 min; falls back to built-in defaults if the doc is missing.

**Admin editor:** a "Home" tab in `/admin` (super-admin/admin only) to add/remove/reorder books (picker
from the content tree, showing which have audio), edit per-book exclusions, preview the next 14 days'
picks, and edit the Partner copy/URL. Writes go through an admin-gated `PUT /api/admin/home-config`
(zod-validated, audited).

## Also on this site
- `src/reader-userdata/progress.js`: send `source: 'resources-web'` in `recordActivity` (additive field;
  needs the SDK version that accepts it) so Continue can say "On the website".
- Later (optional): this site's home "Continue reading" strip uses the shared `pickContinue` and shows
  the Resource of the day card.

## Rollout
Ship the endpoint + admin tab (harmless to expose early), seed `siteConfig/home` with the starting list,
verify the 14-day preview, then the app consumes it. Deploys follow the usual approval rule.
