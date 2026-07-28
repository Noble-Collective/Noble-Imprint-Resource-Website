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

### Editing System

The editor is built on CodeMirror 6 with a custom suggestion/comment workflow:

**Three modes:** `suggest` (constrained editing, auto-saves to Firestore), `direct` (admin, Obsidian-style reveal of syntax), `review` (read-only, accept/reject cards)

**Key modules:**
- `editor.js` — orchestrator: initializes CM6, manages auto-save (1.5s debounce), accept/reject flows, polling (10s suggestions, 30s SHA check), presence
- `editor-suggestions.js` — `annotationRegistry` StateField tracks all saved suggestions/comments with positions via CM6 `mapPos`. `diffChars` pipeline detects changes, merges nearby hunks, renders green insertion / red strikethrough decorations
- `editor-masking.js` — hides markdown syntax. Short markers (`##`, `**`, `_`) use `Decoration.mark()` with CSS `font-size:0` (cursor passes through). Block tags (`<Question>`, `<Callout>`) use `Decoration.replace()` (cursor skips). Direct edit mode reveals focused line syntax in muted gray
- `editor-constraints.js` — computes editable zones per-line in suggest mode, clamps selections to zone boundaries, blocks edits to structural syntax
- `editor-margin.js` — positioned suggestion/comment cards in a sidebar panel, overlap resolution, reply threads, history view
- `editor-comments.js` — selection tooltip, comment popup, @-mention autocomplete via Tribute.js

**CodeMirror bundle:** `src/editor-entry.js` is bundled by esbuild into `src/public/js/codemirror-bundle.js` (~1.1MB, committed). The other `editor-*.js` files are loaded as ES modules at runtime and import from the bundle. Never edit the bundle directly.

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

### Firestore Conventions

Book repo paths use `|` instead of `/` as separators in Firestore field names (Firestore disallows `/`). Helpers: `encodeBookPath()` / `decodeBookPath()` in `firestore.js`.

## Key Patterns

- **Custom markdown tags** (`<Question>`, `<Callout>`, `<ChapterNum>`, `<<`) must be preserved exactly in content — the mobile app depends on this syntax
- **Bible data** loads asynchronously at startup from GitHub, cached to `.bible-cache/`. First boot takes ~2 minutes; subsequent starts use disk cache
- **Rate limit awareness**: GitHub API budget (5000/hour) is consumed by content reads, content tree builds, and suggestion accepts. The server logs `[GITHUB] ... budget: N/5000` for tracking
- **No CSS build**: all styles in a single `src/public/css/style.css`, responsive breakpoints at 989px, 768px, 480px
- **Disk cache committed to git**: `src/.file-cache/` is checked in so Docker builds have warm caches. Refreshed nightly by `.github/workflows/refresh-cache.yml`

## Testing

Tests use Playwright with Chromium. The server must be running locally on port 8080 with a `.env` file. Tests authenticate via `POST /api/auth/test-login` (dev-only endpoint). Test data uses `Test Book` at `series/Narrative Journey Series/Foundations/Test Book/`.

**Config (`playwright.config.js`):** `workers: 1` (tests share the one Test Book file + Firestore state — they MUST run serially), `retries: 2` (absorbs legitimate real-network timing flakes), `globalSetup: tests/global-setup.js` (one-time Firestore cleanup), and `testIgnore` for `ajax-nav-manual.spec.js` (a manual/`--headed` spec not run in the default suite).

**Shared fixture (`tests/fixtures.js`):** specs import `{ test, expect }` from `./fixtures`, NOT `@playwright/test`. It has an auto `beforeEach` that POSTs `/api/cleanup-test-data` before every test, so tests don't inherit leftover suggestion/comment/reply state (the dominant source of count/anchor failures). New specs should import from `./fixtures`.

**Cache/refresh:** tests call `POST /api/refresh?scope=files` (scoped — invalidates file caches, keeps the content tree; ~10x cheaper than a full refresh). Tests that mutate the shared session file use the `saveCleanFile()` / `restoreCleanFile()` helpers; content-position-dependent tests should `restoreCleanFile()` before reading content so prior drift can't shift positions.

**Timing:** prefer polling assertions (`expect.poll`, `expect(locator).toHaveCount(...)`, `expect(...).toPass()`) over fixed `waitForTimeout` + immediate checks — auto-save (1.5s debounce), the 10s suggestion poll, and cross-user propagation are all async.

**GitHub App auth (isolated rate limit):** to give the test server its own 5,000/hr bucket (separate from `gh`/the audiobook workflow's personal token), set `GITHUB_APP_ID`, `GITHUB_APP_INSTALLATION_ID`, and `GITHUB_APP_PRIVATE_KEY_B64` (base64 of the App's `.pem`) in `.env`. `github.js` prefers App-installation auth when these are present and falls back to `GITHUB_TOKEN` otherwise. The App (`Noble Imprint Content Server`) is installed on the Noble-Collective org, scoped to `Noble-Imprint-Resources` only, Contents: Read & Write.

**Include fixtures:** `Test Book/Session 5` (`5-Session5-Includes.md`) exercises `@include` shared content (book/series level + parameterized `bold=`/`{id}`) for the shared-content-editing work.

Tests interact with the editor through `window.__editorView` (CM6 EditorView), `window.__annotationRegistry`, and `window.__originalDocField`. Common patterns: `page.evaluate(() => cursorAfter('text'))`, `page.evaluate(() => selectText('from', 'to'))`.
