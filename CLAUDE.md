# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Start the server (production)
npm start

# Start with auto-restart on file changes (development)
npm run dev

# Rebuild the CodeMirror editor bundle (only needed when src/editor-entry.js changes)
npm run build:editor

# Run the pure-function unit tests (node:test — no server, no GitHub, fast)
npm run test:unit

# Run all Playwright tests (server must be running on port 8080 first)
npx playwright test

# Run a single test file
npx playwright test tests/editor.spec.js

# Run a specific test by name
npx playwright test -g "suggestion auto-saves to Firestore"
```

**Important:** The test suite hits the real GitHub API via the local server. Two things keep it affordable: (1) tests call `/api/refresh?scope=files` (a scoped invalidation that skips the full 22-book tree rebuild — ~10x fewer API calls than the old full `/api/refresh`); (2) point the server at an isolated **GitHub App** identity (see Testing → GitHub App auth) so a test run gets its own 5,000/hr bucket instead of sharing the personal token's limit with `gh` and the audiobook workflow. Run serially (`workers: 1`, set in `playwright.config.js`).

## Architecture

### Content Pipeline

Content lives in a separate GitHub repo (`Noble-Collective/Noble-Imprint-Resources`), organized as `series/{Series}/{Subseries?}/{Book}/sessions/{NN-Name.md}`. This website reads content via the GitHub API with a 3-tier caching strategy:

1. **In-memory cache** (30s TTL) — fastest, cleared on `/api/refresh`
2. **Disk file cache** (`src/.file-cache/`) — survives container restarts, committed to git, refreshed nightly by GitHub Actions
3. **Content tree disk fallback** (`.content-tree-cache.json`) — serves the full navigation tree during API outages

When content comes from disk cache (GitHub API is rate-limited), editing is disabled — the `fromDiskCache` flag prevents stale edits.

### Server-Side Rendering

Express + EJS templates. The layout is split between `partials/header.ejs` and `partials/footer.ejs` (not `layout.ejs`). The catch-all route `/:seg1/:seg2?/:seg3?/:seg4?` resolves URL segments to the content tree hierarchy via `content.resolveRoute()`.

### Markdown Rendering (`src/renderer/parser.js`)

Three-stage pipeline:
1. **Preprocess** — converts custom tags (`<Question>`, `<Callout>`, `<ChapterNum>`, `<<` attributions, `<image>`) to HTML/placeholders before markdown-it
2. **markdown-it** — renders with `html: true`, `typographer: true`, footnote plugin, custom heading colors from `meta.json`
3. **Post-process** — re-renders inline markdown inside HTML blocks, extracts pullquote markers into `<aside>` elements, detects/links Bible references with context tracking, merges heading tables, applies `sub-para` class for text-indent

**Common-content includes:** `<!-- @include: KeyName param="value" -->` injects a named block from `commonBook.md`/`commonSubseries.md`/`commonSeries.md` (book→subseries→series precedence). Params: `id=` (substitutes `{id}`), `bold=` (bolds a line/run/substring), `active=` (marks one `<Item>` active). `resolveIncludes(content, blocks)` does this for the reading view. `resolveIncludesTracked(content, blockIndex, sessionMeta)` is a parallel variant used by the **editor** — it returns the resolved buffer PLUS a segment map (see Editing System → Shared-content editing). Keep the two in sync: a unit test asserts they produce byte-for-byte identical output.

### Editing System

The editor is built on CodeMirror 6 with a custom suggestion/comment workflow:

**Three modes:** `suggest` (constrained editing, auto-saves to Firestore), `direct` (admin, Obsidian-style reveal of syntax), `review` (read-only, accept/reject cards)

**Key modules:**
- `editor.js` — orchestrator: initializes CM6, manages auto-save (1.5s debounce), accept/reject flows, polling (10s suggestions, 30s SHA check), presence
- `editor-suggestions.js` — `annotationRegistry` StateField tracks all saved suggestions/comments with positions via CM6 `mapPos`. `diffChars` pipeline detects changes, merges nearby hunks, renders green insertion / red strikethrough decorations
- `editor-masking.js` — hides markdown syntax. Short markers (`##`, `**`, `_`) use `Decoration.mark()` with CSS `font-size:0` (cursor passes through). Block tags (`<Question>`, `<Callout>`) use `Decoration.replace()` (cursor skips). Direct edit mode reveals focused line syntax in muted gray
- `editor-constraints.js` — `constraintExtension()` computes editable zones per-line in suggest mode, clamps selections, blocks edits to structural syntax. Also `readonlyExtension()` — a mode-INDEPENDENT transactionFilter that blocks edits intersecting a set of protected ranges (used to lock shared/parameterized content; see below)
- `editor-margin.js` — positioned suggestion/comment cards in a sidebar panel, overlap resolution, reply threads, history view
- `editor-comments.js` — selection tooltip, comment popup, @-mention autocomplete via Tribute.js
- `src/server/editor-model.js` — pure `buildEditorModel(...)` + I/O `getEditorModel(route)` that assemble the shared-content editor model (see below)

**CodeMirror bundle:** `src/editor-entry.js` is bundled by esbuild into `src/public/js/codemirror-bundle.js` (~1.1MB, committed). The other `editor-*.js` files are loaded as ES modules at runtime and import from the bundle. Never edit the bundle directly. **Bump the cache-buster** (`editor.js?v=N` in `session.ejs`, `style.css?v=N` in `partials/header.ejs`) whenever you change those files so deployed browsers refetch.

### Shared-content editing (`@include`)

Lets shared `@include` content be edited in the editor and routed to the correct common file. **Everything is gated on `hasShared`** (the session actually has `@include`); a session with no includes takes the exact original code path, byte-for-byte — the 150+ existing Playwright tests use non-include sessions and are unaffected.

- **Segment map (server):** `resolveIncludesTracked` (parser.js) returns `{resolved, segments}`. Each segment = `{bufFrom, bufTo, kind:'session'|'shared', sourceFile, sourceSha, level, key, includeDirective:{text,srcFrom,srcTo IN SESSION SOURCE}, additiveOffset, pieces:[{bufFrom,bufTo,srcFrom,srcTo,editable}], readonlySpans}`. `@include` lines are boundaries; `{id}`/`bold=`(`**`)/`active=`(` active`) become read-only pieces. Invariant: every editable piece is a verbatim slice of its source file → offset mapping + content-anchoring stay exact with no reverse transform on write.
- **`GET /api/editor-model/:seg…`** and `getSessionPageData` (for include sessions) return `resolvedContent`, `segments`, `editorFiles` (session + referenced commons, each with `content`+`sha`), and annotations pre-mapped to BUFFER offsets. Injected into `__EDITOR_DATA` / ajax `editData`.
- **Client (`editor.js`):** for include sessions `originalContent = resolvedContent`, so the whole diff/registry engine works in buffer space unchanged. `routeHunkBody` remaps each save from buffer space to its source file at mapped offsets (pass-through for non-include sessions). Suggest mode edits shared content inline (routed per file; only param spans locked); direct mode keeps shared read-only and, on save, `reconstructSessionSource()` rebuilds the session SOURCE with `@include` lines (never writes resolved content back). Shared blocks get a tint + an inline affordance widget ("Edit commonBook.md →").
- **Direct link-out (D3):** the affordance link opens the common file as a single-file edit via `?editFile=<repo path>` — no include resolution (so `hasShared` is false and it's the normal single-file editor), with a "Back to session" bar. Server-gated: admins any shared file, manuscript-owners book/subseries but not series-level.
- **Not yet done:** P5 (inline *direct* editing of shared content — a multi-file commit endpoint + seam constraints) is deferred. Include-session refresh/poll does a full page reload rather than an in-place editor-model refresh.
- Plans: `plans/2026-07-27-shared-content-editing-full.md` (architecture, D3 decision) and `plans/2026-07-28-shared-content-editing-P2-P4-impl.md` (client/routing approach).

### Suggestion Lifecycle

1. User edits in suggest mode → `diffChars` detects changes → auto-save creates/updates Firestore documents via `POST /api/suggestions/hunk`
2. Server resolves position from `lineNumber` + context fallback, builds multi-selector anchor (80-char prefix + exact text + 80-char suffix + content hash + structural hints)
3. Reviewer sees margin cards → accept calls `PUT /api/suggestions/hunk/:id/accept`
4. Server finds text via 5-strategy anchor cascade (full context → prefix+exact → exact+suffix → bare text → structural hint), performs replacement, commits to GitHub. `updateFileContent` then writes the just-committed content + new SHA into the cache (authoritative), so a subsequent accept reads the post-commit content locally instead of GitHub's (lagging) contents API — without this, two sequential accepts could clobber each other. `getHunk`/`updateHunk`/`deleteHunk` guard empty ids (clean not-found, not an opaque Firestore error).
5. `reanchorAnnotations()` updates ALL remaining suggestions/comments with fresh positions against the new file content. Note: annotation registry positions are clamped to finite/in-bounds (`buildShiftedRegistryEntries`) — a NaN/out-of-range position (e.g. an anchor-lost comment) otherwise crashes CodeMirror when rendered or navigated to.

### Authentication

Three auth paths in `auth.attachUser`:
1. Firebase session cookie (`__session`) — normal users via Google sign-in
2. Dev cookie (`__dev_auth`) — test-only, disabled in production
3. API key header (`x-api-key`) — Claude bot access, matched against `CLAUDE_API_KEY` env var

Super admin is hardcoded: `steve@noblecollective.org` in `auth.js`.

### Audiobook System

Audio is generated in a separate repo (`Noble-Imprint-Audiobooks`) via ElevenLabs TTS. This website serves audio via GCS signed URLs. The `audio-player.js` provides a floating icon → sticky bottom bar player with sentence-level text sync from timestamp data.

**Bible audiobooks** (`/bible` reader): chapters with generated audio (e.g. Proverbs, 2 Timothy) render as paragraphs with the player + synced highlighting. Serving path: `audio.js` `getBibleAudioManifest`/`getBibleAudioChapter` (GCS `audio/bible/{tx}/{book-slug}/`), `bible.js` `getAudioChapterBlocks` (renders from `usfm-audio.js` — a CommonJS port of the audiobook converter that MUST stay byte-parity with `Noble-Imprint-Audiobooks/src/usfm-to-markdown.js`), and `bible-chapter.ejs` (audio-fab gated on `audioSession`). Poetry grouping + the `\h`↔references.json name fix (`resolveRefBookName`) live in `bible.js` `loadBibles`; after changing that parsing, rebuild + commit `.bible-cache/*.json`. **Full architecture + runbook for adding books: `Noble-Imprint-Audiobooks/docs/BIBLE-AUDIOBOOKS.md`.**

### Firestore Conventions

Book repo paths use `|` instead of `/` as separators in Firestore field names (Firestore disallows `/`). Helpers: `encodeBookPath()` / `decodeBookPath()` in `firestore.js`.

## Key Patterns

- **Custom markdown tags** (`<Question>`, `<Callout>`, `<ChapterNum>`, `<<`) must be preserved exactly in content — the mobile app depends on this syntax
- **Bible data** loads asynchronously at startup from GitHub, cached to `.bible-cache/`. First boot takes ~2 minutes; subsequent starts use disk cache
- **Rate limit awareness**: GitHub API budget (5000/hour) is consumed by content reads, content tree builds, and suggestion accepts. The server logs `[GITHUB] ... budget: N/5000` for tracking
- **⚠️ ALWAYS bump `?v=N` when you change a `/static` asset.** `express.static` serves `/static` with `Cache-Control: max-age=1y, immutable` (`src/server/index.js`), so browsers cache CSS/JS for a **year and never revalidate**. The `?v=N` query string in the templates is the *only* thing that forces a refetch — ship a changed `src/public/css/style.css` or `src/public/js/*.js` **without** bumping its `?v=N` and returning visitors keep the stale file for up to a year. Version strings live in `partials/header.ejs` (`style.css?v=N`), `session.ejs` (`editor.js?v=N`, `audio-player.js?v=N`, `ajax-nav.js?v=N`), `footer.ejs`, `admin.ejs`, `bible-chapter.ejs`. This is a hard rule, not a nicety.
- **No CSS build**: all styles in a single `src/public/css/style.css`, responsive breakpoints at 989px, 768px, 480px. Not minified — `compression` middleware (`index.js`) gzips it on the wire instead (~124KB → ~22KB), so there's no build step to keep in sync.
- **Disk cache committed to git**: `src/.file-cache/` is checked in so Docker builds have warm caches. Refreshed nightly by `.github/workflows/refresh-cache.yml`
- **Session counts are numbered-only**: the count on the home cards and book page uses `content.numberedSessionCount(book)` — sessions whose H1 title carries a number (the same rule that renders the number badge left of each title in nav/book page), so front/back-matter (Front Matter, The Opening, The Recall, Further Resources) is excluded. The count needs H1 titles, so the home route calls `content.loadAllSessionTitles(tree)` before render — **keep that call** (home otherwise doesn't load session content; it's sequential-per-book + idempotent to stay off the rate-limit-sensitive `buildContentTree` path).

## Testing

Tests use Playwright with Chromium. The server must be running locally on port 8080 with a `.env` file. Tests authenticate via `POST /api/auth/test-login` (dev-only endpoint). Test data uses `Test Book` at `series/Narrative Journey Series/Foundations/Test Book/`.

**Config (`playwright.config.js`):** `workers: 1` (tests share the one Test Book file + Firestore state — they MUST run serially), `retries: 2` (absorbs legitimate real-network timing flakes), `globalSetup: tests/global-setup.js` (one-time Firestore cleanup), and `testIgnore` for `ajax-nav-manual.spec.js` (a manual/`--headed` spec not run in the default suite).

**Shared fixture (`tests/fixtures.js`):** specs import `{ test, expect }` from `./fixtures`, NOT `@playwright/test`. It has an auto `beforeEach` that POSTs `/api/cleanup-test-data` before every test, so tests don't inherit leftover suggestion/comment/reply state (the dominant source of count/anchor failures). New specs should import from `./fixtures`.

**Cache/refresh:** tests call `POST /api/refresh?scope=files` (scoped — invalidates file caches, keeps the content tree; ~10x cheaper than a full refresh). Tests that mutate the shared session file use the `saveCleanFile()` / `restoreCleanFile()` helpers; content-position-dependent tests should `restoreCleanFile()` before reading content so prior drift can't shift positions.

**Timing:** prefer polling assertions (`expect.poll`, `expect(locator).toHaveCount(...)`, `expect(...).toPass()`) over fixed `waitForTimeout` + immediate checks — auto-save (1.5s debounce), the 10s suggestion poll, and cross-user propagation are all async.

**GitHub App auth (isolated rate limit):** to give the test server its own 5,000/hr bucket (separate from `gh`/the audiobook workflow's personal token), set `GITHUB_APP_ID`, `GITHUB_APP_INSTALLATION_ID`, and `GITHUB_APP_PRIVATE_KEY_B64` (base64 of the App's `.pem`) in `.env`. `github.js` prefers App-installation auth when these are present and falls back to `GITHUB_TOKEN` otherwise. The App (`Noble Imprint Content Server`) is installed on the Noble-Collective org, scoped to `Noble-Imprint-Resources` only, Contents: Read & Write.

**Include fixtures:** `Test Book/Session 5` (`5-Session5-Includes.md`) `@include`s a book-level block (`Test Book/commonBook.md`) and a series-level block (`Narrative Journey Series/commonSeries.md`), plus parameterized `bold=`/`{id}` blocks — it backs `tests/shared-content.spec.js`. `cleanup-test-data` resets suggestion state for Session 1, Session 5, and both common files.

**Unit tests (`npm run test:unit`):** `tests/unit/*.test.js` use Node's built-in `node:test` (no server, no GitHub). `segment-map.test.js` covers `resolveIncludesTracked`, `gatherCommonBlocksTracked`, and `buildEditorModel` with in-memory fixtures — including the verbatim-slice invariant and byte-for-byte parity with `resolveIncludes`. Run these when touching the include/segment-map/editor-model code; they're the fast first line of defense before the Playwright suite.

**Shared-content Playwright (`tests/shared-content.spec.js`):** exercises the full `@include` editing flow on Session 5 — resolved render, shared tint + inline affordance, read-only in both modes, session/book/series suggest routing, the `?editFile` link-out + its guard, `/api/editor-model` shape + auth, direct-mode session-source reconstruction (via request interception — no GitHub write), and shared-suggestion reload. Also a no-include regression guard. Note some paths are deliberately NOT tested because they'd write to the real repo: accepting a shared suggestion, direct-committing to a shared file, and non-super-admin permission denial.

Tests interact with the editor through `window.__editorView` (CM6 EditorView), `window.__annotationRegistry`, and `window.__originalDocField`. Common patterns: `page.evaluate(() => cursorAfter('text'))`, `page.evaluate(() => selectText('from', 'to'))`.
