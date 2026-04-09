# Noble Imprint Resource Website — Full Conversation Context

This document captures the complete context, decisions, concerns, recommendations, and open threads from the architecture planning conversation for the Noble Imprint Resource Website. It is intended to allow someone (or an AI assistant) to pick up this project without missing any context.

**Date of conversation**: April 8–9, 2026
**Repositories**:
- Content source of truth: https://github.com/Noble-Collective/Noble-Imprint-Resources
- Website application: https://github.com/Noble-Collective/Noble-Imprint-Resource-Website
- Architecture document (committed): `ARCHITECTURE.md` in the website repo

---

## Table of Contents

1. [Project Background](#1-project-background)
2. [Repo Structure Analysis](#2-repo-structure-analysis)
3. [Architecture Decisions (Chronological)](#3-architecture-decisions-chronological)
4. [The Editing Workflow — Deep Design Discussion](#4-the-editing-workflow--deep-design-discussion)
5. [Key Concerns Raised and How They Were Addressed](#5-key-concerns-raised-and-how-they-were-addressed)
6. [Final Architecture Summary](#6-final-architecture-summary)
7. [What Was Committed to GitHub](#7-what-was-committed-to-github)
8. [What Has NOT Been Started](#8-what-has-not-been-started)
9. [Open Questions and Future Decisions](#9-open-questions-and-future-decisions)

---

## 1. Project Background

Noble Imprint has a library of discipleship resources (series, sub-series, books, sessions) stored as markdown files in the `Noble-Imprint-Resources` GitHub repo. This repo is already the source of truth for a mobile app — when a new version of the app is built, the resources get compiled into it. The markdown uses custom syntax extensions (detailed below) that the mobile app depends on.

The project has two goals:

**Goal 1**: Create a public website at `resources.noblecollective.org` where anyone can browse and read the resource library, hosted on Google Cloud.

**Goal 2**: Build a collaborative editing workflow (like Google Docs' "suggestion mode") where reviewers can suggest changes to book content through the website, while the markdown files in GitHub remain the single source of truth.

An empty repo (`Noble-Imprint-Resource-Website`) was created to house the website code. The website should automatically update whenever the resources repo changes.

---

## 2. Repo Structure Analysis

The resources repo was thoroughly explored via GitHub API. Here is what was found:

### Top-level structure
```
Noble-Imprint-Resources/
├── series/          # All book content (website reads from here)
├── bibles/          # KJV, BSB — excluded from website, mobile app only
└── README.md
```

### Series within `series/`
| Series | Order | Has Sub-series? |
|---|---|---|
| Narrative Journey Series | 1 | Yes: Essentials (order 2), Foundations (order 1), Pathways (order 3) |
| Passage Series | 3 | Yes: BaseCamp, Venture |
| Liturgies | 4 | No — books directly under series |
| Spiritual Journals | 5 | Has: Sacred Markings |

### Two hierarchy patterns discovered
- **With sub-series**: series → sub-series → books (e.g., Narrative Journey → Essentials → The Story Behind It All)
- **Without sub-series**: series → books directly (e.g., Liturgies → A Table in the Wilderness)

The website must handle both patterns.

### meta.json at every level

**Series level**: `{ "title": "Liturgies", "subtitle": "Ecclesial Liturgies for Christian Pilgrims.", "order": 4 }`

**Sub-series level**: `{ "title": "Essentials", "subtitle": "Core discipline for local churches", "order": 2 }`

**Book level**: `{ "title": "The Call of Christ", "subtitle": "A Narrative Journey of Christian Faith", "order": 1, "color": { "##": "#000000", "###": "#000000", "####": "#000000", "#####": "#000000" }, "banner": "Pre-Release" }`

The `color` field maps heading levels to colors (for the mobile app). The `banner` field is used for publication status.

### Banner values observed
- `"Preview"` — on The Story Behind It All, A Table in the Wilderness, Base Camp
- `"Pre-Release"` — on The Call of Christ
- Absent — on other books

### Book folder structure (consistent pattern)
```
BookName/
├── meta.json          # Title, subtitle, order, color, banner
├── cover.svg          # Cover image (some are PNG)
├── commonBook.md      # Shared content for the book (mostly empty/placeholder)
└── sessions/
    ├── session1.md    # or 1-FrontMatter.md, 4-Session1-TheGospel.md, etc.
    ├── session2.md
    └── images/        # Some sessions have image folders
```

### Session file naming conventions
Two patterns exist:
- Simple: `session1.md`, `session2.md`
- Descriptive: `1-FrontMatter.md`, `2-SeriesOrientation.md`, `3-Intro-The Opening.md`, `4-Session1-TheGospel.md`

The website should sort by filename.

### Shared content files
- `commonSeries.md` — at the series level, contains XML-like tags (`<IntroductionNote>`, `<ReflectionPrompt>`, etc.)
- `commonSubseries.md` — at the sub-series level, similar tags (`<DeepDivePrompt>`, `<WrapUpNotes>`)
- `commonBook.md` — at the book level, mostly empty (1 byte) in observed books

### Custom markdown syntax (complete inventory from reading actual files)

**`<Question id=...>...</Question>`** — Interactive question fields with unique IDs. Content inside is the prompt. IDs are globally unique (e.g., `TheCallSes1-Hearing-Q1`). These appear extensively throughout session files.

**`<Callout>...</Callout>`** — Inline callout blocks that appear MID-PARAGRAPH (not on their own line). The mobile app renders these with special emphasis.

**`<< text`** — Right-aligned attribution. Used after block quotes for scripture references and author names. The `<<` at the start of a line signals right-alignment.

**`<IntroductionNote>`, `<ReflectionPrompt>`, `<DeepDivePrompt>`, `<ClosingThoughts>`, `<WrapUpNotes>`** — Structural section tags in commonSeries.md and commonSubseries.md.

**`<br>`** — HTML break tags for vertical spacing.

**Standard markdown used precisely**: Heading hierarchy (`#` through `#####`) maps to colors via meta.json. Block quotes extensively used for scripture. Bold and italic used with intentional patterns. Tables used for structured content (session outlines, gospel summaries).

### Bibles structure (excluded from website)
```
bibles/
├── kjv/
│   ├── meta.json        # { title, description, version }
│   ├── cover.png
│   ├── kjv.pdf          # ~16MB
│   ├── references.json  # ~4.8MB
│   └── content/         # Per-chapter markdown
└── bsb/
    └── (similar structure)
```

Decision: **Bibles are excluded from the website entirely.** Only `series/` content is rendered.

### Notable observations
- `.DS_Store` files are committed in several directories (should be gitignored)
- The Narrative Journey Series has a French translation: `L'Appel du Christ` (parallel to `The Call of Christ`)
- Session files can be quite large (40KB+ for `4-Session1-TheGospel.md`)
- Cover images are SVG (most) or PNG (bibles)

---

## 3. Architecture Decisions (Chronological)

### Decision: Where the website code lives
**Decided**: Website code lives entirely in `Noble-Imprint-Resource-Website`. The resources repo stays pure content. The mobile app build process is unaffected.

**Reasoning**: The resources repo has a clear identity as content. Mixing in a web application would complicate CI, clutter commit history, and create mobile app build concerns.

### Decision: How the website repo consumes content
**Decided**: The website server fetches content from the resources repo via GitHub API on demand. No git clone, no submodule.

**Alternatives considered**:
- Git submodule — rejected due to UX issues and unnecessary complexity
- CI clones at build time — viable but API-on-demand is simpler and allows caching

**Reasoning**: GitHub API is the simplest approach. Caching with TTL handles performance. The navigation tree (series → sub-series → books) is built from directory listings and meta.json files.

### Decision: Configuration file location and design
**Decided**: A `website-config.yaml` in the website repo. It defines roles and rare status overrides. It does NOT duplicate the content structure — that comes from the resources repo's meta.json and directory structure.

**Key design choice**: Default everything to published. Only list exceptions. New books appear on the website automatically unless explicitly hidden.

### Decision: Publication status system
**Decided**: Use the existing `banner` field from meta.json, with one new value:

| Banner value | Website behavior |
|---|---|
| *(absent)* | Fully public, no indicator |
| `"Preview"` | Public, shown with a "Preview" banner |
| `"Pre-Release"` | Public, shown with a "Pre-Release" banner |
| `"Hidden"` | Not shown on the website at all |

**Important clarification from the user**: Preview and Pre-Release books are visible to EVERYONE — they just display a status banner. They are NOT gated behind authentication. Only "Hidden" books are excluded. This was a direct edit the user made to the architecture doc.

**Impact**: This simplified the auth model significantly. Authentication is only needed for the editing workflow, not for content access. The "previewer" role was eliminated entirely.

### Decision: Authentication approach
**Decided**: Firebase Authentication with Google sign-in provider. Simple, managed OAuth. Free tier sufficient.

**Roles** (final naming after user feedback):
| Role | Can do |
|---|---|
| Anyone (no login) | Browse and read all non-hidden content |
| `suggest-comment` | Above + suggest edits and leave comments |
| `admin` | Above + accept/reject suggestions (commits to repo) |

**Naming rationale**: User specifically requested "suggest-comment" instead of "editor" (which was ambiguous — could mean someone who edits content) and "admin" instead of "approver" (clearer authority).

### Decision: Hosting
**Decided**: Google Cloud Run. Containerized Node.js application. Serverless (scales to zero). Domain: `resources.noblecollective.org`.

**Why not static**: The editing workflow requires a server for GitHub API calls, auth middleware, and suggestion storage. Even without the editing workflow, server-side rendering gives more flexibility.

### Decision: CI/CD and auto-deployment
**Decided**: Two triggers for deployment:
1. Push to website repo's main branch
2. Cross-repo `repository_dispatch` from resources repo

The resources repo gets a small GitHub Actions workflow that fires a `repository_dispatch` event to the website repo on every push to main. The website repo's workflow then builds and deploys.

### Decision: Phased implementation
**Final phasing** (collapsed from 3 phases to 2 based on the visibility model change):

**Phase 1 — Public website (read-only)**:
- Node.js server on Cloud Run
- Custom markdown rendering engine (all custom syntax)
- Library browsing UI (series → sub-series → books → sessions)
- Session reading view
- CI/CD pipeline with cross-repo dispatch
- website-config.yaml with status logic
- No authentication needed

**Phase 2 — Authentication and editing workflow**:
- Google sign-in via Firebase Auth
- Roles: suggest-comment, admin
- CodeMirror 6 masked editor
- Suggestion submission and storage (Firestore)
- Review queue and rendered diff view
- Acceptance flow with SHA check → commit to resources repo
- Courtesy locking and overlap prevention

---

## 4. The Editing Workflow — Deep Design Discussion

This was the most extensively discussed part of the architecture. Multiple approaches were explored, challenged, and refined over the course of the conversation.

### The core problem
The user wants a Google Docs-like editing experience for markdown files that live in Git. The markdown uses custom syntax that must be preserved exactly. Any editing solution must be zero-loss — no reformatting, no re-serialization, no character changes beyond what the user explicitly edits.

### Approach 1 explored: TipTap / ProseMirror WYSIWYG editor
**Idea**: Use TipTap (built on ProseMirror) as a rich text editor. Load markdown, parse into TipTap's document model, user edits in WYSIWYG, serialize back to markdown.

**Why it was rejected**: TipTap round-trips markdown through an internal document model, which is inherently lossy. It normalizes formatting (one vs. two blank lines, `**` vs `__`, etc.). For Noble Imprint's custom syntax (`<Question id=...>`, `<Callout>`, `<<`), every tag would need a custom TipTap extension, and the serialization back to markdown would have to be painstakingly configured. One wrong newline could break the mobile app build. The user's concern: "it needs to preserve every character carefully and only allow for editing of text itself. It can't be 'lossy' at all."

### Approach 2 explored: Split-pane raw markdown editor
**Idea**: Rendered preview on one side, raw markdown editor on the other. Edits happen in the raw markdown pane.

**Why it was partially rejected**: The user raised a critical UX concern: "if the user who is editing is reading the rendered markdown pane, and sees an edit, do they have to 'find the right spot' in the markdown on the other pane? Will it require them to be able to understand the markdown well enough to know what to highlight?" This was acknowledged as a bad experience for non-technical editors.

### Approach 3 explored: Rendered view editing with source mapping
**Idea**: User edits in the rendered view only. A source map (mapping between rendered text positions and raw markdown positions) translates selections back to the markdown.

**Concern raised by user**: "Is storing the character position of every piece of text in every file the only option?" This led to a deep exploration of anchoring strategies:

**Option 1 — Character offset mapping**: Most precise but most fragile. Offsets shift when upstream edits happen. Requires rebasing.

**Option 2 — Text-match anchoring**: Store the actual text being replaced plus surrounding context. Find-and-replace at acceptance time. User liked this approach. "I don't see more than 1 person editing at a time."

**Option 3 — AST node anchoring**: Use structural identity (heading, Question ID) to find location. Hybrid with text-matching.

**Option 4 — OT/CRDTs**: Massive overkill for async editing.

**Option 5 — Git branch per suggestion**: Simple brute-force. Each suggestion is a branch. Viable for Phase 2 start.

**Robustness concern**: User pushed hard on reliability: "What about when we start editing a file... what if I'm just changing a 'the' to 'a'?" This led to discussion of layered anchoring (structural context + containing block + text match + line hint + offset in block). The Question IDs were identified as a "superpower" — globally unique anchors.

### Approach 4 (FINAL): Masked CodeMirror editor
**The breakthrough idea came from the user**: "Is there any way the user could be editing the raw markdown file but you just HIDE all the tags or something and render it as text only? So when they highlight text they are editing the actual markdown?"

**This is the chosen approach**. It eliminates the entire class of mapping/anchoring problems:

- CodeMirror 6 loads the raw markdown file
- "Replace decorations" visually hide structural syntax (`<Question id=...>`, `</Question>`, `<Callout>`, `</Callout>`, `<<`, `#`, `**`, `_`, `>`) while keeping them physically in the buffer
- "Atomic ranges" make the cursor skip over hidden characters
- Users see clean formatted text but are directly editing the raw markdown
- Changes are character-level diffs against the actual file — no transformation, no anchoring
- Structural syntax is protected because it's invisible and cursor-inaccessible

**Key technical details discussed**:
- Cursor behavior: arrows skip hidden ranges, selections span them invisibly
- Boundary behavior: typing at end of Question block stays inside; Enter after heading goes below
- Pasted text: inserted literally, no re-parsing
- "View source" toggle: reveals raw markdown for power users making structural changes
- Suggestions are simple file diffs (original content vs. modified content)

### Suggestion system design

**Data model**:
```
suggestion:
  id: uuid
  file_path: path in resources repo
  base_commit_sha: Git SHA when suggestion was created
  original_content: full file at time of suggestion
  modified_content: full file after edits
  diff: computed diff
  author_email: who suggested
  comment: optional description
  status: pending | accepted | rejected | stale
  created_at, resolved_at, resolved_by
```

**Storing both full original and modified content** (not just the diff) provides maximum flexibility for rendering the review view.

### Conflict detection — Optimistic locking with SHA check
When admin clicks "Accept":
1. Fetch current file from resources repo
2. Compare current SHA with suggestion's base_commit_sha
3. If match: apply and commit
4. If mismatch: flag as "stale," admin must re-review

**User asked about file locking in GitHub**. GitHub doesn't have native file locking. Options discussed:
- Lock file in repo (`.lock` companion file) — adds commit noise
- Application-level locking in website's database — advisory only
- SHA-based optimistic locking — the recommended approach
- **Chosen**: SHA check as safety net + advisory locking as courtesy (database tracks active editing sessions, shows "Jane is editing this file")

### Overlap prevention
**Rule**: One pending suggestion per file at a time. If a file has a pending suggestion, no new suggestions can be submitted until the first is accepted/rejected. Simple, avoids reconciliation complexity.

### Where editing code lives
**Decision**: The editing tools live in the website repo alongside the reading view. Not in the resources repo, not in a separate repo. They share the same rendering engine, auth system, and deployment.

---

## 5. Key Concerns Raised and How They Were Addressed

### Concern: "What is the best way to get a user-friendly editing platform that has markdown as the source of truth?"
**Context**: User asked this as an open-ended question before the website was even part of the equation. They wanted to know the best solution regardless of the website project.
**Resolution**: The masked CodeMirror editor approach. The user gets a Google Docs-like visual experience while directly editing the raw markdown. No round-tripping, no data model translation.

### Concern: "Our markdown is very specific. We worked hard to get very specific markdown needed for our app."
**Context**: The user was concerned that any editing tool would corrupt the custom syntax.
**Resolution**: The masked editor hides structural syntax and makes it cursor-inaccessible. A reviewer literally cannot select, delete, or modify a `<Question>` tag. Only visible text content is editable.

### Concern: "If the user is reading the rendered markdown pane and sees an edit, do they have to find the right spot in the markdown?"
**Context**: The split-pane approach was rejected because it required users to work in raw markdown.
**Resolution**: The masked editor eliminates the split pane. There's only one view — it looks like rendered text but is actually the raw file with decorations hiding the syntax. Users edit in place.

### Concern: "Is storing character positions the only option? What about changing 'the' to 'a'?"
**Context**: The user was skeptical about text-match anchoring reliability for small common-word edits.
**Resolution**: First explored layered anchoring (structural context + containing block + text match). Then pivoted to the masked editor approach, which eliminates anchoring entirely — suggestions are file-level diffs, not text-match operations.

### Concern: "How is the workflow handled for the source of truth if edits are being made on a different site?"
**Context**: The user wanted clarity on who wins when edits happen on the website vs. directly in the repo.
**Resolution**: The GitHub repo is always the source of truth. The website never holds its own copy. It reads via API and commits via API. SHA-based optimistic locking detects conflicts. The edit either commits cleanly or gets flagged as stale.

### Concern: "Is there a way to lock a file in GitHub so users can't change it?"
**Context**: Wanted to prevent concurrent edits in two places.
**Resolution**: GitHub doesn't have native file locking. Recommended SHA-based optimistic locking (detect conflicts at acceptance time) + advisory application-level locking (show "Jane is editing this file"). Low collision risk given team size and edit frequency.

### Concern: "Should we build this in the resources repo instead?"
**Context**: User wondered if the editing tool should live alongside the content.
**Resolution**: No. The resources repo should stay pure content. The editing tools need a server, auth, database, deployment config — all of which would clutter the content repo and complicate the mobile app build. The website repo is the natural home.

### Concern: "Editor sounds like someone who can make edits. Let's change that to suggest-comment."
**Context**: Role naming was confusing — "editor" could mean the person who edits (approves changes) or the person who uses the editor tool.
**Resolution**: Renamed to `suggest-comment` (can suggest and comment) and `admin` (can accept/reject). Updated throughout the architecture doc.

### Concern: Preview/Pre-Release books should be public, not gated
**Context**: The user edited the architecture doc directly in GitHub to clarify that Preview and Pre-Release books should be visible to everyone with a banner, not hidden behind authentication.
**Resolution**: Simplified the auth model. Removed the "previewer" role. Authentication is now only needed for the editing workflow. Collapsed from 3 phases to 2.

---

## 6. Final Architecture Summary

### System architecture
- **Resources repo**: Pure content. Markdown, covers, meta.json. Source of truth.
- **Website repo**: Node.js app on Cloud Run. Renders content, handles auth, editing, suggestions.
- **Mobile app**: Independent consumer of resources repo. Unaffected by website.

### Technology stack
| Component | Technology |
|---|---|
| Server | Node.js (Express) |
| Hosting | Google Cloud Run |
| Auth | Firebase Auth (Google sign-in) |
| Content access | GitHub API (Octokit) |
| Markdown parsing | markdown-it or unified/remark with custom plugins |
| Editor | CodeMirror 6 (masked decorations) |
| Suggestion storage | Cloud Firestore |
| CI/CD | GitHub Actions (cross-repo dispatch) |
| Domain | resources.noblecollective.org |

### Roles
| Role | Capabilities |
|---|---|
| Anyone | Read all non-hidden content |
| suggest-comment | Read + suggest edits + leave comments |
| admin | Read + suggest + accept/reject suggestions |

### Publication status
| meta.json banner | Website behavior |
|---|---|
| absent | Public, no indicator |
| "Preview" | Public with Preview banner |
| "Pre-Release" | Public with Pre-Release banner |
| "Hidden" | Not shown at all |

### Phases
- **Phase 1**: Public read-only website with custom markdown rendering
- **Phase 2**: Auth + masked CodeMirror editor + suggestion workflow

---

## 7. What Was Committed to GitHub

### Noble-Imprint-Resource-Website repo
- `ARCHITECTURE.md` — Comprehensive architecture document. Has been through 4+ revisions during the conversation:
  1. Initial technical-heavy version
  2. Restructured with vision-first narrative, appendices
  3. Updated for public Preview/Pre-Release visibility model, collapsed to 2 phases
  4. Renamed roles to suggest-comment and admin

### Noble-Imprint-Resources repo
- No changes made. The repo was read-only during this conversation.

---

## 8. What Has NOT Been Started

- No code has been written
- No Cloud Run service has been created
- No Firebase project has been set up
- No GitHub App has been created for cross-repo API access
- No GitHub Actions workflows have been created (neither the notify workflow in resources repo nor the deploy workflow in website repo)
- No domain mapping or SSL has been configured
- No design or visual direction has been chosen for the website
- The `website-config.yaml` file has not been created in the repo (it's described in the architecture doc but not committed)

---

## 9. Open Questions and Future Decisions

These were explicitly identified as open during the conversation:

1. **Visual design and layout** — browsing experience, reading typography, color scheme. No direction chosen yet.

2. **Caching strategy** — in-memory with TTL, Redis, or fully static pre-built pages. Impacts how quickly content updates appear and how the server handles GitHub API rate limits.

3. **Mobile responsiveness** — requirements for reading and editing views on phones/tablets.

4. **How common content files are handled** — `commonSeries.md`, `commonSubseries.md`, `commonBook.md` contain shared content with XML-like tags. Decision needed: inject into session pages? Show separately? Skip on website?

5. **Notification system** — should suggestion submissions and reviews trigger email or in-app alerts?

6. **Multiple suggestions per file** — currently limited to one pending per file. May expand later.

7. **Comment-only mode** — the "suggest-comment" role implies both suggestions and comments. The comment feature (annotations without text changes) was discussed conceptually but not designed in detail. A comment would anchor to a text range and carry a note without modifying the file.

8. **Edit frequency and caching** — user noted: "sometimes 3 updates in a day, then 2 months with no changes." This means aggressive caching is fine with webhook-based invalidation.

9. **How the website handles the Narrative Journey French translation** (`L'Appel du Christ`) — is it shown alongside the English version? Separate language selector? This wasn't discussed.

10. **The `.DS_Store` files in the resources repo** — should be gitignored. Minor cleanup item.
