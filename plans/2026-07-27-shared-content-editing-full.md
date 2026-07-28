> **STATUS 2026-07-28: SHIPPED (D3, P1→P4) + deployed to Cloud Run.** Segment map,
> `/api/editor-model`, resolved-buffer editing, per-file suggest routing, and the
> direct-mode "Edit shared file →" link-out are all live. Client/routing details in
> the companion plan `2026-07-28-shared-content-editing-P2-P4-impl.md`. P5
> (inline *direct* editing of shared content) remains deferred. See CLAUDE.md →
> "Shared-content editing (@include)" for the maintained reference.

# Shared-content editing — FULL experience (deep-dive plan)

_Supersedes the option-comparison in `2026-07-27-shared-content-editing.md`. That file
framed A vs B; this file commits to building the full inline experience and specifies HOW,
grounded in a full read of the editing stack. Overriding constraint is unchanged: **do not
break existing editing**; establish a green Playwright baseline before/after._

## Goal
Shared `@include` content must be a first-class, in-place part of the editor:
1. Shared content **renders inline** in the editor (not raw `@include` lines), visually
   flagged, with a banner on focus naming the source file + level (common book vs series).
2. An edit to a shared line **commits to the correct shared file** (`commonBook.md` /
   `commonSeries.md`), never the session file. A non-shared edit still commits to the session file.
3. Works in **suggest** mode inline everywhere; **direct** mode per the chosen flavor (see §6).
4. **Test Book** carries commonBook + commonSeries fixtures (incl. one parameterized block)
   so all of the above is covered by Playwright.

---

## 1. How the editor actually works today (verified against the code)

### Content in
- Reading view resolves includes (`index.js:404-405`): `gatherCommonBlocks` → `resolveIncludes`.
- Editor is handed the **raw** session file: `index.js:521 rawContent: sessionData.content`,
  plus `sessionFilePath` (526) and `bookRepoPath` (527), surfaced to the client as
  `window.__EDITOR_DATA` (session.ejs / ajax-nav `editData` ~579-590).
- Client sets `originalContent = data.rawContent` (`editor.js:19`). This is the single
  source-of-truth string the entire diff/registry engine anchors to.

### Suggest mode (per-change hunks — multi-file friendly)
- Diff engine (`editor-suggestions.js computeHunks` + `mergeHunksByEditRegion`) diffs
  `originalDocField` vs the live buffer → hunks `{type, originalFrom/To, originalText, newText, currentFrom/To}`.
- Auto-save (`editor.js:71-353`) POSTs each hunk to `/api/suggestions/hunk` with
  **`filePath: data.sessionFilePath`** (285) + `lineNumber` computed from `originalDocField` (142).
- Server `createHunk` (`suggestions.js:229`) resolves the position against the **target file's**
  content (route fetches `getFileContent(filePath)` at `suggestion-routes.js:218`), builds a
  multi-selector anchor (`buildAnchorData`: 80-char prefix/exact/suffix + contentHash + lineNumber/percentOffset).
- Accept (`suggestions.js:441-564`) re-fetches `hunk.filePath`, finds the text by a 5-strategy
  **content** cascade (full ctx → prefix+exact → exact+suffix → bare≥20 → short+structural),
  replaces, commits via `updateFileContent(hunk.filePath, …)`, then `reanchorAnnotations(hunk.filePath, …)`.
- **Key fact:** the commit path is already per-`filePath` and content-anchored. It does NOT
  rely on editor buffer offsets. Routing a suggestion to a shared file = give the hunk a
  different `filePath` **and** context/originalText that exist verbatim in that file.

### Direct mode (whole-buffer replace — single-file only)
- `directSave` (`editor.js:1749`) sends the **entire buffer** to `/api/suggestions/direct-edit`
  → `updateFileContent(filePath, wholeContent, sha)` (`suggestion-routes.js:581-610`). One buffer → one file.
- Direct mode has **no edit constraints** — it is completely free-form (constraints are
  `mode === 'suggest'` only; `editor.js:1485,1531`).

### The invariant that includes break
`originalDocField` is assumed to be **exactly one file** that all annotations anchor into and
commit out of. Resolved content makes the buffer a **composite of ≥2 files**, and the session
`@include` line is present in the session source but **absent** from the resolved buffer.

---

## 2. The core abstraction: the server-built **segment map**

Add an editor-resolution mode that returns the resolved buffer **plus** an ordered segment map.
Each segment covers a contiguous buffer range and records where it came from:

```
Segment {
  bufFrom, bufTo,            // range in the resolved editor buffer
  kind: 'session' | 'shared',
  sourceFile,               // committable repo path (session path, or commonBook/commonSeries path)
  sourceSha,                // base SHA of that file at load time
  level: 'book' | 'subseries' | 'series' | null,
  key,                      // include key (shared only)
  srcFrom,                  // offset of this segment's text within sourceFile
  mapMode: 'additive' | 'readonly',   // additive → bufPos - bufFrom + srcFrom == source offset
  includeDirective,         // shared only: the exact `<!-- @include: … -->` line + its position in the session source
  readonlySpans: [{bufFrom,bufTo}]    // parameterized spans inside a shared segment (id/bold markers/active)
}
```

**Two rules that make every editable position map to one file by a pure additive offset:**
1. An `@include` line is a **boundary**: its directive text is not in the buffer. Record the
   directive verbatim + its session-source position so we can re-emit it on write.
2. Parameter-driven spans are **read-only** (`mapMode:'readonly'` / `readonlySpans`): the `{id}`
   substitution, the `**` markers added by `bold=`, and the ` active` attr added by `active=`.
   The content a user CAN edit inside a shared block then exists verbatim in the shared source,
   so additive offset mapping and content-anchoring are both exact — **no reverse transform on write.**

Build it by instrumenting `resolveIncludes` (or a sibling `resolveIncludesTracked`) to emit
segment boundaries as it substitutes. Parameterized read-only spans come straight from where
`boldMatchingLine` / `{id}` / `activateMatchingItem` touched the text. Keep the existing
`resolveIncludes` untouched for the reading view.

Common-file paths are deterministic and committable: `${bookPath}/commonBook.md`,
`${subseriesPath}/commonSubseries.md`, `${seriesPath}/commonSeries.md` (see `content.js:51-56,92,146,195`).

---

## 3. Server: one editor-model endpoint + one commit endpoint

### 3a. `getEditorModel(session)` (extend `getSessionPageData` / new `/api/editor-model`)
Returns, when editing is enabled:
- `resolvedContent` — the buffer text.
- `segments` — the map from §2.
- `files` — `[{ path, level, sha }]` for the session file **and every referenced common file**.
- `annotations` — pending suggestions + comments from **all** those files, each **pre-mapped to
  buffer offsets** using the segment map (server owns the mapping; client stays dumb). Session-file
  annotations map by the cumulative expansion delta; shared-file annotations map into their segment.
- Backward-compatible: a session with no `@include` returns exactly today's shape (segments = one
  session segment, files = [session]) so the existing client path is unchanged.

Implementation notes:
- Reuse the existing anchor resolution (`resolveAnchor`) per file against that file's own content,
  then translate each resolved `from/to` into buffer offsets via the segment map. This keeps
  commit-time semantics identical (anchors still stored/resolved in source-file space).
- Rate-limit budget: this fetches session + N common files. N is tiny (≤2) and common files are
  cached like everything else; still, fold these reads into the existing cache path.

### 3b. `POST /api/editor/commit` (direct, multi-file) — the one genuinely new writer
Accepts `{ sessionPath, buffer, baseShas: {path: sha} }`. Server-side (never trust a client map):
1. Re-fetch session + common files; **re-resolve** with tracking → fresh `resolvedContent` + segments.
2. If any `baseShas` mismatch current → `409` (reuse the stale-banner flow).
3. `diffChars(freshResolved, buffer)` → change list. Attribute each change to a segment by position.
4. **Reject** (422 + precise message) any change that straddles a segment boundary or intersects a
   `readonly` span (see §6 for how direct mode prevents these up front).
5. Reconstruct each affected file:
   - session file: start from session **source** (with `@include` lines), apply session-segment
     changes mapped to source offsets; boundaries (directives) are untouched by construction.
   - each shared file: start from its source, apply its segment changes (additive map).
6. Commit each changed file via `updateFileContent(path, newContent, sha, msg)`; then
   `reanchorAnnotations(path, newContent)` per file. Commit session file **last**; on partial
   failure, report exactly which files committed (best-effort, clearly surfaced — no silent partial).

Keep the existing `/direct-edit` route for the no-include fast path (or make the new endpoint
delegate to it when there's a single session segment).

### 3c. Suggest routing
No new endpoint. In auto-save, replace the hardcoded `filePath: data.sessionFilePath` (`editor.js:285,375`)
with the **segment's `sourceFile`** for that hunk, and compute `lineNumber` + context against that
segment's **source** text (the client has the segment map; it slices source-space context from the
resolved buffer minus the additive offset, or the server recomputes context from `filePath` as it
already does in `createHunk`). Everything downstream (`createHunk`/`acceptHunk`/`reanchor`) is unchanged.

---

## 4. Client rendering, masking, banner, constraints

- **Render**: buffer = `resolvedContent`. Existing masking (`editor-masking.js`) already styles the
  injected markup (questions, callouts, blockquotes) — it works on buffer text regardless of origin,
  so shared content renders identically to session content for free.
- **Visual flag**: add a `Decoration.line` tint/left-border on shared segments (mirror the existing
  `.cm-blockquote` / `.cm-section-block` line treatments). Cheap, additive.
- **Banner**: a selection-change listener maps the cursor to a segment; if shared, show a banner
  ("Shared from **commonSeries.md** · series level — edits affect every session that uses this
  block"). In direct-mode flavor D3, add a **"Edit shared file →"** action.
- **Read-only param spans + (D3) read-only shared**: extend `computeEditableZones`
  (`editor-constraints.js:26`) to take the segment map and exclude `readonly` spans (and, in D3
  direct mode, whole shared segments). The `editProtection` transactionFilter (`:237`) already
  blocks edits outside zones — proven machinery, no new enforcement path.
- **Multi-file annotations**: `annotationRegistry` is agnostic to source file; entries just carry
  buffer offsets (server pre-maps them). Add `sourceFile` to each entry so auto-save routes correctly.

---

## 5. Surrounding multi-file plumbing (suggest mode)
These single-file assumptions in `editor.js` must become file-aware:
- `autoLoadNewSuggestions` (452) / `refreshFromGitHub` (804) fetch `/content?filePath=session`.
  Repoint to the new `/api/editor-model` so a refresh re-pulls resolved content + all files'
  annotations + fresh segment map in one shot. `buildWorkingDoc` / `buildShiftedRegistryEntries`
  then operate on the resolved buffer (they already take an arbitrary "original" + suggestion list).
- **Version checks** (`autoSave` 80-93, `pollForFileChanges` 615) must compare **each file's** SHA
  (carry `files[].sha`), not just `data.contentSha`.
- **Presence / suggestion-count / history** stay keyed on the session path (the session is the
  editing "room"); shared-file activity surfaces through the session's editor-model refresh.

---

## 6. The real decision: direct-mode flavor (§ pick one)

Direct mode is the ONLY place with materially higher risk, because it's currently 100% free-form
and inline direct-editing of shared content forces structure onto it.

- **D1 — Constrain direct at seams.** Reuse zones to forbid edits crossing a session/shared
  boundary or into read-only spans, while typing. Full inline direct-editing of shared content.
  Cost: direct mode gains constraints (behavior change); most client work.
- **D2 — Free-form, validate on Save.** No typing constraints; the commit endpoint (§3b step 4)
  rejects boundary-straddling / read-only-span edits with a precise message. Full inline direct,
  lighter client, but late feedback can frustrate.
- **D3 — Direct edits session inline; shared is read-only inline + "Edit shared file →".** Direct
  mode never writes shared content in place; the link opens the **same** editor pointed at the
  common file (single-segment → existing single-file path, zero new risk). Suggest mode still
  covers inline shared editing.

**Recommendation:** ship the shared foundation + **suggest-everywhere** + **D3** first (that IS the
full nice experience for the common case — direct mode is admin-only and rarer, and D3 reuses proven
code). Add **D1** later only if inline direct-editing of shared content proves worth re-regulating
the direct editor. D2 is a fallback if D1's live constraints feel too heavy.

---

## 7. Phased delivery (each phase independently shippable, no throwaway)

- **P0 — Baseline + fixtures.** Add Test Book `commonBook.md` + a `commonSeries` block + `@include`s
  in Test Book sessions, including **one parameterized** block (`bold=`/`id=`) to exercise read-only
  spans. Run the FULL Playwright suite → record a green baseline (mind GitHub budget; see CLAUDE.md).
- **P1 — Server segment map + editor-model.** `resolveIncludesTracked`, `/api/editor-model`,
  buffer-offset annotation pre-mapping. No client change yet (assert model shape via unit tests).
- **P2 — Client render + flag + banner + read-only shared (D3 look).** Buffer shows resolved
  content; shared tint + banner; param spans and (for now) all shared spans read-only. Delivers
  requirements 1 & 3 with **zero** commit-path change → safest visible milestone.
- **P3 — Suggest routing (requirement 2, inline).** Per-hunk `sourceFile` from the segment map;
  multi-file annotation load + per-file SHA checks. Now suggestions on shared lines commit to the
  shared file. Extend Playwright: shared-line suggestion writes to commonSeries/commonBook, session
  suggestion still writes to the session file, parameterized span is non-editable.
- **P4 — Direct link-out (D3 complete).** Banner "Edit shared file →" opens the common file in the
  existing editor (needs the `/content` bookPath-derivation fix for non-`/sessions/` paths, and an
  admin-only gate for series-level files). Requirement 2 fully met in both modes.
- **P5 (optional) — Inline direct-shared (D1/D2).** Multi-file commit endpoint (§3b) + direct-mode
  seam constraints. Only if we decide the inline-direct UX is worth it.

Run the full suite after P2, P3, P4 (and P5). Compare against the P0 baseline every time.

---

## 8. Risk register / guardrails
- **No-include sessions unchanged.** Model returns today's shape; assert with a dedicated
  regression test (existing Test Book sessions without `@include`).
- **Anchoring stays content-based per file** — we never anchor across files; the buffer offset is
  presentation only. Session suggestions adjacent to an `@include` seam: verify accept still finds
  them (originalText is a whole line; cascade strategies 2/3 cover one-sided context).
- **Parameterized spans are read-only** everywhere → no reverse-transform, no `**`/`{id}` written
  back to a shared file.
- **Multi-file commit is server-side + server-re-resolved** (never trust a client segment map);
  base-SHA guarded; partial-failure explicitly reported.
- **Feature gating:** naturally inert without `@include`; add a per-book or env kill-switch for
  rollout so we can disable resolution-in-editor instantly if a regression appears.
- Rebuild the CM bundle only if `editor-entry.js` changes (`npm run build:editor`); never edit the
  bundle directly. Kill the local server by PID only.

---

## 9. Open confirmations for Steve
1. **Direct-mode flavor** (§6): D3-first (recommended) vs go straight to D1 (true inline direct-shared).
2. **Permissions on shared files**: series-level edits (`commonSeries.md`) affect the whole series —
   restrict writes to admin/manuscript-owner? (Also requires the `/content` bookPath fix for
   common-file paths.)
3. **Test Book fixtures**: OK to add commonBook + commonSeries blocks + `@include`s (incl. one
   parameterized) to the Test Book in the content repo (hidden test scaffolding, not library content)?
4. **Baseline run now** vs at P0 (it spends GitHub API budget).
