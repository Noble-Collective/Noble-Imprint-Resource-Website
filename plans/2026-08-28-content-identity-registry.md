# Plan — P1.5 Content Identity Registry (stable, forever `content_id`, fully automatic)

_2026-08-28. Analytics currently keys on display TITLES, so a rename splits history. Steve
wants stable "forever" IDs that (a) live in the WEBSITE DB, never in the content repo, and
(b) survive renames FULLY AUTOMATICALLY — no admin action._

## Why this is needed
Git stores no file identity: path changes on rename, blob SHA changes on every edit, and there
is no per-file GUID. So a forever ID must be *stored*. Steve vetoed storing it in the content
file (the otherwise-automatic approach), so it lives in the website's Firestore, and renames
are reconciled by detecting them automatically.

## Data model — Firestore `contentRegistry`
Doc id = `contentId` (UUID, forever). Fields:
`{ contentId, type: 'book'|'session'|'series'|'subseries', repoPath (CURRENT), title (CURRENT),
   series, subseries, book, sessionNumber, status: 'active'|'orphaned', firstSeen, lastSeen,
   previousPaths: [..] }`.
Kept in an in-memory index (repoPath → contentId) refreshed at boot + after each sync.

## Assignment + rename reconciliation (runs in the content sync, NOT the render hot path)
On each sync (hook into `buildContentTree` / the nightly refresh + a lazy safety net at render):
1. Diff the current content tree's files against the registry's known `repoPath`s.
2. **New path present, not in registry** → try to inherit an existing id before minting:
   - **Layer 1 — GitHub rename:** read the commit(s) that introduced the path; if a file entry
     has `status:"renamed"` + `previous_filename` matching a registry entry, move that entry's
     path to the new one (same contentId). Push old path into `previousPaths`.
   - **Layer 2 — structural:** match an `orphaned` entry with the same `(book, sessionNumber)`
     (sessions) or same series/subseries slot (books). Reassign its contentId.
   - **Layer 3 — content similarity (optional backstop):** compare against recently-orphaned
     files; inherit if similarity ≥ threshold.
   - Else **mint** a new contentId.
3. **Known path now absent** → mark entry `status:'orphaned'` (candidate for later re-link).
4. Unresolved orphan + unmatched new path after all layers → leave both; surface as a passive
   "possible split" in the admin dashboard (informational one-click merge; NEVER required).

## Injection + storage
- Render sites already set `res.locals.analyticsContext`. Add `content_id` (from the in-memory
  index by repoPath) to it for book/session (+ series/subseries if we register those).
- footer.ejs already emits `window.__analyticsContext`; client already echoes it.
- `resolveContent` (analytics.js) copies `content_id` onto the row.
- BigQuery: add nullable `content_id` column to `analytics.events` (+ `events_dev`).

## Dashboard (P3) implications
Group by `content_id`; display the registry's CURRENT title. Title-only historical rows
(pre-registry, bots, no-JS) coalesced by a title→content_id lookup at query time. Bible needs
no registry (book+chapter are stable identifiers already).

## The irreducible limit (be explicit)
No git-based scheme is provably 100% for delete+recreate-with-total-rewrite. Mitigated passively
(dashboard "possible split" note), never with a required admin chore → stays fully automatic.

## Phasing
- **A:** Firestore registry + in-memory index + render-time lookup/inject + `content_id` column
  + store on row. Mint-on-first-sight (no rename logic yet) — proves the pipeline.
- **B:** Layer 1 (GitHub `previous_filename`) rename reconciliation in the sync.
- **C:** Layer 2 structural fallback + orphan tracking.
- **D:** Passive "possible split" surfacing (fold into P3 dashboard).
- Backfill existing title-keyed rows once (cheap now — minimal data).

## Open/838 confirm
- Register series/subseries as their own content_ids too, or only book+session? (Lean: book +
  session are the analytics grain that matters; series/subseries stay title-keyed.)
