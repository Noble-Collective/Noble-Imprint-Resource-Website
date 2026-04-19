# Post Multi-User Safety: Open Concerns & Next Steps

## Context

The multi-user concurrent editing safety plan (7 steps, 3 batches) is fully implemented and deployed. 20 tests pass in `tests/multi-user.spec.js`. However, the full test suite (84+ tests across 6 files) **cannot be run in a single session** because it exhausts the GitHub API rate limit (5000/hr). Every page load hits GitHub via `buildContentTree()` and `getFileContent()`, and test utilities like `saveCleanFile()`/`restoreCleanFile()` each make 2-4 API calls.

Additionally, Steve requested suggestion badges on book/session pages, and there are two tech debt items from the multi-user work that should be cleaned up.

---

## Item 1: GitHub API Caching (HIGH PRIORITY)

**Problem:** `github.getFileContent()` makes a raw API call every time — no caching. The full test suite burns through 5000 API calls. This also adds unnecessary latency in production.

**Approach:** Cache `getFileContent` results in the existing `cache.js` module with a 30-second TTL. Invalidate the specific file's cache entry on `updateFileContent`. The existing `cache.invalidateAll()` calls (on accept, reject, direct-edit, `/api/refresh`) already cover all write paths.

**Files:**
- `src/server/github.js` — wrap `getFileContent` with cache lookup, invalidate in `updateFileContent`
- `src/server/cache.js` — add `del(key)` if not already present

**Also:** Change Octokit `onRateLimit` from `() => false` to `(retryAfter) => retryAfter < 10` to allow short retries instead of immediate failure.

**Risk:** Low. 30s stale window is within the existing stale-banner safety net.  
**Size:** S (~25 lines)

---

## Item 2: Suggestion Badges on Book Pages (FEATURE)

**Problem:** No way to see pending suggestion counts without opening each session. Reviewers waste time clicking through sessions.

**Approach:**
1. New `getSuggestionCountsByBook(bookPath)` function in `suggestions.js` — single Firestore query, groups by filePath, returns `{ filePath: count }` map.
2. In the book detail route (`src/server/index.js`), call this for users with `comment-suggest` role or higher. Pass `suggestionCounts` to template.
3. In `book.ejs`, show an amber badge pill on each session card that has pending suggestions.
4. CSS for `.suggestion-badge` — match existing `.admin-tab-badge` amber/gold style.

Only visible to users with `comment-suggest`, `manuscript-owner`, or `admin` roles (not `viewer`).

**Files:**
- `src/server/suggestions.js` — new `getSuggestionCountsByBook()` function
- `src/server/index.js` — book route enhancement (the `resolved.type === 'book'` branch)
- `src/views/book.ejs` — badge HTML on session cards + sidebar nav
- `src/public/css/style.css` — `.suggestion-badge` styling

**Risk:** Low. Purely additive — new query, new template variable, new HTML/CSS.  
**Size:** S (~40 lines)  
**Depends on:** Item 1 (caching) reduces API cost when navigating to book pages.

---

## Item 3: Eliminate `data.pendingSuggestions` Mutation (TECH DEBT)

**Problem:** `data.pendingSuggestions` (from `window.__EDITOR_DATA`) is mutated during the session (pushed to during auto-save), creating confusion about the source of truth vs the annotation registry.

**Approach:**
1. **Remove the mutation** in `editor.js` auto-save (the "Legacy: keep pendingSuggestions in sync for findFirestoreId fallback" block, ~lines 235-248). The registry already has all the data that `findFirestoreId` needs.
2. **Replace margin author lookup** in `editor-margin.js` — instead of reading `window.__EDITOR_DATA.pendingSuggestions` for author info, read from the annotation registry via `editorView.state.field(window.__annotationRegistry)`.
3. **Keep `data.pendingSuggestions` as a read-only initial snapshot** from the server. Add a comment marking it as such.

**Files:**
- `src/public/js/editor.js` — remove mutation block, add read-only comment
- `src/public/js/editor-margin.js` — replace `loadedSuggestions` lookup with registry

**Risk:** Low-Medium. Need to verify registry is populated before first `renderAllCards` call.  
**Size:** S (~20 lines)

---

## Item 4: Clean Up Stale Card Injection Pattern (TECH DEBT)

**Problem:** The `data-injected-stale` + DOM preservation pattern is fragile. It relies on the draftPlugin's 300ms debounce timing, stores state in DOM attributes, and requires manual synchronization in `renderAllCards()`.

**Approach:** Replace DOM injection with a module-level `staleCards` Map in `editor-margin.js`:
1. Add `const staleCards = new Map()` — hunkId to staleData + callbacks.
2. Export `addStaleCard(hunkId, staleData, onDismiss, onRetry)` and `removeStaleCard(hunkId)`.
3. In `renderAllCards()`, check the map. Render stale cards as a `kind: 'stale'` item in the normal rendering pipeline — no injection or preservation needed.
4. In `editor.js`, call `addStaleCard()` instead of `injectStaleCard()`. Call `removeStaleCard()` on dismiss/retry-success.
5. Delete `injectStaleCard()` and all `data-injected-stale` / `preservedStaleIds` logic.

**Files:**
- `src/public/js/editor-margin.js` — staleCards Map, addStaleCard/removeStaleCard, render in pipeline
- `src/public/js/editor.js` — swap injectStaleCard calls, add removeStaleCard calls

**Risk:** Medium. Changes the stale card rendering path. Needs the Step 7 accept-retry tests to verify.  
**Size:** M (~60-80 lines)

---

## Item 5: Mobile Editing & Notifications (FUTURE — deferred)

Not implemented in this plan. Both are L-sized efforts that should be separate plans:
- **Mobile editing:** Margin panel needs to become a bottom sheet/overlay. Touch interactions need testing. ~2-3 days.
- **Notifications:** Notification bell + panel, Firestore tracking, polling or onSnapshot. ~3-5 days.

---

## Execution Order

```
Item 1 (Cache) → Item 2 (Badges) → Item 3 (pendingSuggestions) → Item 4 (Stale cards)
```

Item 1 unblocks everything (can run full test suite). Item 2 is the user-requested feature. Items 3-4 are cleanup.

## Verification

After all 4 items:
- Run the full test suite (`npx playwright test tests/ --workers=1`) in a single session without rate limit exhaustion
- Verify suggestion badges appear on book pages for users with suggest+ access
- Verify margin cards show correct author names (registry-based, not stale snapshot)
- Verify accept-retry flow (409 → stale card → Try again) still works with the new stale card rendering
