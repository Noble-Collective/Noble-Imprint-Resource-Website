# Phase 1a — Answers + Bookmarks on the resource website

Part of the ecosystem convergence project. Full design: `../../convergence-project-spec.md`.
Shared contract package: `Noble-Collective/Collective-Shared` → `@noble-collective/userdata`.

**1a scope:** end-user Google sign-in against the shared Firebase project + per-user **answers** and
**bookmarks** on series content, written client-direct to Firestore via the shared SDK. **No text
anchoring** (that's 1b — highlights/notes). This is the smallest end-to-end slice: it proves
auth → client SDK → security rules → cross-device continuity on the trivial-keying case.

## Guardrails (production safety)

- **Additive + feature-flagged.** Reader pages stay 100% server-rendered and fully functional with the
  new JS disabled/broken. Gate everything behind a flag (e.g. `FEATURE_USER_DATA`).
- **Lazy-loaded, signed-in-only.** Load the modular firebase SDK + reader bundle only on reader pages,
  ideally only after sign-in. Wrap all SDK calls so a failure degrades to "reading works, no save."
- **Isolated Firebase app.** Initialize a **named** modular app (`readerApp`) for the shared project,
  separate from the existing compat admin app on `noble-imprint-website`. Verify admin/editor login
  still works.
- **Branch, no direct deploy.** Do the work on `convergence-phase1a`; rely on the CI check gate +
  `/api/health` smoke check; don't merge to main until reviewed.

## Prerequisites (Firebase infra on project `noble-imprint-463519`)

- Web config already EXISTS (from the mobile app: appId `1:160156401404:web:39385683295e00348de179`,
  authDomain `noble-imprint-463519.firebaseapp.com`, apiKey `AIzaSyC3dwU9dR59QncPWsSgHG2CQxg4_jVqbrc`).
  Reuse it — no new web app registration needed.
- **Add authorized domains** for Auth: `resources.noblecollective.org`, `localhost`.
- **Deploy MERGED security rules** — ⚠ export the project's CURRENT live rules first and ADD the
  new-collection blocks (`answers`, `annotations`, `activity`, `planProgress`, `readingPositions`)
  ALONGSIDE the app's existing `answeredQuestions`/`highlights`/`comments`/`bookmarks` rules. NEVER
  replace — that would lock the live mobile app out of its data. Test old + new paths in the emulator,
  then deploy (rules are versioned → instant rollback).
- **CSP:** add `firestore.googleapis.com` + `identitytoolkit.googleapis.com` to `connect-src`.

## Build steps

1. **Consume the package.** Add `@noble-collective/userdata` (GitHub Packages, scoped `.npmrc`;
   `NODE_AUTH_TOKEN` with `read:packages` in the Docker build) — or a git dependency for the first cut.
2. **Reader Firebase init** (`src/public/js/reader-userdata.js`, lazy): `initializeApp(readerConfig, 'readerApp')`,
   `getAuth`, `getFirestore`; `createUserDataClient(db, uid)` from `@noble-collective/userdata/client`.
3. **Auth UX:** a sign-in affordance on reader pages (Google popup); anonymous state shows inputs
   disabled with "Sign in to save"; persist session; sign-out.
4. **Answers:** for each `.question-block[data-question-id]`, render an input; on focus load the existing
   answer (`getAnswer(locator)` where `locator = seriesLocator(bookPath, sessionFile, {questionId})`);
   autosave (debounced) via `putAnswer`. Stamp `contentVersion` = the session file's git SHA (already in
   the content pipeline).
5. **Bookmarks:** a per-session bookmark toggle → `putAnnotation({kind:'bookmark', locator})` /
   `deleteAnnotation`; a "my bookmarks" list from `listAnnotations()` filtered to `kind==='bookmark'`.
6. **`bookPath`/`sessionFile`:** emit them into the reader page (the server already resolves the route to
   `series/.../Book` + `NN-Name.md`) so the client can build locators.

## Testing

- Local: point the reader app at the Firestore **emulator** (or a dev config) to exercise answers/bookmarks
  without touching prod; the shared package already has emulator-backed SDK tests to mirror.
- Cross-device: sign in on two devices, confirm an answer typed on one appears on the other.
- Regression: reader pages work with the flag OFF and with JS disabled; admin/editor console unaffected.

## Out of scope (later)

- 1b: highlights + notes + the reader annotation layer (text-extraction contract, DOM range painting).
- `onSnapshot` live sync (one-shot loads are fine for 1a).
- Migrating the site's admin auth onto the shared project (separate later phase).
