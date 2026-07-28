# Shared-content editing — P2→P4 implementation approach (client + routing)

> **STATUS 2026-07-28: SHIPPED + deployed.** All of P2/P3/P4 below were built,
> tested (17 Playwright + 23 unit; full suite 166 passed), and deployed. P4 uses
> the inline-affordance UX (an "Edit <file> →" link at each shared block's foot,
> not a top banner). Maintained reference: CLAUDE.md → "Shared-content editing".


_Builds on the P1 server foundation (segment map + `/api/editor-model`, deployed).
Supplements `2026-07-27-shared-content-editing-full.md`. D3 confirmed. P5 deferred._

## Overriding safety invariant
**A session with no `@include` behaves byte-for-byte as today.** Every new code
path is gated on `hasShared = segments.some(s => s.kind === 'shared')`. The 150
existing Playwright tests all use non-include sessions (Test Book sessions 1–4),
so they stay on the current path untouched. All new risk is confined to include
sessions (Session 5, and "The Story Behind It All (Final)").

## Why P2 and the session-side of P3 ship together
The strict plan splits "render + read-only shared" (P2) from "suggest routing"
(P3). But showing the RESOLVED buffer while keeping session content editable
requires session-region edits to route to the session file at MAPPED offsets
(the resolved buffer shifts every offset after the first include). Shipping the
visual milestone without that routing would subtly corrupt edits to include
sessions — and Steve actively edits "The Story Behind It All (Final)". So:
- **P2 (this step):** resolved buffer + tint + banner; shared segments + param
  spans READ-ONLY in both modes; **session-region edits route correctly** to the
  session file via the segment map. Session-file annotations shown (buffer-mapped).
- **P3:** flip shared segments editable in SUGGEST mode (route hunks to the shared
  file); load + display shared-file annotations; per-file SHA checks on refresh.
- **P4:** direct-mode "Edit shared file →" link-out (D3 complete).

## Core client trick (minimizes churn to the fragile diff engine)
For include sessions, set `originalContent = resolvedContent`. The entire
diff/hunk/registry engine then operates in BUFFER space, unchanged. Source space
matters in exactly one place — the auto-save POST — where each hunk is remapped
to its `{sourceFile, sourceOffset}` via the segment map, and `lineNumber`/context
are recomputed against that file's source text. Annotations are injected with
`resolvedFrom/To` already set to BUFFER offsets (server pre-maps), so
`buildWorkingDoc`/`buildShiftedRegistryEntries` need no change.

## Server (getSessionPageData)
- Only when `hasIncludes && (canEdit||canReview) && !fromDiskCache`: call
  `editor-model.getEditorModel(route)`; inject `resolvedContent`, `segments`,
  `editorFiles`. Map its annotations to `resolvedFrom=bufferFrom` etc.
  - P2: session-file annotations only (`sourceFile===session.path`).
  - P3: include shared-file annotations.
- `rawContent` (session source) and `contentSha` still injected — the client needs
  the session source for hunk routing/lineNumber.
- Non-include sessions: return shape unchanged (no editor-model call, no new work,
  no extra GitHub reads).
- Inject the new fields into `__EDITOR_DATA` (session.ejs) and `editData`
  (ajax `/api/session-data`).

## Client
- `editor-constraints.js`: add `readonlyRangesField` + `setReadonlyRanges` effect +
  `readonlyProtection` transactionFilter (blocks docChanged transactions whose
  changes intersect any readonly range). Mode-INDEPENDENT (works in direct too).
  Exported `readonlyExtension()`.
- `editor.js`:
  - `originalContent = resolvedContent ?? rawContent`; keep `sessionSource = rawContent`.
  - Parse `data.segments`; compute `hasShared`, shared-segment ranges, and readonly
    ranges = shared segments (P2) + param `readonlySpans`. Dispatch `setReadonlyRanges`.
    (P3 will drop shared segments from readonly in suggest mode.)
  - Add `readonlyExtension()` to the extensions array (always, when hasShared).
  - Shared line tint: a `Decoration.line({class:'cm-shared-line'})` StateField over
    shared ranges + a `.cm-shared-line` rule (left border + faint tint) in a small
    theme. Also tint param spans via a mark class (optional).
  - Banner: `EditorView.updateListener` on selection; map cursor→segment; if shared,
    show `#editor-shared-banner` naming source file + level. (P4 adds the link.)
  - `autoSave`/`forceSaveUnsavedDrafts`: for each hunk, `const seg = segmentAtBuffer(...)`;
    `filePath = seg.sourceFile` (P2: always session); `sourceOffset = mapBufferToSource(...)`;
    recompute `lineNumber`/`contextBefore/After` from that file's source. For P2, shared
    is read-only so all hunks are session hunks → session file at mapped offset.
- New tiny util (in editor.js or a helper): `segmentAtBuffer(segments,pos)`,
  `mapBufferToSource(segments,pos)` (uses editable pieces' additive offset).

## Tests
- Unit: extend `tests/unit/segment-map.test.js` with buffer↔source mapping helpers
  if factored out.
- Playwright (`tests/shared-content.spec.js`, new): on Session 5 —
  1. resolved shared content is visible in the editor buffer;
  2. shared line carries the tint class; banner names the source file on focus;
  3. typing into a shared line is BLOCKED (read-only) in both suggest and direct;
  4. a suggestion on a SESSION line still saves to the session file (routing);
  5. no-include session (Session 1) is completely unchanged (regression guard).
- Run the FULL suite after P2, P3, P4; must stay ≥150 baseline (+ new specs).

## Bundle
No `editor-entry.js` change expected (Decoration/StateField/StateEffect/EditorView
already exported) → no `npm run build:editor`. Kill dev server by PID only.
