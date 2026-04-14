# Noble Imprint Resource Website

Public website and collaborative editing platform for Noble Imprint discipleship resources.

**Live:** https://resources.noblecollective.org
**Design philosophy:** See [ARCHITECTURE.md](ARCHITECTURE.md)

---

## What This Is

A Node.js/Express web application that provides two capabilities on top of the Noble Imprint Resources GitHub repository (the single source of truth for all content):

1. **A public reading website** — anyone can browse and read the full resource library, rendered from markdown with custom syntax support.
2. **A collaborative editing workflow** — authorized users can suggest changes to book content in a Google Docs-style editor, while the markdown files in GitHub remain the canonical source.

The content repo (`Noble-Imprint-Resources`) is never modified directly by the website. Accepted suggestions are committed back via the GitHub API as clean Git commits.

---

## Quick Start

### Prerequisites

- Node.js 22+
- Google Cloud CLI (`gcloud`) authenticated to the `noble-imprint-website` project
- Access to GCP Secret Manager secrets (`github-token`, `claude-api-key`)

### Setup

```bash
git clone https://github.com/Noble-Collective/Noble-Imprint-Resource-Website.git
cd Noble-Imprint-Resource-Website
npm install
```

### Run Locally

```bash
GITHUB_TOKEN=$(gcloud secrets versions access latest --secret=github-token --project=noble-imprint-website) \
FIREBASE_API_KEY=AIzaSyBgjc_fFiR7tNCvNYcjZe6l2TyetjYoIP8 \
GOOGLE_CLOUD_PROJECT=noble-imprint-website \
CLAUDE_API_KEY=$(gcloud secrets versions access latest --secret=claude-api-key --project=noble-imprint-website) \
CLAUDE_BOT_EMAIL=claude@noblecollective.org \
node src/server/index.js
```

Server starts at http://localhost:8080. First boot takes ~2 minutes (Bible cache build); subsequent starts ~200ms.

### Run Tests

```bash
# Full suite (52 tests, ~3-4 min)
GOOGLE_CLOUD_PROJECT=noble-imprint-website \
GITHUB_TOKEN=$(gcloud secrets versions access latest --secret=github-token --project=noble-imprint-website) \
CLAUDE_API_KEY=$(gcloud secrets versions access latest --secret=claude-api-key --project=noble-imprint-website) \
npx playwright test tests/editor.spec.js

# Single test
npx playwright test tests/editor.spec.js -g "H1 heading"
```

---

## How It Works

### Content Pipeline

```
Noble-Imprint-Resources (GitHub) ──GitHub API──> Express Server ──render──> HTML
```

The server reads markdown files on demand via the GitHub API (Octokit). An in-memory cache with TTL prevents excessive API calls. The navigation tree (series > sub-series > books > sessions) is built from directory structure and `meta.json` files. When content is pushed to the resources repo, a `repository_dispatch` triggers a website rebuild.

### The Masked Editor

The editor uses CodeMirror 6 to let users edit the raw markdown file while seeing formatted text. Structural syntax is hidden but physically present in the document buffer — no round-tripping, no data model translation.

**Two hiding strategies based on syntax length:**

| Syntax | Examples | Method | Cursor behavior |
|--------|----------|--------|-----------------|
| Short inline markers | `##`, `**`, `_`, `<<`, `>` | `Decoration.mark()` + CSS `font-size:0` | Passes through smoothly |
| Long block tags | `<Question id=...>`, `</Callout>` | `Decoration.replace()` | Skips in one step |

Visual styling (heading size, bold weight, italic, blockquote borders) is applied via separate `Decoration.mark()` decorations that remain active at all times.

**Why not `atomicRanges`?** An earlier version (v1) used `Decoration.replace()` + `atomicRanges` for all syntax hiding. This caused cursor jumping, selection fighting, and whole-region highlighting. The v2 architecture (current) uses zero-width CSS marks for inline syntax, following the same approach as Obsidian's live preview. See the "Editor Architecture" section below for details.

**Edit constraints** in suggest mode: a synchronous `transactionFilter` clamps selections to zone boundaries (single line, within innermost tag). A separate `transactionFilter` blocks edits outside editable zones. No mouseup hacks, no setTimeout delays.

**Obsidian-style reveal** in direct edit mode: the focused line shows syntax markers in muted gray while keeping visual styling. Moving the cursor re-hides them.

### Suggestion System

Suggestions are tracked per-hunk (each contiguous change is a separate Firestore document). The diff pipeline:

1. `diffChars()` compares original and current document
2. Nearby changes within 4 characters are merged into coherent hunks
3. Each hunk is classified as insertion, deletion, or replacement
4. Auto-saved to Firestore after 1.5s pause, keyed by original document position
5. Displayed inline (green for insertions, red strikethrough for deletions) and as margin cards

**Accept flow:** Server fetches the current file from GitHub, does text-based find-and-replace (`originalText` -> `newText`), commits. If the text can't be found (file changed), the suggestion is marked stale.

### Comments and Replies

**Comments:** Select text > floating "+ Comment" tooltip > popup > saves to Firestore > yellow highlight on text + margin card with resolve button.

**Reply threads:** Both suggestions and comments have linear reply threads. Any user with edit access can reply. Replies are stored in a top-level Firestore `replies` collection with `parentId`/`parentType`. When a suggestion is accepted/rejected or a comment is resolved, all replies are batch-deleted.

### Authentication and Roles

Firebase Auth with Google sign-in. Session cookies (httpOnly, 5-day expiry). API key auth for bots via `x-api-key` header.

| Role | Scope | Can edit | Can review | Can manage users |
|------|-------|----------|------------|-----------------|
| Viewer | Per-book | No | No | No |
| Comment-Suggest | Per-book | Suggest + comment | No | No |
| Manuscript Owner | Per-book | Suggest + direct edit | Accept/reject | No |
| Admin | Global | Suggest + direct edit | Accept/reject | Yes |
| Super Admin | Global | Everything | Everything | Yes (cannot be removed) |

Roles are managed in the admin console (`/admin`) and stored in Firestore.

---

## Project Structure

```
.github/workflows/deploy.yml        CI/CD: Docker build + Cloud Run deploy on push
firebase.json                        Firebase Hosting rewrite to Cloud Run
playwright.config.js                 Playwright test config (Chromium, headless)
Dockerfile                           Node 22-slim, production build
website-config.yaml                  Legacy config (roles now in Firestore)
tests/
  editor.spec.js                     52 Playwright tests covering the full editor

docs/
  claude-editor-prompt.md            Setup guide for Claude AI bot access

src/
  editor-entry.js                    CodeMirror bundle entry point (esbuild)
                                     Exports: basicSetup, EditorView, EditorState,
                                     Compartment, EditorSelection, Decoration,
                                     ViewPlugin, WidgetType, keymap, markdown,
                                     diffChars

  public/css/
    style.css                        All styles (responsive at 989/768/480px)
                                     Includes: reading view, editor layout,
                                     margin cards, reply threads, admin console

  public/js/
    codemirror-bundle.js             CM6 + diff library bundle (esbuild, ~1.1MB)
    editor.js                        Editor orchestration: mode switching, auto-save,
                                     accept/reject, reply posting, click-to-focus,
                                     View Source toggle, line numbers toggle
    editor-masking.js                v2 masking: hideInline (zero-width marks),
                                     hideBlock (replace), Obsidian-style reveal,
                                     full visual theme
    editor-suggestions.js            diffChars pipeline, hunk tracking,
                                     inline decorations (green/red)
    editor-margin.js                 Margin panel: suggestion/comment/reply card
                                     rendering, positioning, overlap resolution,
                                     focusMarginCard pulse animation
    editor-comments.js               Comment system: selection tooltip, popup,
                                     Firestore save, yellow highlight decorations
    editor-constraints.js            v2 constraints: zone computation,
                                     transactionFilter selection clamp,
                                     transactionFilter edit protection
    main.js                          Reading view: sidebar, drawer, view toggle,
                                     verse popups, user menu
    auth.js                          Firebase Auth client (Google sign-in/out)
    admin.js                         Admin console client JS

  renderer/
    parser.js                        Markdown-it renderer + custom syntax plugins
                                     + Bible reference detection

  server/
    index.js                         Express server, all page routes, middleware,
                                     auth endpoints, test-login (dev only)
    auth.js                          Firebase Admin SDK, session cookie creation,
                                     API key validation, user attachment middleware
    firestore.js                     Firestore user CRUD, role queries,
                                     permission checks (canEdit, canReview)
    suggestions.js                   Suggestion/comment/reply CRUD, accept flow
                                     (GitHub commit), reject, reply cleanup
    suggestion-routes.js             API routes: /hunk, /comments, /replies,
                                     /content, /file, /direct-edit
    admin-routes.js                  Admin page rendering + user/book management APIs
    github.js                        GitHub API client (Octokit): read files,
                                     read directories, commit file updates
    content.js                       Content tree builder from GitHub directory
                                     structure, book visibility filtering
    bible.js                         Bible loader (KJV + BSB from USFM), disk
                                     caching, verse lookup API
    cache.js                         In-memory cache with TTL, delete, invalidateAll

  views/
    partials/header.ejs              Site header + mobile hamburger drawer
    partials/footer.ejs              Footer + Firebase SDK script + auth.js
    partials/sidebar-auth.ejs        Sidebar sign in/out + admin link
    session.ejs                      Session page: reading view + editor container
                                     (sticky toolbar, Lines/Source/Done, CodeMirror
                                     host, margin panel, comment popup, toast)
    admin.ejs                        Admin console (users + books + reviews tabs)
    home.ejs                         Homepage (visual catalog + list toggle)
    book.ejs                         Book detail page (session listing)
    bible-browse.ejs                 Bible book/chapter browser
    bible-chapter.ejs                Bible chapter reader
    error.ejs                        Error page
```

---

## Development Guide

### Environment Variables

| Variable | Source | Purpose |
|----------|--------|---------|
| `GITHUB_TOKEN` | GCP Secret Manager | GitHub API access (read content, commit changes) |
| `FIREBASE_API_KEY` | Hardcoded | Firebase Auth client-side key |
| `GOOGLE_CLOUD_PROJECT` | Set manually | Firestore project ID |
| `CLAUDE_API_KEY` | GCP Secret Manager | API key for Claude AI bot access |
| `CLAUDE_BOT_EMAIL` | Set manually | Email identity for bot user |
| `PORT` | Cloud Run sets automatically | Server port (defaults to 8080) |
| `BUILD_TIME` | Docker build arg | Displayed in footer as "last updated" |
| `NODE_ENV` | Dockerfile sets to `production` | Disables test-login endpoint in prod |

### Rebuilding the CodeMirror Bundle

```bash
npm run build:editor
```

**When to rebuild:** After changing `src/editor-entry.js` (adding/removing exports). Changes to `editor-masking.js`, `editor-suggestions.js`, etc. do NOT require a rebuild — those are loaded as separate ES modules at runtime. Only the bundle entry point needs rebuilding.

### Test Architecture

Tests use Playwright with Chromium in headless mode. The server must be running locally.

- **Dev-only test-login:** `POST /api/auth/test-login` creates a session cookie without Firebase Auth (disabled in production via `NODE_ENV` check)
- **Editor interaction:** Tests use `window.__editorView` (exposed by editor.js) to programmatically set cursor positions and selections via CodeMirror's dispatch API
- **Helper functions:** `selectText()`, `cursorAfter()`, `replaceWith()`, `typeText()`, `deleteSelection()`, `scrollEditorTo()`, `getRawDoc()`
- **Suggestion cleanup:** `clearAllSuggestions()` deletes all pending suggestions between tests

### Important: Server Process Management

Never use `taskkill /IM node.exe` or `pkill node` to stop the server. This kills all Node processes including Claude Code. Always find the specific PID:

```bash
netstat -ano | grep :8080 | grep LISTEN
# Then kill by PID, or:
npx kill-port 8080
```

---

## Editor Architecture Deep Dive

### Masking (`editor-masking.js`)

`buildMaskingDecorations(view, skipLineNumber)` scans the full document text and builds an array of CodeMirror decorations:

1. **Block-level tags** — `<Question>`, `<Callout>`, section tags: regex scan of full text, `hideBlock()` for open/close tags, `mark()` for content styling
2. **Line-level prefixes** — headings, attributions, blockquotes: line-by-line scan, `hideInline()` for prefix, `mark()` for content
3. **Inline markers** — bold `**`, italic `_`: regex scan of full text, `hideInline()` for markers, `mark()` for content
4. **Special lines** — `<br>` replaced with spacer widget, `<image>` styled as placeholder

**`hideInline(from, to)`**: On non-focused lines, creates `Decoration.mark({ class: 'cm-hidden-syntax' })` (CSS `font-size:0`). On the focused line (direct edit mode), creates `Decoration.mark({ class: 'cm-revealed-syntax' })` (muted gray, 0.75em).

**`hideBlock(from, to)`**: On non-focused lines, creates `Decoration.replace()`. On the focused line, creates `Decoration.mark({ class: 'cm-revealed-syntax' })`.

**`mark(from, to, cls)`**: Always creates `Decoration.mark({ class: cls })`. Styling decorations are never affected by reveal.

The plugin recomputes on `docChanged`, `viewportChanged`, or cursor line change.

### Constraints (`editor-constraints.js`)

**Zone computation** (`computeEditableZones(doc)`): Scans each line, strips structural prefixes (headings, attributions, blockquotes), parses inline tags (Question, Callout, bold, italic), builds zones from the text between/inside tags. Innermost zones win for nested structures.

**Selection clamping** (`transactionFilter`): If a range selection's anchor and head are in different zones, clamps the head to the anchor's zone boundaries. Runs synchronously before the view updates — no flicker.

**Edit protection** (`transactionFilter`): If any change in a transaction falls outside editable zones, the entire transaction is blocked (returns `[]`).

### Suggestions (`editor-suggestions.js`)

The suggestion plugin watches for document changes and computes a diff against the original:

1. `diffChars(original, current)` produces character-level changes
2. Changes within 4 characters of each other are merged (`MERGE_THRESHOLD`)
3. Each merged group becomes a hunk with type, positions in both original and current doc, and text
4. Hunks are rendered as inline decorations: green `cm-suggestion-insert` marks for insertions, red `cm-suggestion-delete` widgets for deletions
5. A debounced callback (300ms) notifies the margin panel of hunk changes

### Margin Panel (`editor-margin.js`)

Cards are absolutely positioned in a 260px sidebar, aligned vertically with the corresponding text in the editor via `editorView.coordsAtPos()`. Overlap resolution shifts cards downward with 6px gaps.

**`focusMarginCard(type, id)`**: Scrolls the card into view and adds a `margin-card--focused` class that triggers a gold pulse CSS animation (0.6s).

Reply threads are rendered between the card body and timestamp, with an always-visible input field at the bottom.

---

## Deployment

### Automatic (standard workflow)

Push to `main` branch. GitHub Actions builds a Docker image and deploys to Cloud Run. Takes ~2-3 minutes.

```bash
git push origin main
# That's it. CI/CD handles the rest.
```

### Content updates

Push to the `Noble-Imprint-Resources` repo. A `repository_dispatch` event triggers the website to rebuild and redeploy, picking up the new content.

### Firebase Hosting

Only needed when changing the auth domain configuration:

```bash
firebase deploy --only hosting --project=noble-imprint-website
```

### Manual Cloud Run deployment (rare)

```bash
BUILD_TIME=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
docker build --build-arg BUILD_TIME="$BUILD_TIME" -t gcr.io/noble-imprint-website/resource-website .
docker push gcr.io/noble-imprint-website/resource-website
gcloud run deploy resource-website \
  --image gcr.io/noble-imprint-website/resource-website \
  --platform managed --region us-central1 --project=noble-imprint-website
```

---

## Infrastructure

| Component | Details |
|-----------|---------|
| **GCP Project** | `noble-imprint-website` |
| **Cloud Run** | `resource-website` in `us-central1` |
| **Firebase Hosting** | `noble-imprint-website.web.app` + `resources.noblecollective.org` |
| **Firestore** | Collections: `users`, `suggestions`, `comments`, `replies` |
| **Firestore Indexes** | `suggestions` (filePath+status+originalFrom), `suggestions` (status+createdAt), `comments` (filePath+status+from), `replies` (filePath+createdAt) |
| **GCP Secret Manager** | `github-token`, `claude-api-key` |
| **Cloudflare DNS** | `resources` CNAME > `noble-imprint-website.web.app` (proxy OFF) |

### Creating Firestore Indexes

When a new composite query is needed, Firestore returns an error with a link to create the index. Or create manually:

```bash
gcloud firestore indexes composite create \
  --collection-group=COLLECTION \
  --field-config=field-path=FIELD1,order=ascending \
  --field-config=field-path=FIELD2,order=ascending \
  --project=noble-imprint-website
```

Indexes take 2-10 minutes to build.

---

## API Reference

All editing API routes require authentication (session cookie or API key). Mounted at `/api/suggestions/`.

### Suggestions

| Method | Endpoint | Purpose | Auth |
|--------|----------|---------|------|
| `POST` | `/hunk` | Create a suggestion hunk | Edit role |
| `PUT` | `/hunk/:id` | Update a suggestion hunk | Author or admin |
| `DELETE` | `/hunk/:id` | Delete a suggestion hunk | Author or admin |
| `PUT` | `/hunk/:id/accept` | Accept (commits to GitHub) | Review role |
| `PUT` | `/hunk/:id/reject` | Reject a suggestion | Review role |
| `GET` | `/` | List suggestions (query: bookPath, status) | Any auth |
| `GET` | `/file?filePath=...` | Get suggestions + comments + replies for a file | Any auth |
| `GET` | `/content?filePath=...` | Get file content + suggestions + comments | Any auth |

### Comments

| Method | Endpoint | Purpose | Auth |
|--------|----------|---------|------|
| `POST` | `/comments` | Create a comment | Edit role |
| `PUT` | `/comments/:id/resolve` | Resolve a comment | Author, owner, or admin |

### Replies

| Method | Endpoint | Purpose | Auth |
|--------|----------|---------|------|
| `POST` | `/replies` | Create a reply on a suggestion or comment | Edit role |

### Direct Edit

| Method | Endpoint | Purpose | Auth |
|--------|----------|---------|------|
| `POST` | `/direct-edit` | Commit content directly (bypass suggestions) | Admin only |

### Claude AI Bot

Bot user: `claude@noblecollective.org`. Authenticates via `x-api-key` header with the key from GCP Secret Manager. Assign book roles in the admin console like any human user. See `docs/claude-editor-prompt.md` for setup instructions.

---

## Adding New Features

### Adding a new masking rule

In `src/public/js/editor-masking.js`, inside `buildMaskingDecorations()`:

- **Short markers** (1-3 chars): Use `hideInline(from, to)` — creates zero-width CSS mark
- **Long tags** (10+ chars): Use `hideBlock(from, to)` — creates replace decoration
- **Visual styling**: Use `mark(from, to, 'cm-your-class')` — always visible
- Add CSS for your class in the masking theme object at the bottom of the file

### Adding a new toolbar control

1. Add HTML in `src/views/session.ejs` inside `.editor-toolbar-right`
2. Add event binding in `src/public/js/editor.js` with the other button bindings
3. Add CSS in `src/public/css/style.css`

### Adding a new Firestore collection

1. Add CRUD functions in `src/server/suggestions.js` (follow `repliesCollection()` pattern)
2. Add API routes in `src/server/suggestion-routes.js`
3. Fetch data in `src/server/index.js` session route, pass to template
4. Add to `window.__EDITOR_DATA` in `src/views/session.ejs`
5. Create Firestore composite indexes as needed

### Adding a Playwright test

Tests live in `tests/editor.spec.js`. Use the existing helpers:

```javascript
await login(page);                    // Dev-only test login
await enterSuggestMode(page);         // Click "Suggest Edits"
await selectText(page, 'word');       // Select via CM API
await replaceWith(page, 'new');       // Type replacement
await cursorAfter(page, 'text');      // Place cursor
await typeText(page, 'new text');     // Type at cursor
await deleteSelection(page);          // Backspace
const raw = await getRawDoc(page);    // Get raw markdown
await waitForAutoSave(page);          // Wait for Firestore save
```

---

## License

Private repository. All rights reserved by Noble Collective.
