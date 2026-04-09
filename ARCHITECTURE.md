# Noble Imprint Resource Website

## What we're building and why

Noble Imprint publishes a growing library of discipleship resources — series, books, and sessions — all authored in markdown and managed in a single GitHub repository. That repository is the source of truth. It already feeds the mobile app, and every character of every file matters.

This project adds two new capabilities on top of that source of truth:

1. **A public website** where anyone can browse and read the resource library online at `resources.noblecollective.org`.
2. **A collaborative editing workflow** where authorized reviewers can suggest changes to book content — similar to Google Docs' "suggestion mode" — while the markdown files in GitHub remain the single, canonical source of truth.

Both capabilities live in a single web application, hosted separately from the content itself. The content repo is never cluttered with website code, and the mobile app build is never affected.

---

## Core principles

**The markdown is king.** The GitHub resources repo (`Noble-Imprint-Resources`) is the single source of truth for all content. Every other system — the mobile app, the website, the editor — reads from it and writes back to it. No content lives anywhere else.

**Your files are never at risk.** The editing workflow cannot corrupt, reformat, or silently alter your markdown. The custom syntax (`<Question>` tags, `<<` attributions, `<Callout>` blocks, heading hierarchies) is structurally protected. A reviewer working in suggestion mode literally cannot touch the tags — only the text content inside them.

**Changes only happen through Git.** When a suggestion is accepted, the result is a normal Git commit to the resources repo — the same kind of commit you'd make from Obsidian or any other tool. The full commit history is preserved. You can always see exactly what changed, when, and who approved it.

**The website is a window, not a copy.** The website reads content directly from the GitHub repo on demand. It doesn't maintain its own copy of the markdown. When you push a change to the resources repo (from Obsidian, VS Code, GitHub, or anywhere else), the website automatically updates.

---

## Two goals, three phases

### Goal 1: A live website for reading resources

Visitors arrive at `resources.noblecollective.org` and see the full library organized by series, sub-series, and books. They can browse, open a book, and read its sessions — all rendered beautifully from the same markdown files that power the mobile app.

Books marked as "Hidden" (a new tag) won't appear at all, and other books marked as "Preview" or "Pre-Release" will indicate that to the user with a kind of banner.

### Goal 2: A collaborative editing workflow

An authorized reviewer opens a session on the website and clicks "Suggest edits." They see the content displayed as clean, readable text — headings are styled, questions have visual treatment, attributions are right-aligned. It looks like a polished reading experience, not raw markdown.

But behind the scenes, they're editing the actual markdown file. When they change a word, they're changing it in the real file. When they delete a sentence, it's deleted in the real file. The structural syntax — the `<Question id=...>` tags, the `<Callout>` wrappers, the `<<` markers, the `#` headings — is invisible and untouchable. The editor simply cannot break it.

When finished, they submit their suggestions. An admin reviews the changes (shown as colored insertions and strikethrough deletions), and with one click, the accepted changes are committed to the GitHub repo — flowing through to both the website and the next mobile app build.

### The three phases

**Phase 1 — Public website (read-only).** Build the website, the rendering engine for custom markdown, the browsing interface, and the automatic deployment pipeline. Anyone can read public content. No login required. Preview/Pre-Release books are visible with a status banner. Hidden books are excluded.

**Phase 2 — Authentication and editing workflow.** Add Google sign-in and the masked editor. Authenticated users with the suggest-comment role can suggest changes and leave comments; admins can review and accept them, committing changes back to the resources repo.

---

## How it all fits together

There are three separate systems, each with a clear job:

```
┌─────────────────────────────────────────────────────────────────────────┐
│                                                                         │
│   Noble-Imprint-Resources  (GitHub repo)                                │
│   ─────────────────────────────────────                                 │
│   The source of truth. Markdown files, cover images, meta.json.         │
│   Consumed by the mobile app AND the website.                           │
│   Never contains website code.                                          │
│                                                                         │
└──────────────┬──────────────────────────────────────┬───────────────────┘
               │                                      │
               │  reads content (GitHub API)           │  triggers rebuild
               │                                      │  (GitHub Actions)
               ▼                                      ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                                                                         │
│   Noble-Imprint-Resource-Website  (GitHub repo + Cloud Run)             │
│   ─────────────────────────────────────────────────────────             │
│   The web application. Rendering engine, authentication,                │
│   browsing UI, editing tools, suggestion storage.                       │
│   Hosted at resources.noblecollective.org.                              │
│                                                                         │
│   When a suggestion is accepted, it commits the change                  │
│   back to the resources repo via GitHub API.                            │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────┐
│                                                                         │
│   Mobile App  (separate build process)                                  │
│   ──────────────────────────────────                                    │
│   Also reads from Noble-Imprint-Resources.                              │
│   Completely independent. Unaffected by the website.                    │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### The suggest and edit flow

When someone suggests an edit through the website, this is how the change flows from suggestion to published content:

```
  A reviewer opens a session and clicks "Suggest edits"
                      │
                      ▼
  ┌──────────────────────────────────────┐
  │  Website loads the raw markdown      │
  │  from the resources repo and         │
  │  displays it in the masked editor    │
  │  (structural syntax hidden,          │
  │  formatted text visible)             │
  └──────────────────┬───────────────────┘
                     │
                     │ Reviewer makes changes to visible
                     │ text and clicks "Submit"
                     ▼
  ┌──────────────────────────────────────┐
  │  Website computes a diff and         │
  │  stores the suggestion in its        │
  │  database. The resources repo        │
  │  is NOT changed yet.                 │
  └──────────────────┬───────────────────┘
                     │
                     │ Admin opens the review queue
                     │ and reviews the suggestion
                     ▼
  ┌──────────────────────────────────────┐
  │  Admin sees rendered diff:           │
  │  red strikethrough = deletions       │
  │  green text = insertions             │
  │                                      │
  │  Clicks "Accept" or "Reject"         │
  └──────────────────┬───────────────────┘
                     │
                     │ If accepted:
                     ▼
  ┌──────────────────────────────────────┐
  │  Website checks: has the file        │
  │  changed since the suggestion?       │
  │  (SHA comparison)                    │
  │                                      │
  │  If unchanged: commits the edit      │
  │  to the resources repo via           │
  │  GitHub API.                         │
  │                                      │
  │  If changed: flags as "stale,"       │
  │  asks admin to re-review.            │
  └──────────────────┬───────────────────┘
                     │
                     │ Commit triggers automatic
                     │ website rebuild
                     ▼
  ┌──────────────────────────────────────┐
  │  resources.noblecollective.org       │
  │  now shows the updated content.      │
  │                                      │
  │  The resources repo has a clean      │
  │  Git commit with the change.         │
  │  Mobile app picks it up on           │
  │  next build.                         │
  └──────────────────────────────────────┘
```

The key point: at no stage is the resources repo in a dirty or intermediate state. The edit either commits cleanly or doesn't commit at all.

---

## How the editing workflow protects your files

This is the part that matters most for anyone who cares about the integrity of the source files. Here's how the suggestion system works at each step, and why your markdown is never at risk.

### What the reviewer sees

When a reviewer opens a session in edit mode, they see formatted text — not raw markdown. Headings look like headings. Questions have a visual border. Callouts have a subtle highlight. Bold is bold, italic is italic. Attributions are right-aligned.

But this isn't a separate rendering — it's the actual markdown file displayed with visual styling on top. Think of it like looking at your markdown through a window that hides the syntax characters. The `<Question id=TheCallSes1-Q1>` tag is physically present in the file but visually invisible. The cursor skips right over it. You can't select it, delete it, or change it.

```
What's in the file:                What the reviewer sees:

#### Jesus' Crucifixion            Jesus' Crucifixion (styled as heading)

<Callout>The good news of         The good news of the gospel...
the gospel...</Callout>            (with highlight background)

<Question id=Ses1-Q3>             3. How does this message announce
3. How does this message           the good news?
announce the good news?            (with question styling)
</Question>

<< **1 Peter 2:24**               1 Peter 2:24 (right-aligned, bold)
```

### What happens when they edit

The reviewer changes a word or sentence. Because they're editing the actual file content (with structural syntax hidden), the change is a precise character-level edit to the real markdown. There is no "conversion" step. There is no re-serialization. No round-tripping. The file goes in, the reviewer edits visible text, and the file comes out with only those visible characters changed.

### What happens when they submit

When the reviewer clicks "Submit suggestions," the system computes a diff — the exact differences between the original file and the edited version. This diff, along with the Git commit identifier (SHA) of the file at the time of editing, is stored in the website's database as a pending suggestion.

The original file in the resources repo is untouched at this point. Nothing has been committed. The suggestion is just a record of "here's what I'd change."

### What happens when an admin accepts

An admin reviews the suggestion, seeing the changes rendered visually (deletions in red strikethrough, insertions in green). If they accept, the system does the following:

1. Fetches the current file from the resources repo.
2. Checks: has this file changed since the suggestion was made? (It compares the stored commit SHA against the current one.)
3. If the file hasn't changed: applies the edit and commits it to the resources repo. Done.
4. If the file *has* changed (someone else edited it in the meantime): flags the suggestion as "stale" and asks the admin to review it against the updated content. The edit is never applied blindly.

### Safety guarantees

- **Structural syntax is untouchable** in the normal editor. The `<Question>`, `<Callout>`, `<<`, and other custom tags are hidden and cursor-inaccessible.
- **A "View source" toggle** is available for power users who need to make structural changes (adding a new Question block, changing heading levels). This requires understanding the markdown format.
- **One suggestion per file at a time.** While a suggestion is pending on a file, no one else can submit a different suggestion for that same file. This prevents conflicting edits.
- **Advisory locking.** When someone opens a file for editing, other users see "Jane is currently editing this file." This is informational — the real safety net is the SHA check at acceptance time.
- **Every accepted change is a Git commit** with a clear message and author. The full history is always available.

---

## Who can do what

The website uses Google sign-in for authentication. Access levels are defined in a simple configuration file:

| Role | Browse and read content | Suggest edits and leave comments | Accept / reject suggestions |
|---|---|---|---|
| **Anyone** (no login) | Yes | — | — |
| **Suggest-Comment** | Yes | Yes | — |
| **Admin** | Yes | Yes | Yes |

Roles are assigned by email address in the website's configuration file. Adding or removing someone's access is a one-line change.

---

## How books appear (or don't) on the website

The website reads each book's `meta.json` to determine its visibility. The existing `banner` field drives this:

| `banner` value in meta.json | Website behavior |
|---|---|
| *(not present)* | Fully public — no status indicator |
| `"Preview"` | Public, shown with a "Preview" banner |
| `"Pre-Release"` | Public, shown with a "Pre-Release" banner |
| `"Hidden"` | Not shown on the website at all |

This means: to publish a book on the website, just remove the `banner` field from its `meta.json` (or never add one). To hide a book, set `"banner": "Hidden"`. No website configuration changes needed for most cases.

For rare exceptions — like hiding a book on the website that doesn't have a "Hidden" banner in its `meta.json` — a small overrides section in the website's configuration handles it.

---

## Technical architecture

*The sections below are for developers building and maintaining the system.*

### Hosting and deployment

The website runs as a containerized Node.js application on Google Cloud Run, deployed at `resources.noblecollective.org`. Cloud Run is serverless — it scales to zero when no one is using the site and scales up automatically under load.

Two GitHub Actions workflows trigger deployment:

1. **Any push to the website repo's main branch** (code changes, CSS updates, config changes).
2. **A cross-repo dispatch from the resources repo** (content changes). The resources repo has a small workflow that notifies the website repo whenever content is pushed.

### Content fetching

The server reads content from the resources repo via the GitHub API on demand. It does not clone the repo or use git submodules. A caching layer (in-memory with TTL, invalidated on deploy) prevents excessive API calls. The navigation tree (series → sub-series → books) is built from the directory structure and `meta.json` files.

### Custom markdown rendering engine

The rendering engine is the most critical component. It parses the markdown files (including all custom syntax) and produces HTML for reading, or generates CodeMirror decorations for editing. It uses an extensible markdown parser (such as `markdown-it` or `unified`/`remark`) with custom plugins for each non-standard element:

| Custom syntax | What the plugin does |
|---|---|
| `<Question id=...>...</Question>` | Renders as a styled question block; hides the tags in the editor |
| `<Callout>...</Callout>` | Renders as highlighted inline text; hides the tags in the editor |
| `<< text` | Renders as right-aligned attribution; hides the `<<` marker in the editor |
| `<IntroductionNote>` etc. | Renders as styled section containers |
| `<br>` | Renders as vertical spacing |
| Heading hierarchy (`#` – `#####`) | Renders as HTML headings, with optional colors from `meta.json` |

### The masked editor (CodeMirror 6)

The editing experience uses CodeMirror 6 — a code editor framework — with a "decoration" layer that hides structural syntax while keeping it physically present in the document buffer.

CodeMirror's "replace decorations" render a range of characters as zero-width (invisible) while applying visual styling to the content between them. "Atomic ranges" make the cursor skip over hidden characters. The result is that users see beautifully formatted text, but every keystroke operates on the real markdown characters.

Key technical details:

- **Decorations are computed from the same parser** that powers the public reading view. One parser, two outputs: HTML for reading and CodeMirror decorations for editing.
- **Atomic ranges protect structural syntax.** The cursor treats each hidden tag as a single indivisible unit. Backspace at a boundary stops before entering the hidden range.
- **Boundary behaviors are defined per element type.** Typing at the end of a Question block keeps new text inside the block. Pressing Enter after a heading inserts a new line below.
- **Pasted text is inserted literally** — no re-parsing of pasted content. What you paste is what goes into the buffer.

### Suggestion storage and diff model

Suggestions are stored in Cloud Firestore (or a simple database). Each suggestion records:

```
id:                Unique identifier
file_path:         Path to the file in the resources repo
base_commit_sha:   The Git commit SHA when the suggestion was created
original_content:  Full file content at time of suggestion
modified_content:  Full file content after the user's edits
diff:              Computed diff between original and modified
author_email:      Who made the suggestion
comment:           Optional description of the changes
status:            pending | accepted | rejected | stale
created_at:        Timestamp
resolved_at:       Timestamp (when accepted/rejected)
resolved_by:       Email of the admin
```

Storing both the full original and modified content (along with the diff) provides flexibility for rendering the review view and handles edge cases gracefully.

### Authentication

Firebase Authentication with the Google provider handles OAuth, session management, and token validation. The server validates Firebase ID tokens on each request and checks the user's email against the role definitions in the website configuration file.

### GitHub API integration

The website repo uses a GitHub App (installed on both repos) for scoped API access:

- **Read access** to `Noble-Imprint-Resources` for fetching content.
- **Write access** to `Noble-Imprint-Resources` for committing accepted suggestions.

### Website configuration file

```yaml
# website-config.yaml (lives in the website repo)

roles:
  suggest-comment:
    - "author@noblecollective.org"
  admin:
    - "lead@noblecollective.org"
    - "editor@noblecollective.org"

# Only needed for rare exceptions
status_overrides:
  # "series/Spiritual Journals/Sacred Markings": "Hidden"
```

### Website repo structure

```
Noble-Imprint-Resource-Website/
├── .github/workflows/deploy.yaml      # CI/CD pipeline
├── src/
│   ├── server/                         # Node.js server
│   │   ├── index.js                    # Routes
│   │   ├── auth.js                     # Firebase Auth
│   │   ├── github.js                   # GitHub API client
│   │   └── suggestions.js              # Suggestion logic
│   ├── renderer/                       # Markdown rendering engine
│   │   ├── parser.js                   # Custom syntax parser
│   │   ├── html-renderer.js            # Render to HTML
│   │   └── codemirror-decorations.js   # Editor decorations
│   ├── editor/                         # CodeMirror masked editor
│   │   ├── editor.js                   # Initialization
│   │   └── diff.js                     # Diff computation
│   ├── public/                         # CSS, client JS, images
│   └── views/                          # HTML templates
├── website-config.yaml
├── Dockerfile
├── package.json
└── ARCHITECTURE.md
```

### Technology choices

| Component | Technology | Why |
|---|---|---|
| Server | Node.js (Express) | Lightweight, excellent GitHub API libraries, CodeMirror ecosystem |
| Hosting | Google Cloud Run | Serverless containers, scales to zero, easy domain/SSL setup |
| Auth | Firebase Auth (Google) | Managed OAuth, free tier sufficient, Google Cloud integration |
| Content access | GitHub API (Octokit) | Read on-demand, commit changes, no repo cloning needed |
| Markdown parsing | markdown-it or unified/remark | Extensible with custom plugins for each syntax element |
| Editor | CodeMirror 6 | Decoration system for masked editing, atomic ranges, lightweight |
| Suggestion storage | Cloud Firestore | Simple document store, serverless, no infrastructure to manage |
| CI/CD | GitHub Actions | Native cross-repo dispatch, Cloud Run deployment actions |

---

## Open decisions

These items need to be resolved during implementation but don't affect the architecture:

1. **Visual design and layout** — browsing experience, reading typography, color scheme.
2. **Caching strategy** — in-memory with TTL, Redis, or fully static pre-built pages.
3. **Mobile responsiveness** — requirements for reading and editing on smaller screens.
4. **Common content rendering** — how `commonSeries.md`, `commonSubseries.md`, and `commonBook.md` files are handled (injected into sessions, shown separately, or skipped).
5. **Notifications** — whether suggestion submissions and reviews trigger email or in-app alerts.
6. **Multiple suggestions per file** — currently limited to one at a time for simplicity; may expand later.

---

## Appendix A: Resources repo directory structure

The resources repo uses its directory structure to encode the content hierarchy. The website reads this structure to build its navigation.

```
Noble-Imprint-Resources/
├── series/
│   ├── Narrative Journey Series/          # Series (order: 1)
│   │   ├── meta.json                      # { title, subtitle, order }
│   │   ├── commonSeries.md
│   │   ├── Essentials/                    # Sub-series (order: 2)
│   │   │   ├── meta.json
│   │   │   ├── commonSubseries.md
│   │   │   ├── The Story Behind It All/   # Book (order: 1, banner: "Preview")
│   │   │   │   ├── meta.json
│   │   │   │   ├── cover.svg
│   │   │   │   ├── commonBook.md
│   │   │   │   └── sessions/
│   │   │   │       └── session1.md
│   │   │   ├── The Bond Between Us/
│   │   │   ├── The Glory Due His Name/
│   │   │   ├── The Kingdom Come/
│   │   │   ├── The Open Invitation/
│   │   │   └── The Story Behind It All/
│   │   ├── Foundations/                    # Sub-series (order: 1)
│   │   │   ├── The Call of Christ/        # Book (banner: "Pre-Release")
│   │   │   │   └── sessions/
│   │   │   │       ├── 1-FrontMatter.md
│   │   │   │       ├── 2-SeriesOrientation.md
│   │   │   │       ├── 3-Intro-The Opening.md
│   │   │   │       ├── 4-Session1-TheGospel.md
│   │   │   │       ├── 5-Session2-TheWater.md
│   │   │   │       ├── 6-Session3-TheWay.md
│   │   │   │       └── 7-Conclusion-TheRecall.md
│   │   │   └── L'Appel du Christ/         # French translation
│   │   └── Pathways/                      # Sub-series (order: 3)
│   │       ├── The Aim of Our Charge/
│   │       ├── The Ends of the Earth/
│   │       ├── The Making of a Shepherd/
│   │       └── The Sacred Script/
│   ├── Passage Series/                    # Series (order: 3)
│   │   ├── BaseCamp/                      # Direct book (banner: "Preview")
│   │   └── Venture/
│   ├── Liturgies/                         # Series (order: 4)
│   │   ├── A Table In the Wilderness/     # Direct book (banner: "Preview")
│   │   └── Come Let Us Adore Him/
│   └── Spiritual Journals/               # Series (order: 5)
│       └── Sacred Markings/
└── bibles/                                # Excluded from website
    ├── kjv/
    └── bsb/
```

### Two hierarchy patterns

Some series contain sub-series which contain books (Narrative Journey → Essentials → The Story Behind It All). Others contain books directly (Liturgies → A Table in the Wilderness). The website handles both.

### meta.json at every level

**Series**: `{ "title": "Liturgies", "subtitle": "Ecclesial Liturgies for Christian Pilgrims.", "order": 4 }`

**Sub-series**: `{ "title": "Essentials", "subtitle": "Core discipline for local churches", "order": 2 }`

**Book**: `{ "title": "The Call of Christ", "subtitle": "A Narrative Journey of Christian Faith", "order": 1, "color": { "##": "#000000", ... }, "banner": "Pre-Release" }`

The `order` field controls sort order at each level. The `color` field maps heading levels to colors for the mobile app. The `banner` field controls website visibility.

### Session file naming

Session files within a book are sorted by filename. Two patterns exist: simple numbering (`session1.md`, `session2.md`) and descriptive prefixes (`1-FrontMatter.md`, `2-SeriesOrientation.md`, `4-Session1-TheGospel.md`). The website respects file sort order for navigation.

---

## Appendix B: Custom markdown syntax reference

The markdown files use standard markdown plus these custom extensions. All must be preserved exactly — the mobile app depends on this precise syntax.

### Question blocks

```markdown
<Question id=TheCallSes1-Hearing-Q1>1. What happened when the Holy Spirit
came upon the Christians? **Acts 2:1–13**: </Question>
```

Interactive input fields with globally unique IDs. The website renders these as styled question blocks. The `id` is never displayed but is used internally by the mobile app.

### Callout blocks

```markdown
...Jesus cared for people. <Callout>All who genuinely believe in Jesus
receive the forgiveness of sins.</Callout> This message of salvation...
```

Inline emphasis blocks. These appear mid-paragraph, not on their own line. The text inside gets special visual treatment.

### Right-aligned attributions

```markdown
> _He himself bore our sins in his body on the tree..._
<< **1 Peter 2:24–25**
```

The `<<` at the start of a line signals right-alignment. Used after block quotes for scripture references and author attributions.

### Structural section tags

Used in `commonSeries.md` and `commonSubseries.md` files:

```markdown
<IntroductionNote>...</IntroductionNote>
<ReflectionPrompt>...</ReflectionPrompt>
<DeepDivePrompt>...</DeepDivePrompt>
<ClosingThoughts>...</ClosingThoughts>
<WrapUpNotes>...</WrapUpNotes>
```

### HTML breaks

```markdown
<br>
```

Standard HTML break tags for vertical spacing between sections.
