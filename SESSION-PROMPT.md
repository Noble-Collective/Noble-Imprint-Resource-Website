# Session Prompt — Noble Imprint Resource Website

## Context

Noble Imprint Resource Website — a collaborative discipleship resource editor with a Google Docs-style suggestion system. CodeMirror 6 editor with `diffChars` (from the `diff` npm package) as the diff engine.

Read `SESSION.md` (gitignored, in repo root) for full project context.

## Recent Work (2026-04-23)

**Direct edit locking** — `mode` field on presence heartbeats. Block entering direct edit if another user already has active direct edit session. Block accepting suggestions server-side (423) + client-side (disabled buttons, lock banner). Fail-open on network errors.

**Rate limit resilience** — disk cache fallback for content tree, file content, covers, SVGs. `fromDiskCache` flag disables editing when serving cached content. Rate limit message replaces edit buttons. Runtime warm-up (~500 API calls) fills disk cache 30s after startup. Image Cache-Control `public` → `private` (no CDN caching of errors). Deploy refresh step removed (redundant on new containers).

**Suggestion history** — replies preserved on accept/reject/resolve (only discard deletes). Location context (line number + heading) stored at resolution time. `GET /api/suggestions/history` endpoint returns resolved items with reply threads. Active/History toggle in editor toolbar. Claude bot prompt updated to use history for learning editorial patterns.

## Earlier Work (2026-04-21–22)

**Edit region tracking** — replaced threshold-based diffChars merge heuristics with CM6 transaction-based edit region tracking. Separate user edits stay separate, single replacements stay unified. Hunk text precision via before/after document matching. Same-word character merge workaround. 10 TDD tests.

**Visual improvements** — `*italic*` masking, `<sup>` tag masking, h6 heading support, heading hierarchy rebalanced (h1 2rem → h2 1.6rem → h3 1.35rem → h4 1.15rem → h5/h6 1rem), table styling, search scroll offset.

**UX fixes** — Review button routes through suggest mode, stale-at-load suggestions show amber cards, polling loop fix for unresolvable suggestions, dismiss deletes from Firestore, JSON body limit increased for large files.

## Key Files

- `src/public/js/editor-suggestions.js` — `computeHunks` + edit region tracking + `mergeHunksByEditRegion` + draftPlugin
- `src/public/js/editor.js` — auto-save, accept/reject, format groups, same-word merge, buildMarginHunks, polling, presence heartbeat with mode, direct edit lock check, history toggle
- `src/public/js/editor-margin.js` — margin card rendering, `renderHistoryCards`, `isHistoryMode` guards on scroll/polling
- `src/public/js/editor-masking.js` — inline syntax masking (bold, italic, sup, headings)
- `src/public/js/editor-constraints.js` — selection clamping zones
- `src/server/suggestions.js` — presence with `mode`, `getLocationContext`, `getResolvedSuggestions`/`getResolvedComments`, reply preservation
- `src/server/suggestion-routes.js` — direct edit lock on accept (423), `GET /history` endpoint
- `src/server/github.js` — disk cache fallback (`getFileContent`, `getFileBinary`, `getFileRaw`), `getRateLimitReset`
- `src/server/content.js` — `buildContentTree` disk fallback, `warmDiskCache`
- `src/public/css/style.css` — heading hierarchy, table styles, history cards, lock banner, rate limit message
- `docs/claude-editor-prompt.md` — Claude AI bot instructions including history API
- `tests/multi-user.spec.js` — edit region tracking tests, presence tests, accept tests

## Important Constraints

- **Never push/deploy without Steve's explicit approval** (unless told otherwise)
- **Kill server by specific PID only, never by process name**
- **TDD**: write failing test first, verify fail, fix code, verify pass
- Rebuild CodeMirror bundle with `npm run build:editor` after changes to editor-masking.js
- Server runs on port 8080, started with `npm start`
- GitHub API rate limit: 5000/hr shared between tests and production
- Test Book Session 1 is reserved for automated tests — don't modify manually
- Test Book Session 4 is a large file (370K chars) from HomeStead for testing
