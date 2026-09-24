# Sign in with Apple on the resources site (Google + Apple, both first-class)

**Date:** 2026-09-24
**Status:** PLAN — nothing built on this site yet. Ecosystem plan approved 2026-09-23.
**Ecosystem plan (read first):** `Collective-Shared/plans/2026-09-23-apple-sign-in-first-class.md`
(this doc is its **step 2**, §5.1 "Resources site").
**Cross-product contract:** `Collective-Shared/ARCHITECTURE.md` **§9a** (button order, link flow,
Connected accounts, reauth, name prompt, `trustedEmail`). Everything below must follow §9a.
**Flag:** `FEATURE_APPLE_SIGNIN=1` (default **off** = today's Google-only UX, byte-for-byte).

---

## 0. What is already done (not this site)

- **Firebase `noble-imprint-463519`:** Apple provider enabled, web code-flow configured (Services ID
  `com.noblecollective.signin`, team `59VTJ526ML`, key set). One-account-per-email is ON. Authorized
  domains already include `resources.noblecollective.org`, `account.noblecollective.org`, `localhost`.
- **Apple portal:** Services ID lists domain `account.noblecollective.org` + return URL
  `https://account.noblecollective.org/__/auth/handler`. This site's `authDomain` is already
  `account.noblecollective.org` (`src/reader-userdata/firebase.js:15`), so no config change here —
  and a real Apple popup works from `localhost` too (the handler is on the auth domain).
- **Apple Private Email Relay:** `noblecollective.org` + `notifications@noblecollective.org`
  registered (SPF passes) → mention/notification emails (Mailgun, `notifications@`) reach
  `@privaterelay.appleid.com` addresses.
- **SDK `@noble-collective/userdata` 0.2.8:** `core/auth-contract` (pure: `PROVIDER_KINDS`
  google→apple, `signInLabel`, `kindOf`, `otherKind`, `linkedKindsOf`, `canUnlink`, `reauthKindFor`,
  `isRelayEmail`, `linkPrompt`, `NAME_PROMPT`, `trustedEmail`) and the `./auth` subpath over
  `firebase/auth` (`signIn` → `signed-in | needs-link | cancelled | popup-blocked`, `completeLink`
  with wrong-account guard, `linkProvider`/`unlinkProvider` (never the last), `reauth`,
  `profileFromCredential`/`backfillProfile`/`setDisplayName`, `requestEmailChange`). 11 Auth-emulator
  tests in `Collective-Shared/packages/userdata/auth-tests/auth-flows.test.ts`.
- **Mobile app:** shipped to TestFlight (Google-first equal buttons, Apple on Android, name prompt,
  Connected accounts, provider-aware reauth).

**Key finding from the SDK tests (drives the UX below):** a **verified** same-email sign-in with the
other provider **auto-links** to the existing uid — no error, no dialog. `needs-link` (the link
dialog) only happens for an **unverified** email. So the dialog is a rare path, but it must exist.

## 1. Current implementation (verified 2026-09-24)

| Where | What it does today | Google-specific? |
|---|---|---|
| `src/reader-userdata/firebase.js:4-8` | imports `GoogleAuthProvider`, `signInWithPopup`, `reauthenticateWithPopup`, `getAdditionalUserInfo`, `updateProfile` | yes |
| `firebase.js:33-40` | `?ncEmu=1` on localhost → Auth/Firestore emulators + `window.__ncTestSignIn(email, sub, name)` = `signInWithCredential(GoogleAuthProvider.credential(...email_verified:true...))` | yes (Google-only seam) |
| `firebase.js:60-78` `bridgeSession(cred)` | (unified only) backfills name/photo from the **raw Google profile** (`getAdditionalUserInfo(cred).profile` `name`/`given_name`/`picture`) → `updateProfile` → `getIdToken(true)` → `POST /api/auth/session {idToken, profile}` → `location.reload()` | yes (profile shape) |
| `firebase.js:80-87` `googleProvider()` / `signIn()` | `signInWithPopup(googleProvider())` → `bridgeSession`; errors only `warn`ed | yes |
| `firebase.js:106-116` `deleteAccount()` | **`reauthenticateWithPopup(user, new GoogleAuthProvider())` at line 112**, then `deleteAllData` → `deleteUser` → `/api/auth/logout` | **yes — breaks for Apple-only users** |
| `src/reader-userdata-entry.js:94-105` `showSignInIntro` | popover: "Sign in" + "Sign in to save your bookmarks, highlights, and notes across devices." + one **"Continue with Google"** `nc-btn--primary` | yes |
| `reader-userdata-entry.js:108-171` `toggleAccountMenu` | name/email, My Notebooks, Notifications (isEditor), Sign out, "Manage your data" (Privacy, Delete my data, Delete account) — **no Connected accounts** | — |
| `reader-userdata-entry.js:70-81` `userAvatarEl` | photo `<img>` else initials chip (already handles no-photo → Apple is fine) | no |
| `reader-userdata-entry.js:283-286` | under `__NC_UNIFIED`, `window.loginWithGoogle = () => signIn()` for the mobile header drawer (`src/views/partials/header.ejs:87` "Sign In" button calls `loginWithGoogle()`) | yes (goes straight to the Google popup) |
| `src/views/partials/footer.ejs:80-83` | unified: `window.__NC_UNIFIED = true`, `window.__NC_USER = {email, displayName, photoURL, isAdmin, isEditor}`; bundle `reader-userdata-bundle.js?v=53` at `:93` | no |
| `footer.ejs:61-75` + `src/public/js/auth.js` | legacy compat login (flag **off** only; `AUTH_UNIFIED=1` in prod) — Google, `noble-imprint-website` project | leave alone |
| `src/server/index.js:438-470` `/api/auth/session` | `createSessionCookie(idToken)` → `verifyIdToken` → bounded client `profile` (`displayName` ≤200, `photoURL` ≤1000) else `decoded.name`/`picture` → `firestore.createOrUpdateUser(decoded.email, …)` → clears `roleflags:` cache. **No `email_verified` check.** | no (provider-agnostic) |
| `src/server/auth.js:127-166` `attachUser` (session-cookie path) | `email = decoded.email` → `isSuperAdmin(email)` (`auth.js:48-50`, `SUPER_ADMIN_EMAIL` `auth.js:5`) + `getRoleFlags(email)` (cached 60s) → `isAdmin`/`isEditor`; name/photo from `decoded.name`/`picture` else stored profile. **No `email_verified` check.** An absent `email` throws at `email.toLowerCase()` (`:146`) → caught → `req.user = null`. | no |
| `src/server/firestore.js:124-142` `getRoleFlags` / `getUserBookRole` | roles keyed on the (lower-cased) email doc id in the website project's `users` collection | no |
| `src/server/firestore.js:21-51` `createOrUpdateUser` | new doc → `displayName: displayName || email`; existing doc only replaces `displayName` when it is missing **or equals the email** | no — and this is what lets the name prompt fix a relay-address name later |
| `test-harness/` (gitignored) `run.sh` + `reader-test.mjs` | emulators (`--project demo-nc`) + site with `FEATURE_USER_DATA=1` only (**no `AUTH_UNIFIED`**, so `bridgeSession` and the server session are never exercised); every flow calls `window.__ncTestSignIn()` | yes |

Firestore rules, the data model, the SDK user-data client and all per-user paths key on `uid` and
are provider-agnostic — **no rules or data change**.

## 2. Design decisions (from Steve, 2026-09-23 — don't relitigate)

1. Two buttons, **Google first, Apple second, equal size**, same order as every product.
2. The shared helper lives in the SDK (`@noble-collective/userdata/auth`); no per-site copy of the flows.
3. Admins may sign in with Google **or** Apple. Roles stay keyed on the account's **primary** email
   (per uid, not per provider), reached via linking or a verified email change.
4. One-time **"What should we call you?"** prompt when no name is available.
5. The device-local settings-sync switch is **later** (not required for Apple) — §9.

## 3. File-by-file implementation

### 3.1 Re-vendor the SDK 0.2.8 (prerequisite, no behavior change)

- `cd Collective-Shared/packages/userdata && npm run build && npm pack` → copy
  `noble-collective-userdata-0.2.8.tgz` into `vendor/`; delete the 0.2.7 tarball.
- `package.json` devDependency → `file:vendor/noble-collective-userdata-0.2.8.tgz`; run
  `npm install ./vendor/noble-collective-userdata-0.2.8.tgz` **explicitly** (a same-name/`file:`
  tarball is otherwise not refreshed); commit `package-lock.json` (the CI `check` job runs `npm ci`).
- `npm ls firebase` must show **one** `firebase` (the SDK's is a peer). Two copies = two Auth
  registries in the esbuild bundle → `auth/argument-error`.
- `npm run build:reader` + `npm run test:unit` green (0.2.8 is additive; `osis.test.js` requires
  `@noble-collective/userdata/core` and must still pass).
- ⚠ **The SDK is a devDependency** (bundled into the browser only). The server image
  (`npm ci --omit=dev`) does **not** contain it, and its `core` entry pulls in `zod` (not a prod dep)
  — see the comment at `src/server/osis.js:4-7`. **The server must never `require` the SDK** (§3.6).

### 3.2 Feature flag plumbing

- `src/server/index.js` (next to `featureAuthUnified`, ~line 91):
  `res.locals.featureAppleSignin = process.env.FEATURE_APPLE_SIGNIN === '1' && process.env.AUTH_UNIFIED === '1'`.
  (Apple only exists on the unified 463519 identity; the legacy compat path stays Google-only.)
- `footer.ejs` unified block (`:80-83`): add `window.__NC_FLAGS = { appleSignin: <%= !!featureAppleSignin %> };`.
- Bundle reads `window.__NC_FLAGS?.appleSignin`. **Flag off ⇒ identical DOM/behavior to today**
  (one Google button, no Connected accounts row, no name prompt) — verify by render diff.

### 3.3 `src/reader-userdata/firebase.js` — adopt the SDK `./auth`

- `import { signIn as sdkSignIn, completeLink, linkProvider, unlinkProvider, linkedKinds, reauth, backfillProfile, setDisplayName } from '@noble-collective/userdata/auth'`.
- **`signIn(kind = 'google')`** → `sdkSignIn(_auth, kind)` and return the result to the caller (the
  UI needs `needs-link` / `popup-blocked`):
  - `signed-in` → `await backfillProfile(cred.user, result.profile)` then `bridgeSession(cred, result.profile)`.
  - `needs-link` → return it; the entry shows the link dialog (§3.4) and calls `finishLink(need)`.
  - `cancelled` → no-op. `popup-blocked` → return it (UI shows "Allow pop-ups and try again").
  - With the flag off only `'google'` is ever passed, so behavior matches today.
- **`finishLink(need)`** → `completeLink(_auth, need)`: `linked` → `bridgeSession`; `wrong-account`
  → the SDK already signed out; UI says "That was a different account — nothing was connected."
- **`bridgeSession(cred, profile)`** (`:60-78`): replace the Google-specific
  `getAdditionalUserInfo(cred).profile` block with the SDK `profile` (`profileFromCredential` handles
  Google `name`/`picture` and Apple's first-authorization name from the token response; Apple never
  has a photo). Keep: `getIdToken(true)` → `POST /api/auth/session {idToken, profile:{displayName, photoURL}}`.
  **New:** check `res.ok`; on `403 email-not-verified` (§3.6) do NOT reload-loop — stay signed in
  client-side (reader data still works) and warn. Keep the single `location.reload()` on success.
  (The "raw profile beats a null record" lesson in the old comment is preserved — the SDK prefers the
  user record then the credential profile, and `backfillProfile` writes whatever the record lacks.)
- **Name prompt support:** `export async function saveName(name)` → `setDisplayName(user, name)` →
  `getIdToken(true)` → re-POST `/api/auth/session` with the new `displayName` (server
  `createOrUpdateUser` replaces a displayName that equals the email — `firestore.js:34`) → update
  `window.__NC_USER.displayName` in place (no reload needed).
- **Connected accounts:** `export const getLinkedKinds = () => (_auth.currentUser ? linkedKinds(_auth.currentUser) : [])`;
  `export async function connect(kind)` → `linkProvider(user, kind)`; on `needs-reauth` →
  `reauth(user)` then retry once; return the status (`linked | already-linked | in-use-by-other-account | cancelled | popup-blocked`).
  `export async function disconnect(kind)` → `unlinkProvider(user, kind)` (`last-provider` is refused
  by the SDK; UI also disables the button via `canUnlink`). After either, `await user.reload()`.
  Linking/unlinking never changes `user.email`, so the server session/roles are unaffected.
- **`deleteAccount()`** (`:106-116`): replace line 112 with
  `const r = await reauth(user); if (r.status !== 'ok') throw new Error('reauth-' + r.status)`.
  ⚠ The SDK returns `{status:'cancelled'}` instead of throwing — without the explicit throw a
  cancelled reauth would fall through and **delete data with no reauth**. The current code gets its
  abort-on-cancel for free from the thrown popup error; preserve that semantics (nothing deleted on
  cancel). `reauth` picks the provider via `reauthKindFor` (Google first if both are linked).
  - Optional follow-up (not required for launch): revoke the Apple token on web delete. The SDK's
    `reauth` returns only `{status, kind}`, so capturing the Apple credential for Firebase
    `revokeAccessToken` needs a custom `reauthenticate` hook or an SDK addition. App Store rules
    require revocation in the iOS app (done there); the web can rely on Firebase account deletion.
- **Test seam** (`:37-38`): make it provider-aware and route through the SDK so the harness exercises
  the real `signIn` → `backfillProfile` → `bridgeSession` path:
  `window.__ncTestSignIn = (email='tester@example.com', sub='testuser-1', name='Test Reader', kind='google', verified=true) => signIn(kind, { authenticate: (a) => signInWithCredential(a, cred) })`
  where `cred` is `GoogleAuthProvider.credential(JSON.stringify({sub, email, email_verified: verified, name}))`
  or `new OAuthProvider('apple.com').credential({ idToken: JSON.stringify({sub, email, email_verified: verified}) })`
  (exactly the SDK test pattern). Keep the zero-arg call signature working (existing harness calls
  `window.__ncTestSignIn()`). Also expose `window.__ncTestLink(kind, email, sub)` using the SDK
  `linkProvider(user, kind, { link: (u) => linkWithCredential(u, cred) })`. Still localhost + `?ncEmu=1` only.
- Drop the now-unused `GoogleAuthProvider`/`signInWithPopup`/`reauthenticateWithPopup`/
  `getAdditionalUserInfo`/`updateProfile` imports (keep what the seam needs).

### 3.4 `src/reader-userdata-entry.js` — UI

- **`showSignInIntro` (`:94-105`):** keep title + the benefit line ("Sign in to save your bookmarks,
  highlights, and notes across devices." — identical to the app). Flag on: render
  `PROVIDER_KINDS.map(k => button(signInLabel(k)))` — **Google then Apple, equal width** (both
  full-width, same height). Styling: Google = neutral/white with the G mark; Apple = HIG black button
  with the Apple logo (white-on-black; inverted in `.nc-dark`), so neither is "primary" over the
  other. Flag off: today's single `nc-btn--primary` "Continue with Google".
  Popover width `placeMenu(anchor, 240)` may need 260 (the `.nc-signin` rule is already 260px, `styles.js:129`).
- **Link dialog (`needs-link`):** a small modal (reuse `nc-menu`/`nc-coach` styles) built from
  `linkPrompt(need.email, need.existing, need.attempted)` → title "Connect your accounts", body
  (exact SDK copy), `[Continue with <existing>]` → `finishLink(need)`, `[Cancel]`. The
  `pendingCredential` lives in memory only.
- **Name prompt:** on boot (and after sign-in) when flag on && `getUser()` && no `displayName` on the
  client user **and** `__NC_USER` (or `__NC_USER.displayName` equals the email) && localStorage
  `nc:name-prompted:<uid>` unset → show `NAME_PROMPT` (title "What should we call you?",
  placeholder "Your name", "Save") + a "Not now" link. Save → `saveName()`; either way set the
  per-uid flag (one-time, like the app's per-uid SharedPreferences flag). Wrap localStorage in try/catch.
- **Connected accounts** in `toggleAccountMenu` (flag on), between Sign out and "Manage your data"
  (or inside it): one row per `PROVIDER_KINDS` — linked → "Google — Connected" + "Remove"
  (disabled when `!canUnlink(linked, kind)`, tooltip "You need at least one way to sign in");
  not linked → "Connect Apple". Status copy: `in-use-by-other-account` → "That Apple ID is already
  used by a different Noble Collective account." (merge = admin-assisted, per §9a.4);
  `popup-blocked` → "Allow pop-ups and try again". If the user's email `isRelayEmail`, show the
  email as "Hidden (Apple relay)" under the name instead of the raw relay address.
- **Mobile header drawer** (`:283-286`): flag on → `window.loginWithGoogle = () => <open showSignInIntro anchored to the visible account button>`
  (the same path as the `nc:need-signin` handler, `:290-294`) so the drawer's "Sign In" offers both
  providers instead of jumping straight to Google. Flag off: unchanged.
- `userAvatarEl` comment "Google photo" → "provider photo" (no behavior change; Apple = initials).
- Rebuild `npm run build:reader`, bump `footer.ejs` `reader-userdata-bundle.js?v=53` → `54`
  (hard rule: `/static` is cached 1y immutable).

### 3.5 `src/reader-userdata/styles.js`

Add `.nc-btn--google` / `.nc-btn--apple` (equal size; Apple black/white per HIG, dark-mode inverse),
the link-dialog and name-prompt blocks, and the Connected-accounts rows. Light + `.nc-dark` variants.

### 3.6 Server — require a verified email for every authorization decision

Ships **unflagged** (it's a no-op for today's users, whose Google emails are all verified) and
**before** the flag is flipped. Required by §9a.7 before any email-change path exists.

- `src/server/auth.js`: add a **local** `trustedEmail(decoded)` — `email_verified === true` and a
  non-empty string email → trimmed + lower-cased, else `null` — a byte-for-byte port of the SDK's
  `core/auth-contract.ts` `trustedEmail`. **Do not `require('@noble-collective/userdata/core')`** —
  the SDK is a devDependency and `zod` isn't in the prod image (container crash on boot; the reason
  `osis.js` hardcodes its table). Export it.
- `attachUser` session-cookie branch (`:127-166`): `const email = trustedEmail(decoded)`; if `null`,
  treat as **no server session** (`req.user = null`, `res.locals.user = null`, log a one-line
  warning with the uid, clear `__session`; the client-side reader session is unaffected). Use the trusted (lower-cased)
  email for `isSuperAdmin`, the `roleflags:` cache key, `getRoleFlags`, and `req.user.email` — so
  every downstream `getUserBookRole(req.user.email, …)` (index.js, suggestion-routes.js,
  notification-routes.js, content.js) inherits the rule with no per-route change. This also removes
  the `email.toLowerCase()` throw on an email-less token.
  (Dev-cookie `__dev_auth` and `x-api-key` bot paths are unchanged — not token-based.)
- `/api/auth/session` (`index.js:438-470`): verify first, then
  `if (!auth.trustedEmail(decoded)) return res.status(403).json({ error: 'email-not-verified' })`
  **before** minting the cookie or calling `createOrUpdateUser`; pass the trusted email to
  `createOrUpdateUser`. Update the comment "Prefer the client-sent Google profile" → provider-agnostic.
  The existing bounded-string `profile` validation already covers Apple (name, no photo).
- `tests/unit/auth.test.js` (**write failing tests first**, per the TDD rule): `trustedEmail` truth
  table (verified / `email_verified:false` / `'true'` string / missing email / whitespace+case), and
  a parity test that requires the SDK's `trustedEmail` from `@noble-collective/userdata/core`
  (available in CI's dev install, like `osis.test.js`) and asserts identical results on a shared
  table. Factor the cookie→user mapping into a pure exported helper (e.g. `userFromDecoded(decoded, flags)`)
  so the unverified-email → no-session rule is unit-testable without Firebase.
- **Pre-deploy audit (read-only):** list 463519 Auth users and confirm every account that can hold a
  role (steve@ + every email in the website `users` collection with a `globalRole`/`bookRoles`) has
  `emailVerified: true`. Also confirm on a real Apple sign-in (local, step 5.1) that the decoded
  token's `email_verified` is boolean `true` for both a real-email and a Hide-My-Email Apple ID —
  if Apple tokens came through unverified, the hardening would lock every Apple user out of the
  server session (reader data would still work client-side).

### 3.7 Relay emails & email-keyed roles (no code beyond §3.6; document + UI copy)

- A Hide-My-Email user's primary email is `…@privaterelay.appleid.com`. It is real, unique and
  verified: `createOrUpdateUser` creates a website `users` doc keyed on it (visible in the admin
  console Users list), mention/notification emails reach it (relay domain registered), and roles
  granted to that exact address would work — but nobody will know it, so the admin paths are:
  1. **Link (normal):** admin signs in with Google → Connected accounts → Connect Apple. Primary
     email stays the Google one → same roles whichever button is used (proven in prod by
     `lundys@gmail.com`).
  2. **Apple ID with the admin's real email:** first Apple sign-in auto-links (verified) or creates
     an account whose primary email already matches → roles apply.
  3. **Apple-only Hide-My-Email admin:** "Use a different email for this account" →
     `requestEmailChange` (`verifyBeforeUpdateEmail`); the primary email only changes after the
     link is clicked, so `trustedEmail` never sees an unverified address. **Deferred** (not in the
     first flag flip): needs the Firebase verification-email template/sender customized first
     (defaults to the firebaseapp.com sender), and §3.6 must already be live. Admin-assisted until then.
- Stray account edge case (someone signed in with Apple before linking): Connect Apple returns
  `in-use-by-other-account` → explain; merge is admin-assisted (no admin has this today).
- The admin console shows relay addresses as-is; optionally badge them with `isRelayEmail` later.

## 4. Test harness (`test-harness/`, gitignored — local only)

- `run.sh`: add a unified mode — start the site with `FEATURE_USER_DATA=1 AUTH_UNIFIED=1
  FEATURE_APPLE_SIGNIN=1 FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099` so `bridgeSession` →
  `/api/auth/session` → `__session` → `attachUser` → `__NC_USER` runs end-to-end against the Auth
  emulator. **Verify first:** the named `auth463519` admin app (`serviceAccountId` impersonation)
  honors `FIREBASE_AUTH_EMULATOR_HOST` for `verifyIdToken`/`createSessionCookie`/`verifySessionCookie`,
  and the project-id mismatch (emulator started `--project demo-nc`, client/admin use
  `noble-imprint-463519`) doesn't fail `aud` checks — start the emulator with
  `--project noble-imprint-463519` in this mode if it does. Keep the existing non-unified run too.
- `reader-test.mjs` new steps (existing zero-arg `__ncTestSignIn()` steps unchanged):
  1. Flag on: sign-in popover shows exactly two equal-width buttons, Google first; flag off: one.
  2. `__ncTestSignIn('apple-new@example.com','a-1',undefined,'apple')` → signed in, name prompt
     appears once, save → account menu shows the name; reload → no prompt.
  3. Apple sign-in writes a highlight → data lands under the same uid path as Google flows.
  4. Google `jane@` then verified Apple `jane@` → **same uid**, Connected accounts shows both.
  5. Unverified Apple `jane@` → link dialog with the exact `linkPrompt` copy → complete → one uid;
     wrong-account path → nothing linked, signed out.
  6. Connected accounts: Remove disabled with one provider; with two, Remove works and leaves one.
  7. Relay address `x@privaterelay.appleid.com` → signs in; email shown as hidden.
  8. Unified mode: `email_verified:false` token → `/api/auth/session` 403, no `__session`, no
     reload loop, reader still works client-side.
  9. Delete account with a stubbed reauth: cancelled → **nothing deleted**; ok → data erased + user gone.
- The live Apple popup and `reauthenticateWithPopup` can't run in the emulator — covered manually (§5).

## 5. Verification matrix (site slice of the ecosystem §8)

| # | Case | Where |
|---|---|---|
| 1 | Flag off: rendered HTML + bundle behavior identical to today (single Google button, no new rows) | local render diff + harness |
| 2 | New Apple user on web → account created, highlight/answer saved under `users/{uid}` | local (real Apple ID) + harness |
| 3 | **Existing iPhone Apple user signs in on web with Apple → SAME uid, sees app data** (the key proof; team Apple ID with app data) | local (real) |
| 4 | Google account + same verified email via Apple → auto-link, one uid, both buttons work | harness + local |
| 5 | Unverified same-email → link dialog → one uid | harness |
| 6 | Hide My Email user signs in; "Connect Google" from Connected accounts works | local (real) |
| 7 | Unlink allowed with two providers, refused for the last | harness |
| 8 | Delete account reauth: Google-only, Apple-only, linked; cancel = nothing deleted | local (real popups) + harness |
| 9 | Admin (steve@) signs in with Google → Connect Apple → sign out → sign in with **Apple** → admin shield + `/admin` 200 | local unified, then prod after flip |
| 10 | `email_verified:false` → no server session / no roles; Apple tokens verified `true` | unit + harness + real token check |
| 11 | Name prompt: shown once for nameless accounts; saved name reaches `__NC_USER` + website `users` doc | harness + local |
| 12 | Mobile header drawer "Sign In" → two-button popover (flag on) | local phone width |
| 13 | Regression: `npm run test:unit`, reader harness (both modes), Playwright editor suite (`__dev_auth`, unaffected) | local |

## 6. Rollout

1. **Hardening PR (§3.6), unflagged:** failing tests → fix → unit green → read-only emailVerified
   audit → Steve go-ahead → push (push to `main` deploys).
2. **SDK re-vendor + flagged UI (§3.1-3.5):** local harness (both modes) + real Apple/Google popups
   on `localhost:8080` with `AUTH_UNIFIED=1 FEATURE_APPLE_SIGNIN=1` (real 463519, a team Apple ID).
3. **Deploy dark:** Steve go-ahead → push with the flag unset (prod `--update-env-vars` in
   `deploy.yml:105` sets only `FEATURE_USER_DATA=1,AUTH_UNIFIED=1`) → verify flag-off prod is unchanged.
4. **Flip:** `gcloud run services update <service> --region <region> --update-env-vars FEATURE_APPLE_SIGNIN=1` (service/region as in `deploy.yml`)
   (new revision, no rebuild) → run matrix rows 2/3/6/9 on prod → then make it durable by adding
   `FEATURE_APPLE_SIGNIN=1` to `deploy.yml`'s `--update-env-vars` in the next change (otherwise it
   persists anyway, since `--update-env-vars` merges, but the workflow should document it).
5. Update CLAUDE.md "Authentication" + this plan's status; tell Coram Deo/Institute (steps 3-4 of the
   ecosystem plan) the site is live.

## 7. Rollback

- **UI:** `--update-env-vars FEATURE_APPLE_SIGNIN=0` → Google-only UI again within one revision.
  Accounts created meanwhile stay valid: Apple-only users can't sign in on the web until re-enabled
  (their data is untouched and still syncs with the app); linked users keep signing in with Google.
- **Code:** shift traffic to the prior Cloud Run revision or redeploy a prior `:<sha>` (README runbook).
- **Hardening** is independent; if it ever wrongly rejects a real user, revert that commit alone —
  but first check the user's `emailVerified` (that would be the real bug).
- No data migration to undo; rules unchanged.

## 8. Estimate

~0.5 day build + ~0.5 day harness/verification (ecosystem plan §10), plus Steve's time for the real
Apple ID checks (rows 3, 6, 8, 9).

## 9. LATER (not part of this plan's flag flip)

- **Device-local "Sync settings across devices" switch** (the app shipped it): default on; stored
  **only on the device** (localStorage), never in the shared settings doc; off = this browser neither
  reads nor writes shared settings (`onSettingsRaw` subscription + writes skipped, local cache only);
  annotations always sync. Re-enabling asks "Use this device's settings everywhere" vs "Use synced
  settings here". Lives in the gear menu (`settings.js`). Not required for Apple (Steve, 2026-09-23).
- **Appearance naming parity:** the site's gear menu already labels it **"Appearance"** with
  Light / Dark / Auto (`settings.js:143`, values `light|dark|system` = the SDK `THEMES`), which is
  exactly what the app now ships and syncs as the shared `theme`. No change needed beyond keeping
  the labels identical if either side renames; verify cross-device theme sync app↔web once the app
  build is on devices. (Verse Layout — `settings.js:154` — likewise now also drives the app's Bible reader.)
- Web Apple token revocation on delete (§3.3), admin-console relay badge (§3.7), and the verified
  email-change UI (§3.7 path 3).
