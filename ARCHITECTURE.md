# Noble Imprint Resource Website — Architecture Document

## Project Overview

This document captures the architecture for a public website that serves the Noble Imprint resource library. The website renders markdown-based books, series, and sessions from the Noble-Imprint-Resources GitHub repository. It also provides an authenticated editing workflow where reviewers can suggest changes and editors can accept or reject them — all while preserving the resources repo as the single source of truth.

### Repositories

| Repository | Purpose | Contains |
|---|---|---|
| **Noble-Imprint-Resources** | Content source of truth | Markdown sessions, cover images, meta.json files. Consumed by both the mobile app and this website. No application code. |
| **Noble-Imprint-Resource-Website** | Website application | Server code, rendering engine, editor UI, authentication, CI/CD, deployment config. Hosted at `resources.noblecollective.org`. |

The resources repo is never modified by hand as part of the website workflow — changes flow through GitHub API commits triggered by the website application when suggestions are accepted.

---

## Resources Repo Structure

The resources repo encodes the content hierarchy through its directory structure. Every level has a `meta.json` file that provides metadata used by both the mobile app and the website.

### Directory Hierarchy

```
Noble-Imprint-Resources/
├── series/
│   ├── Narrative Journey Series/          # Series
│   │   ├── meta.json                      # { title, subtitle, order }
│   │   ├── commonSeries.md                # Shared content appended to all books in series
│   │   ├── Essentials/                    # Sub-series
│   │   │   ├── meta.json                  # { title, subtitle, order }
│   │   │   ├── commonSubseries.md         # Shared content for sub-series
│   │   │   ├── The Story Behind It All/   # Book
│   │   │   │   ├── meta.json              # { title, subtitle, order, color, banner }
│   │   │   │   ├── cover.svg
│   │   │   │   ├── commonBook.md
│   │   │   │   └── sessions/
│   │   │   │       └── session1.md        # Actual content
│   │   │   ├── The Bond Between Us/       # Book
│   │   │   └── ...
│   │   ├── Foundations/                    # Sub-series
│   │   │   ├── The Call of Christ/        # Book (multiple sessions)
│   │   │   │   └── sessions/
│   │   │   │       ├── 1-FrontMatter.md
│   │   │   │       ├── 2-SeriesOrientation.md
│   │   │   │       ├── 3-Intro-The Opening.md
│   │   │   │       ├── 4-Session1-TheGospel.md
│   │   │   │       └── ...
│   │   │   └── L'Appel du Christ/         # Book (French translation)
│   │   └── Pathways/                      # Sub-series
│   ├── Passage Series/                    # Series (has sub-series: BaseCamp, Venture)
│   ├── Liturgies/                         # Series (books directly, no sub-series)
│   │   ├── A Table In the Wilderness/     # Book directly under series
│   │   └── Come Let Us Adore Him/
│   └── Spiritual Journals/               # Series
└── bibles/                                # NOT included in website (mobile app only)
    ├── kjv/
    └── bsb/
```

### Key Observations

**Two hierarchy patterns exist.** Some series have sub-series (Narrative Journey → Essentials, Foundations, Pathways). Others go directly to books (Liturgies → A Table in the Wilderness). The website build must handle both.

**Every level has `meta.json`.** The consistent structure at each level is:

- **Series level**: `{ title, subtitle, order }` — display name and sort order among series.
- **Sub-series level**: `{ title, subtitle, order }` — display name and sort order within the parent series.
- **Book level**: `{ title, subtitle, order, color, banner }` — includes heading color map for the mobile app and a `banner` field used for publication status.

**The `banner` field is the publication status system.** Current values observed in the repo:
- `"Preview"` — content is in preview, not yet released.
- `"Pre-Release"` — content is approaching release but not final.
- Absent (no banner field) — content is published and public.

For the website, we add one new value:
- `"Hidden"` — content is excluded from the website entirely.

**Shared content files** (`commonSeries.md`, `commonSubseries.md`, `commonBook.md`) contain reusable content blocks with custom XML-like tags. These are used by the mobile app to inject shared prompts into sessions. The website may render these as part of the session view or handle them separately.

**Session files use custom markdown syntax** (detailed in the Custom Markdown Syntax section below). The website's rendering engine and editing tools must fully understand this syntax.

### Custom Markdown Syntax

The markdown files use standard markdown plus several custom extensions required by the mobile app. These must be preserved exactly — the mobile app depends on this precise syntax.

**`<Question id=...>...</Question>`** — Interactive question/response fields with unique IDs. The content inside is the question prompt. On the website, these render as styled question blocks. In the editor, the tags are hidden but the content is editable. The `id` attribute is globally unique and serves as a reliable anchor point.

```markdown
<Question id=TheCallSes1-Hearing-Q1>1. What happened when the Holy Spirit
came upon the Christians? **Acts 2:1–13**: </Question>
```

**`<Callout>...</Callout>`** — Inline callout/highlight blocks. These appear mid-paragraph (not on their own line), wrapping text that should receive special visual emphasis.

```markdown
...Jesus cared for people. <Callout>All who genuinely believe in Jesus
receive the forgiveness of sins.</Callout> This message of salvation...
```

**`<< text`** — Right-aligned attribution. Used after block quotes to show the source (scripture reference, author name). The `<<` marker at the start of a line signals right-alignment of everything following it.

```markdown
> _He himself bore our sins in his body on the tree..._
<< **1 Peter 2:24–25**
```

**`<IntroductionNote>`, `<ReflectionPrompt>`, `<DeepDivePrompt>`, `<ClosingThoughts>`, `<WrapUpNotes>`** — Structural section tags in `commonSeries.md` and `commonSubseries.md` files. These wrap reusable content blocks.

**`<br>`** — Standard HTML break tags used for vertical spacing.

**Standard markdown used precisely:** The heading hierarchy (`#` through `#####`) maps to specific colors via `meta.json`. Block quotes, bold, italic, tables, and lists are all used with intentional formatting that must be preserved.

---

## Website Repo Structure

```
Noble-Imprint-Resource-Website/
├── .github/
│   └── workflows/
│       └── deploy.yaml              # CI/CD: build and deploy on push or dispatch
├── src/
│   ├── server/                       # Node.js server (Express or similar)
│   │   ├── index.js                  # Entry point, routes
│   │   ├── auth.js                   # Google login / Firebase Auth
│   │   ├── github.js                 # GitHub API client (read content, commit changes)
│   │   └── suggestions.js            # Suggestion CRUD, acceptance logic
│   ├── renderer/                     # Custom markdown rendering engine
│   │   ├── parser.js                 # Markdown + custom syntax parser
│   │   ├── html-renderer.js          # Render to HTML for public reading
│   │   └── codemirror-decorations.js # Decoration definitions for masked editor
│   ├── editor/                       # CodeMirror-based masked editor
│   │   ├── editor.js                 # Editor initialization, suggestion mode
│   │   └── diff.js                   # Diff computation for suggestions
│   ├── public/                       # Static assets (CSS, client JS, images)
│   └── views/                        # HTML templates / components
│       ├── library.html              # Series/book browsing
│       ├── session.html              # Reading view for a session
│       ├── editor.html               # Editor view with suggestion mode
│       └── review.html               # Suggestion review queue
├── website-config.yaml               # Publication status overrides, role definitions
├── Dockerfile                        # Container for Cloud Run
├── package.json
└── ARCHITECTURE.md                   # This document
```

---

## Configuration

### website-config.yaml

The website config lives in the website repo and controls web-specific concerns: role definitions and status overrides. It does NOT duplicate the content structure — that is read directly from the resources repo's `meta.json` files and directory structure.

```yaml
# Role definitions for authenticated users.
# Users not listed here see only public content.
roles:
  previewer:    # Can see Preview and Pre-Release content
    - "reviewer@noblecollective.org"
  editor:       # Can suggest edits to any content
    - "author@noblecollective.org"
  approver:     # Can accept/reject suggestions and commit to repo
    - "lead@noblecollective.org"
    - "editor@noblecollective.org"

# Status overrides for specific books (by repo path).
# Most books use the banner field from their meta.json.
# Only list exceptions here.
status_overrides:
  # Example: force-hide a book that has no banner but shouldn't be on the website
  # "series/Spiritual Journals/Sacred Markings": "Hidden"
```

### Publication Status Logic

The website determines visibility for each book using the following rules (in order):

1. If `status_overrides` in `website-config.yaml` has an entry for this book's path, use that status.
2. Otherwise, read the `banner` field from the book's `meta.json`.
3. If no banner field exists and no override is set, the book is **public**.

| Status | Behavior |
|---|---|
| (none / absent) | Fully public. Visible to all visitors. |
| `"Preview"` | Visible only to authenticated users with `previewer`, `editor`, or `approver` role. |
| `"Pre-Release"` | Same as Preview — visible only to authenticated users with appropriate roles. |
| `"Hidden"` | Not rendered on the website at all. Invisible to everyone. |

### Bibles Exclusion

The `bibles/` directory in the resources repo is excluded from the website entirely. The build process only reads from `series/`. Bible content is used only by the mobile app.

---

## Authentication and Authorization

### Technology: Firebase Authentication with Google Provider

Firebase Auth handles the OAuth flow, session management, and token validation. Users sign in with their Google account. The server validates the Firebase ID token on each request and checks the user's email against the role definitions in `website-config.yaml`.

### Authentication Flow

1. User clicks "Sign in" on the website.
2. Firebase Auth SDK initiates Google OAuth flow.
3. User authenticates with Google and is redirected back.
4. The client receives a Firebase ID token and sends it with subsequent requests.
5. The server validates the token (via Firebase Admin SDK), extracts the user's email, and looks up their role in `website-config.yaml`.
6. The role determines what the user can see and do.

### Role Hierarchy

| Role | Can view public | Can view Preview/Pre-Release | Can suggest edits | Can accept/reject suggestions |
|---|---|---|---|---|
| Anonymous | Yes | No | No | No |
| Authenticated (no role) | Yes | No | No | No |
| `previewer` | Yes | Yes | No | No |
| `editor` | Yes | Yes | Yes | No |
| `approver` | Yes | Yes | Yes | Yes |

Roles are additive — an `approver` has all capabilities of `editor` and `previewer`.

---

## Build and Deploy Pipeline

### Hosting: Google Cloud Run

The website runs as a containerized Node.js application on Cloud Run. This provides server-side rendering, authentication middleware, and GitHub API integration — all required for the editing workflow.

**Domain**: `resources.noblecollective.org` (configured via Cloud Run domain mapping or a load balancer with SSL certificate).

### CI/CD: GitHub Actions

Two triggers cause the website to build and deploy:

**Trigger 1: Push to the website repo.** Any push to `main` in Noble-Imprint-Resource-Website triggers a build and deploy. This covers template changes, CSS updates, config changes (like publishing a new book by removing a status override), and code changes.

**Trigger 2: Cross-repo dispatch from the resources repo.** A GitHub Actions workflow in Noble-Imprint-Resources fires a `repository_dispatch` event to Noble-Imprint-Resource-Website whenever content is pushed to `main`. This ensures the website updates automatically when any markdown file, cover image, or meta.json changes.

### Resources Repo Workflow (added to Noble-Imprint-Resources)

```yaml
# .github/workflows/notify-website.yaml
name: Notify Website
on:
  push:
    branches: [main]
jobs:
  notify:
    runs-on: ubuntu-latest
    steps:
      - name: Trigger website rebuild
        uses: peter-evans/repository-dispatch@v3
        with:
          token: ${{ secrets.WEBSITE_REPO_TOKEN }}
          repository: Noble-Collective/Noble-Imprint-Resource-Website
          event-type: content-updated
```

### Website Repo Workflow

```yaml
# .github/workflows/deploy.yaml
name: Build and Deploy
on:
  push:
    branches: [main]
  repository_dispatch:
    types: [content-updated]
jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Set up Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'

      - name: Install dependencies
        run: npm ci

      - name: Build
        run: npm run build

      - name: Deploy to Cloud Run
        uses: google-github-actions/deploy-cloudrun@v2
        with:
          service: noble-imprint-resources
          region: us-central1
          source: .
```

### How the Server Fetches Content

The server does NOT clone the resources repo or use git submodules. Instead, it reads content on-demand via the GitHub API (or caches it in memory/Redis with a short TTL). When a page is requested:

1. The server reads the directory structure and `meta.json` files to build the navigation tree (this can be cached and invalidated on deploy).
2. For a specific session page, it fetches the markdown file content from GitHub.
3. The rendering engine parses the markdown (including custom syntax) and produces HTML.
4. The HTML is served to the user.

For the editing workflow, the server also writes to the resources repo via GitHub API (creating commits when suggestions are accepted).

### GitHub App / Token

The website repo needs a GitHub token (or GitHub App installation token) with:
- **Read access** to Noble-Imprint-Resources (to fetch content).
- **Write access** to Noble-Imprint-Resources (to commit accepted suggestions).

A GitHub App installed on both repos is the cleanest approach — it provides scoped permissions and doesn't depend on a personal access token.

---

## Custom Markdown Rendering Engine

The rendering engine is the most critical component. It serves three purposes:

1. **Public reading view**: Renders markdown to HTML for website visitors.
2. **Editor preview**: Renders content for the suggestion review interface.
3. **CodeMirror decorations**: Defines which syntax elements to hide/style in the masked editor.

### Rendering Requirements

The engine must handle all standard markdown features plus the custom syntax documented above. Key rendering rules:

| Syntax | Rendered Output |
|---|---|
| `<Question id=...>...</Question>` | Styled question block with visual treatment (background, border, etc.). ID is not displayed. |
| `<Callout>...</Callout>` | Highlighted/emphasized inline text within the paragraph flow. |
| `<< text` | Right-aligned text block (used for attributions after block quotes). |
| `<IntroductionNote>` etc. | Styled section containers with appropriate visual treatment. |
| Heading hierarchy (`#`–`#####`) | Standard HTML headings, potentially with colors from `meta.json`. |
| `> ` block quotes | Styled block quote elements. |
| `<br>` | Line break / vertical spacing. |

### Implementation Approach

Use a markdown parsing library (such as `markdown-it` or `unified`/`remark`) extended with custom plugins for each non-standard syntax element. The parser produces an AST that can be rendered to HTML (for reading) or used to generate CodeMirror decorations (for editing).

---

## Editing Workflow — The Masked Editor Approach

### Core Concept

The editing experience uses CodeMirror 6 with a decoration layer that hides structural syntax while keeping it physically present in the document buffer. Users see clean, formatted text but are directly editing the raw markdown. This eliminates any lossy transformation — when a user makes a change, the diff is against the actual file content, character for character.

### What the User Sees vs. What's in the Buffer

When a user opens a session in edit mode, CodeMirror loads the raw markdown file. Decorations visually transform it:

| In the buffer (hidden) | User sees |
|---|---|
| `#### Jesus' Crucifixion` | **Jesus' Crucifixion** (styled as H4) |
| `<Callout>The good news...</Callout>` | The good news... (with highlight background) |
| `<Question id=TheCallSes1-Q1>1. What happened?</Question>` | 1. What happened? (with question styling) |
| `<< **1 Peter 2:24**` | **1 Peter 2:24** (right-aligned) |
| `**bold text**` | **bold text** |
| `_italic text_` | *italic text* |

The structural markers (`<Question id=...>`, `</Question>`, `<Callout>`, `</Callout>`, `<<`, `#`, `**`, `_`, `>`) are present in the buffer but rendered as zero-width atomic ranges. The cursor skips over them. Users cannot accidentally select, delete, or modify structural syntax.

### Cursor and Selection Behavior

CodeMirror's atomic range decorations handle cursor navigation naturally:
- Arrow keys skip over hidden syntax — the cursor jumps from one visible character to the next.
- Text selection across hidden boundaries includes the hidden characters in the buffer selection but only highlights visible text on screen.
- Backspace/delete at a boundary stops before entering a hidden range (the structural syntax acts as an invisible wall).

### Boundary Behavior Rules

| Scenario | Behavior |
|---|---|
| Typing at the end of text inside `<Question>` | New text stays inside the Question block |
| Pressing Enter after a heading | New line goes below the heading as body text |
| Deleting all visible text inside `<Callout>` | The empty Callout tags remain (structural syntax protected) |
| Pasting text that contains markdown syntax | Pasted as literal text (no re-parsing of pasted content in the raw buffer) |

### Advanced Edit Toggle

A "View source" toggle switches off all decorations, revealing the raw markdown. This is available for power users who need to make structural changes (adding a new `<Question>` block, changing a heading level, etc.). Structural changes are expected to be rare and made by people who understand the markdown format.

---

## Suggestion System

### How Suggestions Work

1. An authenticated user with `editor` role opens a session and clicks "Suggest edits."
2. The server fetches the current file content from the resources repo and records the commit SHA.
3. CodeMirror loads the content with the masked decoration layer.
4. The user edits the visible text — making insertions, deletions, or replacements.
5. When finished, the user clicks "Submit suggestions."
6. The client computes a diff between the original content and the edited content.
7. The diff and commit SHA are stored in the website's database as a pending suggestion.

### Suggestion Data Model

```
suggestion:
  id: "uuid"
  file_path: "series/Narrative Journey Series/Foundations/The Call of Christ/sessions/4-Session1-TheGospel.md"
  base_commit_sha: "9325c77c1e578d3adcc19e0bbb5218e118f66995"
  diff: "<unified diff or structured patch>"
  original_content: "<full file content at time of suggestion>"
  modified_content: "<full file content after user's edits>"
  author_email: "reviewer@noblecollective.org"
  comment: "Tightened language in the Introduction section"
  status: "pending"     # pending | accepted | rejected | stale
  created_at: "2026-04-08T..."
  resolved_at: null
  resolved_by: null
```

Storing both the full original and modified content (in addition to the diff) provides maximum flexibility for rendering the review view and handling edge cases.

### Suggestion Review Workflow

1. An `approver` visits the review queue on the website.
2. They see a list of pending suggestions, grouped by file.
3. Opening a suggestion shows a rendered diff view: the session content with strikethroughs for deletions and colored text for insertions (rendered through the same markdown engine, not as raw diff output).
4. The approver can:
   - **Accept**: The server applies the changes and commits the modified file to the resources repo.
   - **Reject**: The suggestion is marked as rejected and discarded.
   - **Edit before accepting**: The approver can open the modified version in the masked editor, make adjustments, then accept.

### Conflict Detection — Optimistic Locking with SHA Check

When an approver clicks "Accept," the server performs the following:

1. Fetch the current file from the resources repo via GitHub API.
2. Compare the current commit SHA with the suggestion's `base_commit_sha`.
3. **If SHAs match**: The file hasn't changed. Apply the modification and commit.
4. **If SHAs differ**: The file was modified since the suggestion was created. Mark the suggestion as `stale` and notify the approver: "This file has been modified since the suggestion was made. Please review the suggestion against the updated content."

For stale suggestions, the approver can view both the suggested changes and the upstream changes, then decide whether the suggestion is still applicable.

### Courtesy Locking (Application Level)

The website's database tracks active editing sessions. When a user opens a file for editing, a record is created with their email and a heartbeat timestamp. If another user navigates to the same file for editing, they see an advisory message: "Jane is currently editing this file." The lock expires automatically after 30 minutes of inactivity (no heartbeat).

This is advisory, not enforced — it prevents wasted effort but doesn't block anyone. The SHA-based conflict detection is the safety net.

### Suggestion Overlap Prevention

To keep the suggestion system simple and reliable, the UI enforces a rule: **a file with a pending suggestion cannot have a new suggestion submitted against it until the existing suggestion is accepted or rejected.** This prevents the complexity of reconciling overlapping or conflicting suggestions against the same file.

If a user tries to suggest edits on a file that already has a pending suggestion, the UI shows: "This file has a pending suggestion from [author]. Please wait for it to be reviewed before submitting new suggestions."

---

## Phased Implementation Plan

### Phase 1: Public Website (Read-Only)

**Goal**: A live website at `resources.noblecollective.org` where anyone can browse and read the resource library.

**Deliverables**:
- Node.js server on Cloud Run.
- Custom markdown rendering engine (handles all custom syntax).
- Library browsing UI (series → sub-series → books → sessions).
- Session reading view with proper rendering of Questions, Callouts, right-aligned attributions, etc.
- CI/CD pipeline with cross-repo dispatch (resources repo push → website rebuild).
- `website-config.yaml` with status logic (Hidden, Preview, Pre-Release, public).

**No authentication in Phase 1** — all content shown is public (books without a banner or with a non-restricting banner). Preview/Pre-Release content is simply not rendered.

### Phase 2: Authentication and Gated Content

**Goal**: Add Google login so authorized users can see Preview and Pre-Release books.

**Deliverables**:
- Firebase Auth integration with Google sign-in.
- Role-based access control reading from `website-config.yaml`.
- Preview/Pre-Release books visible to authenticated users with appropriate roles.
- User session management (login, logout, token refresh).

### Phase 3: Suggestion and Editing Workflow

**Goal**: Authenticated editors can suggest changes; approvers can review and accept them.

**Deliverables**:
- CodeMirror 6 masked editor with decorations for all custom syntax.
- Suggestion submission and storage (Firestore or Cloud SQL).
- Suggestion review queue and rendered diff view.
- Acceptance flow: SHA check → commit to resources repo via GitHub API.
- Courtesy locking and suggestion overlap prevention.
- "View source" toggle for advanced users.

---

## Technology Summary

| Component | Technology | Rationale |
|---|---|---|
| Server | Node.js (Express) | Lightweight, excellent GitHub API libraries, good CodeMirror ecosystem |
| Hosting | Google Cloud Run | Serverless containers, scales to zero, easy HTTPS/domain setup |
| Authentication | Firebase Auth (Google provider) | Managed OAuth, free tier sufficient, integrates with Google Cloud |
| Content source | GitHub API (Octokit) | Read markdown on-demand, commit accepted changes, no git clone needed |
| Markdown rendering | markdown-it or unified/remark with custom plugins | Extensible parser that can handle custom syntax |
| Editor | CodeMirror 6 | Decoration system for masked editing, excellent extension API, lightweight |
| Suggestion storage | Cloud Firestore | Simple document store, serverless, no infrastructure to manage |
| CI/CD | GitHub Actions | Native cross-repo dispatch, Cloud Run deployment actions available |
| Domain / SSL | Cloud Run domain mapping or Cloud Load Balancer | HTTPS for `resources.noblecollective.org` |

---

## Open Decisions

The following items need to be decided during implementation but don't affect the architecture:

1. **Visual design and layout** of the website (browsing experience, reading experience, typography, color scheme).
2. **Caching strategy** for content fetched from GitHub (in-memory with TTL, Redis, or rebuild-on-deploy with static content).
3. **Mobile responsiveness** requirements for the reading and editing views.
4. **How `commonSeries.md` / `commonSubseries.md` / `commonBook.md` are rendered** — whether their content is injected into session pages, shown as separate sections, or handled differently from the mobile app.
5. **Notification system** for suggestion submissions and reviews (email, in-app, or both).
6. **Whether to support multiple concurrent suggestions per file** in a future phase (current design limits to one pending suggestion per file for simplicity).
