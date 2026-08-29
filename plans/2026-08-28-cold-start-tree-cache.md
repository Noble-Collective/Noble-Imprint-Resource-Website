# Cold-start fix: stale-while-revalidate content tree (Option A)

**Problem.** A container with an empty in-memory cache (every deploy; every 10-min
TTL expiry) blocks the first request on a full content-tree rebuild: ~90 sequential
GitHub `GET dir` calls (~150ms each ≈ 13s) plus ~239 `GET file` calls, ~its bulk
being `loadAllSessionTitles` fetching every session's H1. Measured: matches the
10–15s spinner users hit. `min-instances=1` keeps the process alive but does NOT
make this rebuild cheap.

The committed disk caches were only ever used as an *outage* fallback, never to
accelerate cold starts: `getFileContent` reads disk only on API error, and
`.content-tree-cache.json` is **gitignored** (not in the image at all).

## Fix
Serve the on-disk tree snapshot immediately and refresh from GitHub in the
background (stale-while-revalidate), and ship the snapshot in the image.

1. **Un-gitignore `.content-tree-cache.json`**; commit an initial one; have the
   nightly `refresh-cache.yml` commit it alongside `src/.file-cache/`.
2. **`content.js` refactor:**
   - `rebuildContentTree()` — the real GitHub build, now also **enriches every
     session with its H1 title** (`loadAllSessionTitles`) before caching +
     persisting, so the snapshot is complete and a cold home doesn't re-fan-out
     for titles. Caches in-memory (TREE_TTL) + writes `.content-tree-cache.json`.
   - `triggerTreeRebuild()` — fire-and-forget background rebuild, single in-flight,
     never rejects.
   - `buildContentTree()` — SWR: in-memory hit → return; else snapshot present →
     cache short (60s) + background rebuild + **return snapshot immediately**;
     else (no snapshot) → blocking `rebuildContentTree()` with empty fallback.
   - `warmDiskCache()` uses `rebuildContentTree()` (force fresh) so the nightly job
     regenerates the snapshot.
3. **Tests:** unit — snapshot served without blocking on GitHub; no-snapshot path
   falls back to a build. Live — boot server, force a full `/api/refresh`, time the
   next home load (expect sub-second vs ~13s).

## Correctness / risk
- **Page content is never stale** — session bodies are loaded fresh per request,
  not from the snapshot. Only navigation structure (book list, titles, order,
  hidden flags, `@include` common blocks) can briefly lag, self-healing within
  seconds of the background rebuild; bounded by the nightly snapshot refresh.
- **Editing unaffected** — the editor reads files fresh w/ SHAs; the
  `fromDiskCache` edit-lock is on file reads, not the tree.
- **Book visibility** is the one sensitive field (a just-hidden book could show to
  the first cold visitor for the pre-refresh window). Per-route access checks still
  run live; follow-up: force a tree refresh on admin publish/hide.
- Snapshot missing/corrupt → safe fallback to today's blocking build, never an error.

## Not in scope (follow-ups)
- Session-page cold cost: sibling-heading loads still hit GitHub on a cold instance
  (smaller — one book's worth). Option B (proactively read the committed file disk
  cache on cold miss) would remove it.
- TTL tuning / force-refresh on admin changes.
