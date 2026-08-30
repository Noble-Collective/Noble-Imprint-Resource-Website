# BSB Versioning + Consolidated Compare UI

**Date:** 2026-08-29
**Status:** DEPLOYED (latest commit `165c416`). Compare-to-BSB (streaming checklist, verse+structure summary tiles, per-change Accept/Reject, batch "Refresh all Verses & Footnotes"), Quotation Audit (streaming per-book cards; enriched findings with paragraph context + highlighted diff + full BSB verse + editable-textarea Fix-quote), and Version & History all shipped. admin.js?v=16, style.css?v=99. Content-repo WRITE path (Accept/Refresh/Fix for real) deliberately left for a human to exercise. See CLAUDE.md "BSB Text Validation (admin)" + memory `project_bsb_validation` for the current architecture.

## Goal (from Steve, plain terms)
- **Label our copy** with today's date — record which BSB we're pinned to; we intentionally stay behind and evaluate changes ourselves.
- **One comparison** (not two) — "Compare to current BSB" shows how our copy differs from the publisher's live text; you Accept/Reject each change. Nothing auto-updates.
- **Better UX** — while it runs, show a live checklist proving a deterministic (non-AI) program is systematically checking **every book** against the source; nicer results; functions separated (sub-tabs/sections).

## Why one comparison, not two
We only have one external reference (bereanbible.com serves current only) and we don't store a snapshot. So "health check" and "check for updates" collapse into a single op: *our copy vs live*. (They'd differ only if we kept our own snapshot — we don't.)

## Findings that shaped this
- No machine version string anywhere; downloads page only offers current ("3rd Printing"), no older versions.
- Our copy is empirically a recent revision: 11,167 verses differ from Aug-2023, but only 6 from Jan-2026 and 7 from live. Matches no single capture exactly → intentionally pin "as of today," stay behind.
- Version signal = `Last-Modified` + `Content-Length` + SHA-256 of the live file.

## Build

### 1. Version label — `bibles/bsb/version.json` (content repo)
```json
{ "label": "Our pinned BSB copy", "pinnedAt": "2026-08-29", "printing": "3rd Printing (approx)",
  "note": "Intentionally pinned; upstream changes are reviewed manually before pulling.",
  "upstreamLastSeen": { "lastModified": "…", "sha256": "…", "checkedAt": "…" } }
```

### 2. Streaming compare — `src/server/bible-compare.js` + SSE endpoint
`GET /api/admin/bible-compare/stream` (Server-Sent Events; admin session cookie auths). Emits:
- `step` events: download official verse text → download official USFM → load our copy → (per book) → scan library → compile.
- `book` events: one per book with verse count + verse/heading/footnote diff counts (the live checklist).
- `result` event: version info + tiered changes (verse-store + library-quote + citation review) with Accept/Reject data.
Reuses pure diff logic (`bible-validation`) + library scan (`bible-sync.buildChangesFromDrift`, refactored out of `detectSyncChanges`). Fetches upstream ONCE.

### 3. Reuse for Accept: existing `POST /api/admin/bible-validation/apply-change`.

### 4. Admin UI — restructure the "Bible Validation" tab into sub-sections
- **Compare to BSB** — Run button → live checklist (steps + per-book ✓ with counts) → results: summary stat tiles + tiered diffs with Accept/Reject.
- **Quotation Audit** — existing, kept.
- **Version & History** — the version.json label + run history.
Nicer styling (stat tiles, checklist rows, badges). Replaces the old Run Validation + Scan buttons.

## Test
Unit (pure book-grouping + diff), local SSE smoke, deploy, live click-through by Steve (super-admin).
