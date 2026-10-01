# Safari / WebKit audit — resources site (2026-10-01)

Steve: "all three web apps work in Chrome but Safari has issues." This is the resources-site pass.
Local commits only (**not pushed / not deployed** — needs Steve's OK): `e1de083`, `391d04d`.

## How it was tested

- **Prod crawl** (read-only GETs, signed out): home, book, a session with audio, a classic, a
  liturgy, Bible index ×2, Genesis 1, Proverbs 1 (audio), `/notes`, a 404. Ran in Chromium desktop,
  WebKit desktop, Chromium Pixel 7 and WebKit iPhone 15 (Playwright 1.59, WebKit 26.4). Captured
  console errors, page errors, failed requests, 4xx/5xx, screenshots.
  **Result: no difference.** Zero page errors and zero failed requests in any engine. The only
  4xx was the intended 404. Reader booted everywhere, no horizontal overflow at phone width, the
  same heading icons and scrubber markers in both engines.
- **Audio in WebKit** (MP3 plays in Playwright WebKit on Windows): play, highlight, seek, resume
  from a saved position, the Bible in-place auto-advance (Proverbs 1→2), the session AJAX
  auto-advance (Call of Christ S1→S2), and both auto-advances with `play()` forced to reject
  (iOS NotAllowedError). Everything worked in WebKit the same as in Chromium, including the
  "Tap to continue" banner with the next session's highlight data already loaded.
- **UI in WebKit**: selection toolbar (signed out), dark + XL settings, the gear menu, the
  speed select, the header.
- **Static audit** of `src/public/js/*`, `src/reader-userdata/*`, `style.css` and the views for
  the usual Safari hazards (see the checklist at the end).

**What Playwright WebKit can't show** (it is not iOS): focus auto-zoom, the lock screen /
Control Center, iOS's autoplay gesture window, background suspension, bfcache (Playwright turns
it off), UIKit tap "clickability", the native selection callout, and hyphenation (Windows WebKit
has no hyphenation dictionaries, so justified text looks gappy there but not on real Safari). For
these I tested the conditions that cause the bug, e.g. computed font sizes.

## The parked "iOS auto-advance highlight" bug

**The parked bug is fixed and live.** In `086bff7` (2026-09-27), `playNextChapter` loads the next
session's timestamps *before* `play()`. Prod's `audio-player.js?v=31` is byte-identical to the
repo. Tested in WebKit with `play()` rejecting: after an auto-advance the banner shows, and the
new session already has its alignment (333 segments), heading icons (24) and scrubber markers.
`tests/audio-autoplay-blocked.spec.js` covers it.

**The real cause of the iOS stall is still open (PROPOSED, not fixed).** Why does iOS reject the
auto-advance `play()` in the first place, given that we reuse the same `<audio>` element?

- WebKit allows a new `play()` with no tap only for **about 1 s after gesture-started media ends**
  (`Document::processingUserGestureForMedia` → `maxIntervalForUserGestureForwardingAfterMediaFinishesPlaying`).
  That window is what makes playlists work.
- Our `ended` handler does **2–3 network round-trips in series** before it calls `play()`:
  - Sessions: `/api/session-data/…` → DOM swap → `/api/audio/url/…`.
  - Bible: fetch the chapter HTML → swap → `/api/audio/url/…`.
  - The timestamps fetch chain now runs alongside these.
- I timed `ended` → `play()` on prod from a fast desktop connection: **600–840 ms** (6 runs, both
  paths). On a phone on cellular, or when Cloud Run starts cold, this easily goes over 1 s. That
  gives NotAllowedError and the banner. It happens sometimes and depends on the network, which
  fits "misbehaves on iOS".
- With the phone locked it's worse: once nothing is playing, iOS can suspend the page mid-fetch,
  so listening stops until the phone is unlocked.

Options:

- **A (recommended): prefetch, then swap the source inside `ended` with no waiting.**
  - About 30 s before the end, fetch the next unit's data (session-data JSON or chapter HTML) and
    its signed audio URL. Signed URLs last for `SIGNED_URL_EXPIRY`, so this is safe.
  - In `ended`, do `audioEl.src = nextSignedUrl; audioEl.play()` at once, then do the DOM swap and
    timestamps from the prefetched data. If the prefetch is missing, fall back to today's path.
  - Touches `audio-player.js` (`ended`, `playNextChapter`) and `ajax-nav.js` (`navigateToSession`
    takes prefetched data and skips its fetch).
  - Testable: assert `play()` is called within one task of `ended`, with fetches stubbed slow.
- **B: just shorten the chain.** Fetch the session data and the audio URL in parallel, and call
  `play()` before the DOM swap. Smaller change, but still waits on one network round-trip.
- **C: add Media Session handlers (below).** Then the lock-screen ⏭ / ▶ is a real gesture that
  can recover a stalled advance without unlocking. Complements A; doesn't replace it.

## Bugs

| # | Bug | Severity | Status |
|---|-----|----------|--------|
| 1 | Player button doesn't follow lock-screen / Control Center / AirPods / call pause & play | Medium (iOS) | **Fixed** `e1de083` |
| 2 | iOS zooms the page when you tap the answer box, note box, notebook search or speed select | Medium (iOS) | **Fixed** `e1de083` |
| 3 | Speed select unreadable in Safari (light gray on a white native chip) | Low–Med | **Fixed** `e1de083` |
| 4 | No header blur on Safari < 18 (only unprefixed `backdrop-filter`) | Low (iOS ≤ 17) | **Fixed** `e1de083` |
| 5 | Cancelling the iOS share sheet shows "Couldn't copy link" | Low | **Fixed** `e1de083` |
| 6 | 5-day server session lapses while the client sign-in persists → Edit/Admin vanish | Medium (editors, all browsers) | **Fixed** `e1de083` (no automated test) |
| 7 | Blocked storage (Safari "Block All Cookies") kills the entire audio player | Low (rare setting) | **Fixed** `391d04d` |
| 8 | Auto-advance `play()` lands outside iOS's ~1 s window | **High (iOS)** | Proposed (above) |
| 9 | No Media Session API (lock screen: no artwork, no ⏭/⏮/±15 s) | Medium (iOS) | Proposed |
| 10 | Outside-tap dismiss uses `mousedown`/`click` on `document` | Low–Med (iOS) | Proposed |
| 11 | Selection toolbar sits where iOS draws its own callout | Low (iOS) | Proposed |
| 12 | bfcache restore (Safari uses it heavily) | Low | Partly covered by #1; proposed |

### 1. Player button out of sync with the element — FIXED
- **Symptom:** you pause from the lock screen, Control Center or AirPods, or a call interrupts.
  Back in the page, the bar still shows ❚❚. After a lock-screen resume it shows ▶ while playing,
  so the first tap does the opposite of what the icon says.
- **Evidence:** in both engines, `audioEl.pause()` from outside our button left the pause icon
  showing. `tests/safari` "player button follows play/pause…" failed before the fix and passes
  after.
- **Root cause:** icons changed only in `togglePlay` and the banner. No `pause`/`play` listeners.
- **Fix:** the element's `pause` → `showPaused()` (skipped during the A–B loop's 1 s beat), and
  `play` → `showPlaying()`.

### 2. iOS focus zoom — FIXED
- **Symptom:** tapping an answer box on a phone zooms the page in, and it stays zoomed after you
  finish typing. Same for the note box, the notebook search and the 1x speed select.
- **Root cause:** iOS zooms into any focused control under 16px. Sizes were `.nc-answer__ta`
  15.2px (.95rem), note textarea and `.nc-search` 13.6px, `.audio-speed` 12–13px.
- **Fix:** under `@media (hover:none) and (pointer:coarse)` these are 16px (`styles.js`,
  `style.css`). Desktop is unchanged. The test asserts ≥ 16px on touch projects.

### 3. Speed select unreadable in Safari — FIXED
- **Symptom:** in WebKit the speed select renders white with light-gray "1x" text, so you can
  barely read it. Screenshots taken before and after.
- **Root cause:** Safari draws `<select>` natively and ignores `background: #333`, but it keeps
  `color: #d4d4d4`.
- **Fix:** `color-scheme: dark` on `.audio-speed`, which makes the native control dark. It is
  still a native control (no appearance reset), so Chrome is unaffected.

### 4. `-webkit-backdrop-filter` — FIXED
- **Symptom:** the 75%-opaque sticky header has no blur on Safari 17 and older. Page text reads
  sharply through it.
- **Root cause:** unprefixed `backdrop-filter` only arrived in Safari 18.
- **Fix:** the prefixed declaration on the header and the two editor overlays. The unit test
  `tests/unit/css-webkit-prefixes.test.js` stops any regression.

### 5. Share-sheet cancel → "Couldn't copy link" — FIXED
- **Root cause:** `shareUrl` treated *any* `navigator.share` rejection as "unsupported" and fell
  back to `clipboard.writeText`. Cancelling raises `AbortError`. On Safari the copy also fails,
  because it runs after the share sheet, outside the tap.
- **Fix:** on `AbortError`, return.

### 6. Server session lapse (the Institute pattern) — FIXED
- **Symptom:** an editor or admin comes back after more than 5 days. The avatar still shows them
  signed in (the Firebase client user is restored from storage). But the page rendered signed
  out on the server (`__NC_USER` null), so there's no Edit toolbar, no Admin, no Notifications.
  Nothing re-minted the cookie short of signing out and back in.
- **Evidence:** `auth.SESSION_EXPIRES_IN` = 5 days. The cookie was only minted in `bridgeSession`,
  after the popup. Readers are unaffected: the reader layer needs only the client.
- **Fix:** `firebase.js` `healServerSession`. On the first auth callback (the sign-in restored
  from storage), if `__NC_UNIFIED` is set, a user exists and `__NC_USER` is null, POST a fresh ID
  token to `/api/auth/session`. Once per tab (sessionStorage guard). **No reload**, so the editor
  UI is back from the next page.
- **Option:** reload once after healing, so it is back on the current page too. That costs a flash
  for every reader once every 5 days. Better: have `/api/auth/session` return the role flags and
  reload only for editors and admins.
- **Not tested automatically** (it needs the emulator harness in unified mode). Worth a manual
  check: delete `__session` in devtools, reload, and `__session` should come back.
- The Institute's other Safari fix (`initializeAuth` with an explicit persistence chain) **is not
  needed here**. In Firebase v11, `getAuth` already uses `[indexedDB, browserLocal,
  browserSession]` + `browserPopupRedirectResolver`, and falls back to in-memory itself. Reading
  never waits on auth, so a slow IndexedDB can't spin the page.

### 7. Blocked storage kills the audio player — FIXED
- `audio-player.js` read `localStorage` unguarded at the top level (the autoplay hand-off). When
  storage throws `SecurityError`, `window.__audioPlayer` was never defined and there was no audio.
- **Fix:** every access goes through a guarded `store` helper. A test fakes a throwing
  `localStorage`. `analytics.js`, `main.js` and the reader bundle were already guarded.

### 9. Media Session API — PROPOSED
- There are no `navigator.mediaSession` calls today. On the iOS lock screen you see the page title
  and default controls only.
- **Proposal:**
  - `metadata` = session or chapter title + book title + cover (`/cover/…`).
  - `seekbackward` / `seekforward` = ±15 s; `nexttrack` = `fab.dataset.nextUrl` advance;
    `play` / `pause`.
  - Update `setPositionState` on `timeupdate`.
  - This also gives a gesture path to recover a stalled advance (#8, option C).

### 10. Outside-tap dismiss on iOS — PROPOSED
- These menus close via `document` `mousedown`:
  - Settings (`settings.js:160`), account (`reader-userdata-entry.js:89`), share (`annotations.js:386`)
    and the highlight edit toolbar (`annotations.js:442`).
  - `main.js`'s popups use `document` `click`.
- iOS only fires mouse events for taps on "clickable" elements. Taps on plain margins, the header
  background or empty page areas outside `.session-content` (which has a click listener) don't
  reach `document`, so the menu stays open.
- **Proposal:** use `pointerdown`, which fires for touch whatever the target.
  - Trade-off: a scroll that starts outside the menu also closes it. Probably fine.
  - Needs a check on a real iPhone; Playwright can't show this.

### 11. Selection toolbar vs the iOS callout — PROPOSED (design)
- `positionToolbar` puts our toolbar 8px above the selection. That is exactly where iOS draws its
  Copy / Look Up callout, so the two overlap.
- **Options:** below the selection on `(pointer:coarse)` (Coram Deo / Kindle style), or a docked
  bottom toolbar on phones.

### 12. bfcache — PROPOSED
- Safari restores pages from bfcache with JS state intact and media paused. Fix #1 corrects the
  icon if WebKit fires `pause` on suspend; I couldn't check this (Playwright disables bfcache).
- **Proposal:** a `pageshow` (`persisted`) handler that calls `showPaused()` when
  `audioEl.paused`, and re-checks the sign-in state. Verify on a device.

## Other notes (no action)

- `deleteAccount` calls `reauthenticateWithPopup` after two `window.confirm()`s. Still inside the
  click, so it should pass Safari's popup blocker. Worth one manual try on iOS before relying on it.
- `:has()` (Safari 15.4+), `ResizeObserver`, `crypto.randomUUID` (guarded), `scrollIntoView`
  options and `navigator.share` / `clipboard` are all fine on current Safari. No regex lookbehind,
  `structuredClone`, `.at()` / `findLast`, `requestIdleCallback`, `dvh` or date-string parsing in
  reader code.
- `100vh` is used only by the desktop sidebar (hidden ≤ 989px), so the iOS URL-bar issue doesn't
  apply.
- `hyphens` already has `-webkit-hyphens`, and `<html lang="en">` is set.

## Ongoing Safari testing

- `npx playwright test -c playwright.safari.config.js`
  - Runs WebKit iPhone + WebKit desktop + a Chromium Android baseline against public pages.
  - The working-tree `audio-player.js`, `reader-userdata-bundle.js` and `style.css` are routed
    in place of the deployed ones, so it tests local code with no server or GitHub calls.
  - Pass `SAFARI_BASE_URL=http://localhost:8080` to point it at a local server.
  - Excluded from the main suite.
- Suggested additions:
  - Run it in CI after deploy (smoke) or on PRs that touch `src/public` or `src/reader-userdata`.
  - Add a test per fix as these land.
  - A short real-device checklist per release on an iPhone: lock-screen auto-advance across a
    session boundary on cellular; Control Center pause → icon; answer-box tap → no zoom;
    share-sheet cancel; outside-tap dismiss.
  - For real iOS automation, options are BrowserStack/Sauce Labs real-device Safari, or the
    Simulator + `safaridriver` on a Mac.
