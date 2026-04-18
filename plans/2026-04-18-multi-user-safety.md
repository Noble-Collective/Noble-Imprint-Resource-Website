# Multi-User Concurrent Editing Safety

## Context

Multiple team members will soon be editing the same books simultaneously. The current suggestion system works fine for one user at a time — but with concurrent users, no one knows anyone else is there, accepted suggestions silently make other editors' views stale, and auto-save errors are swallowed without telling the user. This plan adds safety, awareness, and conflict handling in three incremental batches.

---

## Batch 1: Safety Net

Ship this before multiple users start editing. All three steps are independent and can be built in parallel.

---

### Step 1: Surface auto-save errors

**What:** The `autoSave()` function in `editor.js` has three `catch { /* ignore */ }` blocks. When a save fails (network issue, auth expired, server down), the user sees "Saved" and thinks their work is safe. Replace these with visible error feedback — show "Save failed" in red in the toolbar, retry on the next auto-save cycle.

**Files:** `src/public/js/editor.js` (autoSave function), `src/public/css/style.css` (error style)

**Risks and mitigations:**
- Transient network blips could flash "Save failed" unnecessarily. **Mitigation:** Only show after 2 consecutive failures. Clear on success.
- Risk to existing functionality is very low — save logic is unchanged, only the error handling path changes.

**Tests (Playwright):**
- Mock the save endpoint to return 500. Verify the toolbar shows "Save failed" (not "Saved").
- Let the mock recover to 200. Verify the next auto-save succeeds and the error clears.
- Verify that a single transient 500 followed by a 200 does NOT show an error (2-failure threshold).

---

### Step 2: File version check before saving

**What:** Add a lightweight endpoint `GET /api/suggestions/file-version?filePath=...` that returns the current file SHA (from the in-memory cache) and suggestion count. Before each auto-save write, the client checks this SHA against the page-load SHA. If it differs, auto-save is blocked and a warning appears: "This file was updated. Reload to continue editing."

**Files:** `src/server/suggestion-routes.js` (new route), `src/public/js/editor.js` (SHA check in autoSave)

**Risks and mitigations:**
- If the version endpoint is down/slow, auto-save could block. **Mitigation:** 3-second timeout on the fetch. On failure or timeout, proceed with the save anyway — the check is advisory, not a gate.
- Fresh deploys clear the cache, briefly returning null SHA. **Mitigation:** Only flag stale when a different VALID SHA is returned, not when the endpoint errors or returns null.
- Risk to existing functionality is low — this is a new pre-check, not a change to the save path itself.

**Tests (Playwright):**
- Create a suggestion via editor, accept it via server API (changes the file SHA), then verify auto-save on the same editor session is blocked and the warning appears.
- Test the timeout fallback: intercept the version endpoint with a long delay, verify auto-save still fires (doesn't hang).
- Test normal flow: file hasn't changed, verify auto-save proceeds normally with no warning.

---

### Step 3: Server-side suggestion deduplication

**What:** In `createHunk()` in `suggestions.js`, before creating a new Firestore document, query for any existing pending suggestion on the same file with the same `originalText`, `newText`, and overlapping position (within ±5 chars). If found, return the existing ID instead of creating a duplicate.

**Files:** `src/server/suggestions.js` (createHunk function)

**Risks and mitigations:**
- False dedup: two users independently fix the same typo — second user's suggestion is silently merged. **Mitigation:** Only dedup when text AND position (±5) both match. Different positions = different suggestions. Return a flag indicating dedup occurred so the client can log it.
- Adds a Firestore read before every write (~50ms, indexed query). With 2-5 users this is negligible.
- This modifies the create path, which is critical. **Mitigation:** Test thoroughly before shipping.

**Tests (Playwright + server-side):**
- Create a suggestion via API. Create an identical suggestion (same text, same position). Verify Firestore has exactly 1 document and the second call returns the first's ID.
- Create two suggestions with the same text but positions 100 chars apart. Verify both are created (not deduped).
- Create two suggestions at the same position but different newText. Verify both are created.

---

## Batch 2: Awareness

Ship after Batch 1 is stable. Users can now see each other and know when the file changes.

---

### Step 4: Poll for changes + stale file banner

**What:** After the editor initializes, start a `setInterval` (every 30 seconds) that calls the file-version endpoint from Step 2. When the SHA changes, show an amber banner at the top of the editor: "This file was updated by another user. [Reload latest version]". The button calls `refreshFromGitHub()`. Also track the suggestion count — if it increases, show "N new suggestions were added. [Click to refresh]".

**Files:** `src/public/js/editor.js` (polling interval, banner logic), `src/views/session.ejs` (banner HTML), `src/public/css/style.css` (banner styling)

**Risks and mitigations:**
- API cost: 2 calls/min per active editor. With 5 users on 3 files = ~30 calls/min. The endpoint is cached and lightweight — negligible for Cloud Run.
- Banner could misfire on deploy (cache cleared). **Mitigation:** Null/missing SHA = "unknown" not "changed".
- Banner positioning could push editor content down, breaking margin card alignment. **Mitigation:** Use a fixed/absolute-positioned overlay, not a layout-shifting element. Test card positions with banner visible.

**Tests (Playwright):**
- Open editor. Accept a suggestion via server API (changes file). Wait up to 35 seconds. Verify the stale banner appears.
- Click the "Reload" button on the banner. Verify the editor refreshes with updated content and the banner disappears.
- Verify the polling interval clears when exiting suggest mode (no orphan intervals).
- Create a suggestion via API while another user has the editor open. Verify the "new suggestions" notification appears within 35 seconds.

---

### Step 5: Presence indicator ("Jane is editing this file")

**What:** New Firestore collection `editingSessions` tracks who is actively editing each file. Three server endpoints: POST (enter editing), DELETE (exit), GET (list active editors). Client sends a heartbeat every 30 seconds (piggybacked on the polling interval from Step 4). `beforeunload` fires a `sendBeacon` DELETE for tab closes. Toolbar shows avatars/initials of other active editors. Sessions with stale heartbeats (>90 seconds) are filtered out at read time.

**Files:** `src/server/suggestion-routes.js` (3 routes), `src/server/suggestions.js` (editingSessions CRUD), `src/public/js/editor.js` (heartbeat + display), `src/views/session.ejs` (presence container in toolbar), `src/public/css/style.css` (avatar styling)

**Risks and mitigations:**
- Zombie sessions from crashed browsers. **Mitigation:** Heartbeat expiry — stale entries (>90s without heartbeat) are filtered out on read. No manual cleanup needed.
- Mobile Safari doesn't always fire `beforeunload`. **Mitigation:** Same heartbeat expiry handles this — no heartbeat = entry ages out in 90 seconds.
- Firestore write volume: ~10 writes/min with 5 users. Well within free tier (20K writes/day).
- This is entirely additive — new collection, new endpoints. No existing code paths are modified.

**Tests (Playwright):**
- Open editor in two separate browser contexts (simulating two users). Verify each sees the other in the presence indicator.
- Close one browser context. Wait 2 minutes. Verify the other user's presence indicator removes the closed user.
- Enter suggest mode, then exit. Verify the presence entry is deleted immediately (not waiting for expiry).
- Verify presence shows the correct user name/initials, not email.

---

## Batch 3: Graceful Conflict Handling

Ship when Batch 2 is stable. Makes conflicts smoother when they do happen.

---

### Step 6: Warn before losing unsaved drafts on reload

**What:** When the stale banner from Step 4 appears and the user clicks "Reload", check if there are unsaved draft edits (text typed but not yet auto-saved). If so, force an auto-save first, wait for it to complete, then refresh. If auto-save fails (file is stale), warn: "You have unsaved changes that couldn't be saved because the file changed. Copy your changes before reloading."

**Files:** `src/public/js/editor.js` (enhance stale banner reload handler)

**Risks and mitigations:**
- Forcing auto-save before refresh adds a delay (1-3 seconds). **Mitigation:** Show a spinner on the reload button while saving.
- If the forced auto-save creates suggestions against a stale file, those suggestions have wrong positions. **Mitigation:** The version check from Step 2 blocks the save. The user sees the warning about unsaved changes instead.
- Risk to existing functionality is low — `refreshFromGitHub()` is unchanged. We're adding a pre-step.

**Tests (Playwright):**
- Type text in the editor (don't wait for auto-save). Change the file via server API. Wait for stale banner. Click reload. Verify the typed text was saved to Firestore before the refresh happened.
- Same setup but with version check blocking the save. Verify the user sees a warning about unsaved changes instead of silently losing them.

---

### Step 7: Better accept conflict UX (nice-to-have)

**What:** When an admin gets a 409 stale error on accept, the current stale card just has "Dismiss". Add a "Try again" button that re-fetches the current file, re-runs anchor resolution to find the original text in the new file, and if found, re-attempts the accept with the updated SHA.

**Files:** `src/public/js/editor-margin.js` (enhance stale card), `src/public/js/editor.js` (retry logic)

**Risks and mitigations:**
- Auto-retry could apply the suggestion to wrong text if the anchor resolves to a different occurrence. **Mitigation:** Show the user what text will be changed before confirming the re-apply.
- Risk to existing functionality is low — the stale card is already rendered. We're adding a button.

**Tests (Playwright):**
- Create two suggestions. Accept one via a separate API call (to change the file SHA). Try to accept the second via the UI. Verify 409 stale card appears with "Try again" button. Click it. Verify the suggestion is accepted successfully on retry.
- Same setup but the second suggestion's text was deleted by the first accept. Click "Try again". Verify the user is told "Cannot re-apply — the original text no longer exists."

---

## Summary

| Step | What | Risk level | Test coverage |
|------|------|-----------|---------------|
| 1. Error surfacing | Show save failures in toolbar | Very low | 3 tests |
| 2. Version check | Block stale saves, warn user | Low | 3 tests |
| 3. Server dedup | Prevent duplicate Firestore entries | Medium-low | 3 tests |
| 4. Polling + banner | Detect and show file changes | Low | 4 tests |
| 5. Presence | Show who else is editing | Low | 4 tests |
| 6. Draft preservation | Save before reload | Low | 2 tests |
| 7. Accept retry | Re-apply stale suggestions | Low | 2 tests |

Every step has automated Playwright tests. No manual testing required.
