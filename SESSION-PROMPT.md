# Session Prompt for New Context Window

## Project

Noble Imprint Resource Website — Express/EJS app serving discipleship resources with a collaborative CodeMirror 6 editor. GitHub is the content store, Firestore for suggestions/comments/replies/presence, Firebase Auth with Google sign-in.

**Live site:** https://resources.noblecollective.org  
**Repo:** Noble-Collective/Noble-Imprint-Resource-Website

## What was completed (April 18-19, 2026)

### Multi-User Concurrent Editing (all deployed)

Full real-time collaborative editing safety across 3 batches:

**Batch 1 — Safety Net:** Auto-save error surfacing (2-failure threshold), file version check before saves (3s timeout fallback), server-side suggestion deduplication (±5 chars).

**Batch 2 — Real-Time Awareness:**
- Split polling: 10s Firestore-only for suggestion/comment/reply counts, 30s GitHub SHA for file changes, 30s presence heartbeat
- Auto-load: new suggestions, comments, and replies from other users appear within ~10s without page reload. Removals (discards by others) also sync automatically.
- Auto-refresh on file SHA change (accept by another user) when no unsaved edits — uses fresh GitHub content, updates originalDocField + contentSha. Shows stale banner only when user has unsaved drafts.
- Presence: Firestore editingSessions with heartbeat + photoURL, 90s expiry, Google profile photos or colored initials per user
- Own suggestions do NOT trigger "new suggestions" notification (lastKnownSuggestionCount synced after auto-save)

**Batch 3 — Graceful Conflict Handling:**
- Draft preservation on reload: forceSaveUnsavedDrafts() before stale banner reload
- Accept retry: "Try again" button on 409 stale cards
- Stale card rendering via module-level staleCards Map (replaced fragile DOM injection)

**Profile Photos:** Google profile photos on suggestion cards, comment cards, reply cards, and presence toolbar. authorPhotoURL stored in Firestore. Colored initials fallback (10-color palette hashed from email).

**Suggestion Badges:** Amber badge pills on book detail page session cards showing pending suggestion count (for users with suggest+ access).

## What was completed (April 20, 2026)

### Polling Race Condition Fixes
- `autoLoadNewSuggestions()` now guards against concurrent execution with `isDiscarding`, `acceptingInProgress`, and `autoLoadInProgress` flags — prevents document corruption from overlapping `setAnnotations` dispatches
- `pollForFileChanges` fetch has a 5s `AbortController` timeout — prevents indefinite hang on slow GitHub API

### Stale Card Persistence Fix
- "Cannot re-apply" state (from retry when original text was deleted) now stored in the `staleCards` Map via `updateStaleCard()` instead of fragile DOM manipulation — survives margin re-renders triggered by background polls

### Draft Author Attribution Fix
- Draft suggestion cards no longer flash the wrong author name when another user has a pending suggestion on the same file. The `loadedSuggestions.find()` content matching was too loose (all insertions have empty `originalText`, matching any other insertion). Fixed to use ID-only matching.

### Cross-User Suggestion Removal Fix
- Suggestions discarded by another user now correctly disappear from the author's screen. The `autoLoadNewSuggestions` removal check previously required `loadedFromServer: true`, but session-created suggestions have `loadedFromServer: false`. Removed the flag guard.

### Bold/Italic Card Splitting Fix
- Multi-word italic/bold formatting no longer splits into 2 cards after auto-save. `buildMarginHunks` now includes `linkedGroup`/`linkedLabel` from registry entries, and `buildShiftedRegistryEntries` preserves `resolvedFrom`/`resolvedTo`/`linkedGroup`/`linkedLabel`.

### Ghost Suggestion Cards Fix (API-Submitted)
- API-submitted replacements (e.g., from Claude AI) no longer generate ghost "Saving..." draft cards. Added positional containment filter in the draftPlugin: if a draft hunk falls within any registry entry's position range, it's a fragment of that entry's change and is filtered out.

### Line Ending Normalization
- Files with Windows-style `\r\n` line endings no longer generate dozens of ghost deletion suggestions. Normalization applied server-side in `getFileContent()` (github.js) so all code paths receive clean `\n` line endings.

### Editor Exit UX
- "Done" button now shows a blurred loading overlay with spinner and "Loading latest content..." during the page reload, instead of a frozen-looking tab.

### Draft Card "Saving..." Indicator
- Draft suggestion cards show a spinner with "Saving..." instead of accept/discard buttons until auto-save completes. Prevents confusing error toast when clicking accept before the draft is saved to Firestore.

### Claude AI Bot API Improvements
- New `GET /api/content-tree` endpoint — returns all books and session file paths for bot file path discovery. Claude no longer needs to guess file paths.
- Updated Claude editor prompt (docs/claude-editor-prompt.md) to call content-tree first.

### Test Suite Improvements
- **New tests:** Comment auto-load, comment-reply auto-load, discard stays discarded through polling, accept completes despite polling, presence expiry (90s), draft author attribution, multi-word italic card, discarding API suggestions, session-created suggestion removal by another user
- **Flaky test fixes:** Retry tests now clear server cache before login; "save error clears" assertion timeout increased; `waitForAutoSave` now waits for "Saved" indicator instead of fixed 3s timeout; integration test word-finding searches original document instead of working document
- **~120 total tests** across 7 files. Full suite needs ~4900 GitHub API calls (5000/hr limit).

## Current Test Suite

**32 multi-user tests** in tests/multi-user.spec.js:
- 3 auto-save error, 3 version check, 3 dedup, 8 polling/sync, 3 presence, 2 draft preservation, 2 accept retry, 5 cross-user integrity, 1 accept auto-refresh, 5 polling safety + coverage gaps (comment auto-load, reply auto-load, discard safety, accept safety, presence expiry)

**~120 total tests** across 7 files. Full suite needs ~4900 GitHub API calls (5000/hr limit). The soak test alone uses ~1000.

## Key Architecture Notes

- Server: `src/server/index.js` (Express + all routes), `src/server/suggestions.js` (Firestore CRUD), `src/server/github.js` (GitHub API + 30s file cache + `\r\n` normalization)
- Client: `src/public/js/editor.js` (orchestration), `src/public/js/editor-suggestions.js` (annotationRegistry StateField + draftPlugin + computeHunks + positional containment filter), `src/public/js/editor-margin.js` (margin cards + staleCards Map + updateStaleCard)
- Endpoints: `GET /api/suggestions/suggestion-count` (Firestore-only fast polling), `GET /api/content-tree` (book/session discovery for bots)
- Combined dispatches: document replacement + setAnnotations must be in ONE dispatch to avoid mapPos corruption
- File cache: test process and server process have separate cache instances — test utilities must call cache.del before getFileContent
- Registry entries: must include `resolvedFrom`/`resolvedTo` (for API suggestions with originalFrom:0), `linkedGroup`/`linkedLabel` (for italic/bold card merging)
- autoLoadNewSuggestions: guarded by `isDiscarding`, `acceptingInProgress`, `autoLoadInProgress` to prevent race conditions
- Draft filtering: positional containment check ensures API-submitted replacement fragments don't leak as ghost cards

## What's Next

- Mobile editing: responsive margin panel, touch interactions
- Notification system: when suggestions are submitted/accepted/rejected
- SEO meta tags / Open Graph
- Content search across all sessions
