# Editor Bug Fixes & Features Plan

## Context

Steve tested the editor on multiple browsers and compiled 12 issues: regressions, bugs, UX improvements, and one new feature. This plan addresses all 12, organized by priority. Root causes have been identified through code investigation.

---

## Priority 1 — Critical Regressions & Broken Functionality

### Bug #1: Done button broken in Direct Edit mode
**Root cause:** `originalDocField` is part of `suggestionExtension()` which is only included in suggest/review modes (editor.js:750). In direct mode, calling `editorView.state.field(originalDocField)` at line 998 throws "Accessing a field that isn't part of the editor state", silently killing the click handler before `showCommitModal()` runs.

**Fix:** In the Done click handler (editor.js:995-1007), for direct mode compare against `originalContent` directly instead of reading from the StateField.

**Also:** Change button text from "Done" to "Save Changes" when the doc differs from original (direct mode only). Watch doc changes via an updateListener or check on each keystroke.

**Files:** `src/public/js/editor.js` (lines 995-1007, plus add updateListener)

**Test:** Add Playwright test: enter direct edit → make change → verify button says "Save Changes" → click → verify modal appears → commit → verify success.

---

### Bug #7: Stale card detection broken — card vanishes instead of showing orange
**Root cause:** Commit `d12bf77` added `await refreshFromGitHub()` to the 409 handler (editor.js:369). The sequence: (1) server marks suggestion as `status: 'stale'` in Firestore, returns 409; (2) client renders orange card; (3) `refreshFromGitHub()` re-fetches suggestions filtered by `status == 'pending'` — stale suggestion excluded; (4) margin panel rebuilds without the card.

**Fix:** Keep `refreshFromGitHub()` (the content SHOULD reload to show the latest GitHub version), but **preserve stale cards through the refresh**. Approach:
1. Before calling `refreshFromGitHub()`, save the stale card's data (hunkId, originalText, newText, type) into a `staleCards` array/set.
2. After `refreshFromGitHub()` rebuilds the margin panel, re-inject the stale card(s) from the saved data — render them as orange stale cards with dismiss buttons at their original position (or at the top of the margin if position can't be determined).
3. When dismiss is clicked, remove from `staleCards` and remove the DOM card.

**Files:** `src/public/js/editor.js` (lines 362-375), `src/public/js/editor-margin.js` (renderAllCards — inject stale cards after normal rendering)

**Test:** Add Playwright test: create suggestion → modify file directly on GitHub → accept suggestion → verify orange stale card appears with dismiss button → verify page content has reloaded the GitHub version of the file → click dismiss → verify card removed.

---

### Bug #10: Safari freezes on click in suggest mode
**Root cause (suspected):** Needs browser-specific debugging. Likely candidates:
1. `selectionClamp` transactionFilter (editor-constraints.js:177-198) returning `[tr, {selection}]` — CM6 re-runs all filters on the result. If the clamped selection still triggers clamping (edge case at zone boundary), this could loop.
2. Masking plugin rebuilding all decorations on focus change — large documents cause expensive recomputation.
3. Zone computation (`computeEditableZones`) running on every doc change without debouncing.

**Investigation approach:**
- Add `console.time`/`console.timeEnd` guards around: selectionClamp, editProtection, masking buildDecorations, computeEditableZones
- Add recursion counter to selectionClamp to detect infinite loops
- Test on Safari with the debug instrumentation to identify the bottleneck

**Fix (once identified):**
- If transactionFilter recursion: add re-entrancy guard (a `clamping` flag)
- If masking perf: only rebuild decorations for visible/changed lines
- If zone computation: debounce the zoneUpdater

**Files:** `src/public/js/editor-constraints.js`, `src/public/js/editor-masking.js`, `src/public/js/editor.js`

---

## Priority 2 — UX Bugs Affecting Usability

### Bug #3: Suggestions load at top on re-entry, snap after another edit
**Root cause:** `renderAllCards()` (editor-margin.js:107) calls `coordsAtPos()` (line 142) immediately when the editor initializes. CM6 hasn't finished layout yet, so `coordsAtPos()` returns position 0. Cards render at top. On next edit, the callback fires `renderAllCards()` again — this time layout is complete and positions are correct, so cards "snap" into place.

**Fix:** Defer the initial card render using `requestAnimationFrame` or CM6's `requestMeasure`. After `initMarginPanel` and `setAnnotations`, schedule a deferred `updateMarginCards` + `updateCommentCards` call.

**Files:** `src/public/js/editor.js` (after line 813), `src/public/js/editor-margin.js`

---

### Bug #4: Comments drop beneath suggestions; comments disappear on accept
**Root cause (ordering):** `renderAllCards()` builds HTML for all suggestions first (lines 135-210), then all comments (lines 213-264). `resolveOverlaps()` (line 329) processes cards in DOM order, not position order. A comment between two suggestions gets pushed below both.

**Root cause (disappear):** When accepting, `refreshFromGitHub()` rebuilds the entire registry and margin panel. If the comment's anchor resolves differently or the comment data isn't included in the rebuild, the card vanishes.

**Fix:** Merge suggestions and comments into a single array sorted by editor position BEFORE rendering. Build all cards in a single loop, in position order. `resolveOverlaps()` then processes them correctly (top-to-bottom).

**Files:** `src/public/js/editor-margin.js` (renderAllCards rewrite: merge + sort before loop)

---

### Bug #6: Selection drag stutters with multiple bold sections on same line
**Root cause:** For a line like `- **Key Passage**: text **1 Cor 15:3-4**`, `parseLineZones()` creates 5 zones. When dragging from inside bold1-content rightward, the cursor exits that zone. `selectionClamp` clamps `head` back to the zone boundary. The next mouse-move event pushes `head` forward again, gets clamped again — creating visible stutter/jank. With single bold sections this is smooth; with multiple it bounces against adjacent boundaries.

**Desired behavior:** Stay in anchor zone (user confirmed). Selection should cleanly stop at the zone boundary without jank.

**Fix:** Make the clamping smoother by ensuring `selectionClamp` doesn't return a modified transaction when the clamped result would be identical to what was already clamped. Add a check: if the new selection's head is already at the zone boundary (i.e., was already clamped in a previous pass), return `tr` unchanged instead of generating another clamped transaction. This prevents the bounce between "mouse pushes past boundary" → "filter pulls back" → "mouse pushes again" by letting the first clamp stick.

Also investigate whether CM6's `transactionFilter` returning `[tr, {selection}]` causes the browser to process extra DOM updates on each clamp — if so, return a single merged `TransactionSpec` instead of an array.

**Files:** `src/public/js/editor-constraints.js` (selectionClamp, lines 177-198)

---

### Bug #12: Line numbers re-enable on click after unchecking
**Root cause:** The CSS class `cm-hide-gutters` is toggled on `editorView.dom` (editor.js:992). But CM6 may set inline `display` on `.cm-gutters`, which overrides the stylesheet `display: none` (inline styles have higher specificity). Also, the class is not synced on editor re-init.

**Fix:** Use a CM6 `Compartment` for `lineNumbers()` and toggle it via `reconfigure()` (same pattern as `maskingCompartment`). This is the proper CM6 way to enable/disable extensions. Export `lineNumbers` from `editor-entry.js` if not already available, create `lineNumbersCompartment`, and reconfigure on checkbox change. Also sync checkbox state on editor init.

**Files:** `src/editor-entry.js` (add `lineNumbers` export), `src/public/js/editor.js` (add compartment, update toggle handler, sync on init)

---

## Priority 3 — UX Improvements

### Bug #2: Line numbers don't align with formatted text
**Root cause:** CM6's `lineNumbers()` gutter positions each line number at the logical line's top edge. Masking applies larger `fontSize` (2rem for H1, 1.5rem for H2) and `marginTop`/`paddingBottom` to headings, making those lines taller. The gutter elements don't inherit these styles, so line numbers progressively drift out of alignment with content.

**Fix:** CM6 actually DOES sync gutter element heights with content line heights via its internal measurement system — but the masking theme applies `marginTop`/`paddingBottom` on `.cm-heading-*` classes (which are marks on SPANS inside the line, not on the `.cm-line` div itself). This means the `.cm-line` div's height includes the heading text, but the extra margin is on the inner span, not affecting the line div's layout in a way CM6 can measure.

**Approach:** Move heading margin/padding styles from the heading mark classes (`.cm-heading-1` etc.) to the `.cm-line:has(.cm-heading-1)` selector (or use `Decoration.line()` instead of `Decoration.mark()` for headings). When the `.cm-line` div itself gets the extra height, CM6 syncs the gutter automatically.

**Files:** `src/public/js/editor-masking.js` (theme + heading decoration approach)

---

### Bug #8: Bidirectional click-to-focus (card → text)
**Root cause:** Only inline-decoration → margin-card direction is implemented (editor.js:822-831). Reverse is missing.

**Fix:** In `renderAllCards()`, add a click handler on each card that dispatches a selection change to the annotation's position with `scrollIntoView: true`, plus a highlight animation on the inline text (brief CSS pulse on the `.cm-suggestion-insert` or `.cm-comment-highlight` element).

**Files:** `src/public/js/editor-margin.js` (card click handler), `src/public/js/editor.js` (expose scroll-to-position helper), `src/public/css/style.css` (pulse animation)

---

### Bug #5: View Source should be read-only in suggest mode
**Fix:** Create a `readOnlyCompartment` (like `maskingCompartment`). When View Source is toggled ON in suggest mode, reconfigure it to `EditorState.readOnly.of(true)`. When toggled OFF, reconfigure to `[]`.

**Files:** `src/public/js/editor.js` (toggleViewSource function, add compartment)

---

### Bug #11: Revealed markdown characters wrong font size
**Root cause:** `.cm-revealed-syntax` has `fontSize: '0.75em'` (editor-masking.js:273). For heading lines where text is 2rem, the `##` markers appear tiny.

**Fix:** Change to `fontSize: 'inherit'` so markers match the surrounding text size. Keep `color: '#bbb'` to visually distinguish them (Obsidian approach: same size, muted color).

**Files:** `src/public/js/editor-masking.js` (line 273)

---

## Priority 4 — New Feature

### Feature #9: Bold/Italic buttons in suggest mode
**Behavior:** When text is selected in suggest mode and the comment tooltip appears, show B and I buttons alongside the "Add a comment" button. Clicking B wraps the selection with `**`, clicking I wraps with `_`. This creates a suggestion (tracked edit visible in margin panel). Keyboard shortcuts: Ctrl+B / Cmd+B for bold, Ctrl+I / Cmd+I for italic. Toggle: if the selected text is already bold/italic, clicking removes the markers.

**Implementation:**
1. Modify `showCommentTooltip()` (editor-comments.js:27) to include B and I buttons alongside the comment button
2. Add click handlers that use `editorView.dispatch()` to wrap/unwrap selected text with `**` or `_`
3. Add `keymap` entries for Ctrl+B/Cmd+B and Ctrl+I/Cmd+I to the suggest mode extensions
4. The diff engine (draftPlugin) automatically detects the change and creates a suggestion hunk

**Files:** `src/public/js/editor-comments.js` (tooltip), `src/public/js/editor.js` (keymap), `src/public/css/style.css` (button styling), `src/views/session.ejs` (if any HTML changes needed)

---

## Implementation Order

1. **Bug #1** (Done button) — quick fix, high impact, unblocks direct editing
2. **Bug #7** (Stale card) — one-line removal, restores important feedback
3. **Bug #12** (Line numbers) — Compartment approach, moderate effort
4. **Bug #11** (Reveal font size) — one-line CSS fix
5. **Bug #5** (View Source read-only) — small Compartment addition
6. **Bug #3** (Cards at top) — deferred render, small change
7. **Bug #4** (Card ordering) — merge/sort in renderAllCards
8. **Bug #8** (Bidirectional focus) — card click handler addition
9. **Bug #10** (Safari) — debug instrumentation first, then fix based on findings
10. **Bug #6** (Selection stutter) — zone merging or clamp expansion
11. **Bug #2** (Line number alignment) — heading decoration restructure
12. **Feature #9** (Bold/Italic) — new feature, most effort

## Verification

- Run full Playwright test suite after each batch of fixes
- Manual testing on Chrome and Safari for each bug
- For Bug #10: test specifically on Safari after fix
- For Bug #2: visual check that line numbers align with headings
- For Feature #9: test bold/italic toggle, keyboard shortcuts, and that suggestions appear in margin
- Watch for regressions: each fix must not break existing tests (61/69 currently passing)

## Risk Assessment — Cross-Impact Analysis

| Fix | Could Break | Mitigation |
|-----|------------|------------|
| #1 (Done button) | Nothing — only changes direct mode path | Direct mode is independent from suggest/review |
| #7 (Stale card) | Stale card re-injection after refresh must not conflict with normal cards | Stale cards rendered separately, don't participate in registry |
| #12 (Line numbers Compartment) | Editor init if Compartment not wired correctly | Test all three modes (suggest/direct/review) with toggle |
| #3 (Deferred render) | Brief flash of cards appearing | Use requestAnimationFrame for minimal delay |
| #4 (Card merge/sort) | Reply threading if card IDs change | Keep same data-hunk-id/data-comment-id attributes |
| #6 (Zone merging) | Edit protection if zones are too wide | Test that edits still can't span structural syntax |
| #2 (Heading decorations) | All masking if Decoration.line() changes layout | Test all heading levels, all formatting types |
| #10 (Safari perf) | Chrome perf if debouncing is too aggressive | Browser-specific guards if needed |
| #9 (Bold/Italic) | Constraint system if ** or _ insertion crosses zones | Test with text inside/outside bold sections |
