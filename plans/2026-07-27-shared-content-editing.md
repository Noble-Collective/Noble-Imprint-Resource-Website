# Shared-content editing (direct + suggestion editor)

_Kickoff plan — start this in a FRESH session with clean context. Editing is the most
fragile subsystem; the overriding constraint is **do not break existing editing**, and
**run the Playwright suite** before/after._

## Goal (from Steve)
Shared content served into a session via `<!-- @include: … -->` must work in BOTH the
direct editor and the suggestion editor:
1. The shared content must **load onto the page in the editor** (visible, like the reading view), not shown as raw `@include` directive lines.
2. When an edit (suggestion or direct) is applied to a shared line, the change must be
   **written to the correct shared file** (`commonBook.md` or `commonSeries.md`), NOT the session file.
3. **UI affordance**: clicking/focusing a shared line shows a small banner (below the line
   or similar) indicating it's from a different file AND at which level — **common book** vs **common series**.
4. Build out the **Test Book** with commonBook + commonSeries elements so this is testable.

## Key architectural facts (already confirmed this session)
- Reading view resolves includes: `src/server/index.js:404-405`
  `includeBlocks = content.gatherCommonBlocks(series, subseries, book)` →
  `resolvedContent = resolveIncludes(sessionData.content, includeBlocks)`.
- **Editor is handed the RAW session file**: `index.js:521` `rawContent: canEdit ? sessionData.content`
  (and `sessionFilePath: session.path`, `bookRepoPath: book.repoPath` at 526-527), passed to
  `session.ejs` `window.__EDITOR_DATA` (~580-589). So the editor currently shows the
  `@include` comment lines and every commit targets `sessionFilePath`.
- Include resolver: `src/renderer/parser.js` `resolveIncludes(content, blocks)` — regex over
  `<!-- @include: Key params -->`; supports params `id="…"` (`{id}` substitution),
  `bold="…"` (`boldMatchingLine`), `active="…"` (`activateMatchingItem`). Blocks gathered
  book→subseries→series precedence in `content.js` (`parseCommonBlocks` / `gatherCommonBlocks`).
- Common files: `commonBook.md` (book folder), `commonSubseries.md`, `commonSeries.md` (series folder).
- Suggestion/commit pipeline: `src/server/suggestion-routes.js`, `src/server/suggestions.js`
  (`acceptHunk` 5-strategy anchor cascade → `github.updateFileContent`), client
  `src/public/js/editor*.js` (editor.js orchestrator, editor-suggestions.js registry,
  editor-masking.js, editor-constraints.js, editor-margin.js, editor-comments.js).
  CodeMirror bundle `src/editor-entry.js` → `src/public/js/codemirror-bundle.js` (rebuild via `npm run build:editor`).

## Design options (decide before coding)

### Option A — in-line editing (Steve's preference; higher effort + risk)
Resolve includes in the editor, track provenance, and **route edits on shared lines to the
shared file** so the user edits shared content in place, seamlessly with the rest of the book.
This is what "The hard part" and "Suggested phased approach" below describe. Best UX, but it
reaches into the fragile parts: commit routing to a different file, resolved→source anchor
mapping, and special handling of parameter-driven fragments (`id`/`bold`/`active`).

### Option B — read-only shared + link-out (bulletproof; lower effort + risk)
Display the shared content **inline for context but grayed-out / read-only** in the session
editor. When the user clicks/tries to edit a shared line, show the banner + a message:
> "This is shared content from **commonSeries.md** (series level) — edits affect every session
> that uses it. **[Edit the shared file →]**"
The link opens a dedicated editor page for that shared file (`commonBook.md` / `commonSeries.md`)
where the user direct-edits the whole file using the **existing, proven single-file editor,
unchanged**.

**Why it's rock-solid:** the session editor never writes to another file, never needs
resolved→source anchor mapping, and never special-cases parameterized fragments. All the
risk (commit routing + anchoring) is designed out; the shared file is edited by the same
battle-tested machinery already used for sessions, just pointed at a different path.

What Option B needs:
- Resolve includes in the editor as **read-only regions** + a provenance map (same server work
  as A-step-2, minus edit back-mapping). Parameter-driven bits just render as-is/grayed.
- Mask shared ranges as **non-editable** in CM — extend `editor-constraints.js` the same way it
  already blocks structural syntax (this machinery exists and is proven).
- **Banner + "Edit shared file" link** → a lightweight editor route/page that loads
  `commonBook.md` / `commonSeries.md` into the SAME editor. The editor is wired to session
  paths today, so this is a small, contained addition: point the existing editor at a
  common-file path, with include-resolution OFF on that page (the common file *is* the source).
- Suggestions on shared lines: either disabled inline (offer "suggest on the shared file"
  via the link) or simply not offered inline.

**Recommendation: ship B first as a safe, complete baseline** (shared content visible, clearly
flagged with level, and fully editable via link-out using proven code), **then optionally layer A**
if in-context inline editing proves worth the added risk. B also delivers requirements 1 & 3
(visible shared content + level banner) immediately, and requirement 2 (edits land in the right
file) via the link-out — with near-zero chance of regressing existing editing.

_"The hard part" and the phased approach below pertain to **Option A**. If we go with B, the
work is: server read-only resolution + provenance → CM read-only masking → banner + common-file
editor route → tests → (no commit-routing/anchor changes needed)._

## The hard part (Option A — design carefully before coding)
- A shared block is **one source used by many sessions**. Editing it changes ALL sessions
  that include it — the UI must make that consequence clear (the banner should probably warn
  "shared — changes affect every session that uses this").
- Includes are **parameterized**, so the resolved text ≠ source text:
  - `id="…"` substitutes `{id}` (question ids differ per session).
  - `bold="…"` wraps one line in `**…**` (creed emphasis differs per session).
  - `active="…"` adds `active` to one `<Item>`.
  A line edited in the resolved view must be mapped back to the correct **source line in the
  shared file**, undoing the parameter substitution — or edits to parameter-driven parts must
  be blocked/handled specially. Editing the `bold`/`active`/`{id}` bits is session-specific
  (lives in the session file's include directive), NOT the shared file.
- Anchoring: the existing multi-selector anchor (`prefix/exact/suffix/hash/structural`) assumes
  one file. It needs a **target-file dimension** (which file each hunk applies to) end to end:
  client hunk → `POST /api/suggestions/hunk` → Firestore doc → `acceptHunk` → `updateFileContent(targetFile)`.
- Provenance mapping: when resolving includes for the editor, emit a **line/range → {file, level, key}** map
  so the client knows which editor lines are shared, from which file/level, and where they map in the source.

## Suggested phased approach
1. **Test scaffolding first** — add commonSeries.md + commonBook.md blocks under the Test Book's
   series/book and put `@include`s in `Test Book/sessions/…` so there's a fixture. (Test Book lives at
   `series/Narrative Journey Series/Foundations/Test Book/` per CLAUDE.md.)
2. **Server: editor content resolution + provenance.** Add an include-resolution mode for the editor
   that returns resolved text PLUS a provenance map (per resolved line: source file path, level
   [book|subseries|series], block key, source line, and whether it's parameter-driven/non-editable).
   Keep the raw-directive fallback so nothing breaks if disabled.
3. **Client: render + mask + banner.** Show resolved shared content; visually mark shared regions;
   on focus/click show the banner ("Shared from commonSeries.md · series level — edits affect all sessions").
   Constrain edits on parameter-driven fragments.
4. **Edit routing.** Thread a `targetFilePath` (+ sourceLine/anchor in that file) through the hunk
   create/accept path so suggestions and direct edits commit to the shared file. Update
   `acceptHunk`/`reanchorAnnotations` to operate on the resolved target file.
5. **Tests.** Extend the Playwright suite: shared line shows banner + level; suggestion on a shared
   line writes to commonSeries/commonBook (not the session); direct edit likewise; non-shared edits
   still target the session file; parameterized fragments handled. Run the FULL suite before + after
   (note: it consumes GitHub API budget — see CLAUDE.md).

## Guardrails
- Feature-flag or keep fully backward-compatible: a session with no `@include` must behave exactly as today.
- No changes to the custom tag syntax the mobile app depends on.
- Rebuild the CM bundle if `editor-entry.js` changes; never edit the bundle directly.
- Kill the local server by PID only.
