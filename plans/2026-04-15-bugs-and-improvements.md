# Bug Fixes & Improvements — 2026-04-15

## Bugs Fixed Today

1. **Margin card crash after auto-save** — `data.pendingSuggestions.push()` missing authorName/authorEmail → `escapeHtml(undefined)` crash
2. **Card vanishing after accept** — Full doc replacement corrupted registry via mapPos. Fix: rebuild registry from fresh server data.
3. **Double decorations** — Draft plugin now filters hunks already in registry. Margin merges registry + draft.
4. **Accept inserting text at wrong position** — `extractContext()` used stale page-load `originalContent` instead of current `originalDocField`.
5. **Two more stale originalContent references** — In `rejectOrDeleteHunk` and Done button handler.
6. **Discard (X) re-creating suggestion** — `isDiscarding` guard suppresses auto-save during multi-dispatch discard.
7. **Comment "onCommentAdded is not a function"** — `refreshFromGitHub` was re-calling `initComments` with wrong args (3 instead of 2), overwriting callback + adding duplicate listeners.
8. **Stale context after reanchoring** — `reanchorAnnotations` updated positions but not contextBefore/contextAfter strings, causing accepts to fail when nearby text changed.

## Infrastructure Changes

- `.env` + `service-account-key.json` for local dev (no gcloud auth needed)
- `dotenv` loaded in server + Playwright config
- Deploy workflow: removed `repository_dispatch`, added `concurrency` group
- Resources repo workflow: curls `/api/refresh` instead of triggering full rebuild
- `/api/refresh` now proactively rebuilds content tree

## Still Open (from Steve's testing feedback)

### Highlight position drift after accepts
After accepting several edits, the green/red highlighting of remaining suggestions drifts slightly — positions don't exactly match the intended text. Likely the registry rebuild after refresh is placing decorations at the re-anchored server positions, which may be off by a few chars if the re-anchoring cascade falls through to a less precise strategy.

### Stale suggestion should refresh the editor
When a suggestion is stale (file changed externally) and the user tries to accept it, the server correctly returns 409/stale. But the editor still shows the old content. It should call `refreshFromGitHub()` after a stale result to show the latest file content and remove the stale suggestion's decorations.

### Integration tests need validation
Two integration tests written but not yet validated (GitHub API rate limit exhausted during testing). Need to run when rate limit resets.
