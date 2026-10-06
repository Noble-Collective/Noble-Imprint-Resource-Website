/**
 * iOS behaviours from the 2026-10-01 Safari audit (plans/2026-10-01-safari-audit.md #9, #10, #12).
 * Run: npx playwright test -c playwright.safari.config.js ios-ux
 *
 * Playwright WebKit isn't iOS, so each test models the iOS condition that causes the bug:
 * - #10: iOS sends mouse events only for taps on "clickable" elements. A tap on a blank margin gives
 *   a pointerdown but no mousedown/click, so a menu that closes on mousedown stays open.
 * - #9: the lock screen / Control Center / AirPods drive the player through navigator.mediaSession.
 *   A recording stub stands in for it (the engine's own may be absent on Windows/Linux builds).
 * - #12: a bfcache restore brings the page back with its JS state but with media paused, and WebKit
 *   may not fire `pause`; a `pageshow` with persisted=true must resync the bar.
 */
const path = require('path');
const { test, expect } = require('@playwright/test');

const ROOT = path.join(__dirname, '..', '..', 'src', 'public');
const LOCAL_ASSETS = [
  [/\/static\/js\/audio-player\.js(\?|$)/, 'js/audio-player.js', 'application/javascript'],
  [/\/static\/js\/reader-userdata-bundle\.js(\?|$)/, 'js/reader-userdata-bundle.js', 'application/javascript'],
  [/\/static\/css\/style\.css(\?|$)/, 'css/style.css', 'text/css'],
];
const SESSION = '/narrative-journey-series/foundations/the-call-of-christ/4-session1-thegospel';

test.beforeEach(async ({ page }) => {
  for (const [re, file, contentType] of LOCAL_ASSETS) {
    await page.route(re, (route) => route.fulfill({ path: path.join(ROOT, file), contentType }));
  }
  await page.addInitScript(() => { try { localStorage.setItem('nc_onboarded_v1', '1'); } catch { /* ignore */ } });
});

// A tap on blank page space as iOS delivers it: pointer events only.
async function blankTap(page) {
  // The menus arm their outside-tap listener in a setTimeout(0) after the opening click (so that click doesn't close
  // them). A person taps much later; a test must first let that timer run (it lost the race on a busy CI runner).
  await page.evaluate(() => new Promise((r) => setTimeout(() => requestAnimationFrame(() => r()), 50)));
  await page.evaluate(() => {
    const t = document.querySelector('.reading-top') || document.body;
    for (const type of ['pointerdown', 'pointerup']) {
      t.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, composed: true, pointerType: 'touch', isPrimary: true }));
    }
  });
}

test('the reading-settings menu closes on a tap on blank space (pointerdown, no click)', async ({ page }) => {
  await page.goto(SESSION);
  await expect.poll(() => page.evaluate(() => !!window.__ncBooted)).toBe(true);
  await page.locator('[data-nc-settings-btn]:visible').first().click();
  await expect(page.locator('.nc-menu')).toBeVisible();
  await blankTap(page);
  await expect(page.locator('.nc-menu')).toHaveCount(0);
});

// Signed out, the account icon opens the shared sign-in kit (web sign-in plan P3): the sheet in place on a
// phone, the /sign-in page on desktop (signin.js startSignIn). The sheet is modal: a tap anywhere outside the
// panel lands on its scrim, which closes it on click — a real touch tap, so iOS has to deliver that click.
const SHEET = '[data-nc-signin-sheet]';
const isPhone = (page) => page.evaluate(() => matchMedia('(max-width: 989px)').matches);

async function openSheet(page) {
  await page.goto(SESSION);
  await expect.poll(() => page.evaluate(() => !!window.__ncBooted)).toBe(true);
  await page.locator('[data-nc-account-btn]:visible').first().tap();
  await expect(page.locator(SHEET + ' .ncsi-btn').first()).toBeVisible();
}

test('phone: the sign-in sheet closes on a tap on the scrim', async ({ page, hasTouch }) => {
  test.skip(!hasTouch, 'touch devices only (desktop goes to /sign-in)');
  await openSheet(page);
  expect(await isPhone(page)).toBe(true);
  // Let the sheet's open animation settle, then tap above the panel: the scrim must be what's there.
  await page.evaluate(() => new Promise((r) => setTimeout(r, 300)));
  const vw = page.viewportSize().width;
  expect(await page.evaluate(([x, y]) => !!document.elementFromPoint(x, y)?.closest('.nc-si-sheet__scrim'), [vw / 2, 30])).toBe(true);
  await page.touchscreen.tap(vw / 2, 30);
  await expect(page.locator(SHEET)).toHaveCount(0);
});

test('phone: the sign-in sheet closes on its × button', async ({ page, hasTouch }) => {
  test.skip(!hasTouch, 'touch devices only (desktop goes to /sign-in)');
  await openSheet(page);
  await page.locator(SHEET + ' .nc-si-sheet__x').tap();
  await expect(page.locator(SHEET)).toHaveCount(0);
});

test('desktop: the account icon goes to /sign-in with a returnTo back to the session', async ({ page }) => {
  await page.goto(SESSION);
  await expect.poll(() => page.evaluate(() => !!window.__ncBooted)).toBe(true);
  test.skip(await isPhone(page), 'desktop only (a phone opens the sheet)');
  await page.locator('[data-nc-account-btn]:visible').first().click();
  await page.waitForURL((u) => u.pathname === '/sign-in');
  expect(new URL(page.url()).searchParams.get('returnTo')).toBe(SESSION);
  await expect(page.locator(SHEET)).toHaveCount(0);
});

async function stubMediaSession(page) {
  await page.addInitScript(() => {
    const handlers = {};
    const session = {
      metadata: null,
      playbackState: 'none',
      position: null,
      handlers,
      setActionHandler(action, fn) { if (fn) handlers[action] = fn; else delete handlers[action]; },
      setPositionState(s) { session.position = s; },
    };
    Object.defineProperty(navigator, 'mediaSession', { configurable: true, get: () => session });
    window.MediaMetadata = class { constructor(m) { Object.assign(this, m); } };
  });
}

async function startPlaying(page) {
  await page.goto(SESSION);
  await page.locator('#audio-fab').click();
  await expect.poll(() => page.evaluate(() => {
    const a = window.__audioPlayer.getAudioElement();
    return !!a && !a.paused && isFinite(a.duration) && a.currentTime > 0.3;
  }), { timeout: 30000 }).toBe(true);
}

test('Media Session: lock-screen title, artwork, play/pause, ±15 s, seek and next', async ({ page }) => {
  await stubMediaSession(page);
  await startPlaying(page);
  const ms = () => page.evaluate(() => {
    const s = navigator.mediaSession;
    return { title: s.metadata && s.metadata.title, album: s.metadata && s.metadata.album, artwork: s.metadata && s.metadata.artwork, state: s.playbackState, actions: Object.keys(s.handlers).sort(), position: s.position };
  });
  const h1 = (await page.locator('.session-content h1').first().innerText()).trim();
  await expect.poll(async () => (await ms()).title).toBe(h1);
  const s = await ms();
  expect(s.album).toBe('The Call of Christ');
  expect(s.artwork).toEqual([]); // its cover is an SVG, which iOS can't draw on the lock screen
  expect(s.state).toBe('playing');
  expect(s.actions).toEqual(expect.arrayContaining(['nexttrack', 'pause', 'play', 'seekbackward', 'seekforward', 'seekto']));
  await expect.poll(async () => (await ms()).position && (await ms()).position.duration > 0).toBe(true);

  // ±15 s and seekto drive the element. (WebKit can report a transient currentTime while a seek on a
  // streamed MP3 settles, so each check polls.)
  const now = () => page.evaluate(() => window.__audioPlayer.getAudioElement().currentTime);
  const t0 = await now();
  await page.evaluate(() => navigator.mediaSession.handlers.seekforward({ action: 'seekforward' }));
  await expect.poll(now).toBeGreaterThan(t0 + 14);
  await page.evaluate(() => navigator.mediaSession.handlers.seekto({ action: 'seekto', seekTime: 5 }));
  await expect.poll(async () => Math.abs((await now()) - 5) < 1.5).toBe(true);
  await page.evaluate(() => navigator.mediaSession.handlers.seekbackward({ action: 'seekbackward' }));
  await expect.poll(now).toBeLessThan(1.5);

  // Pause and play from the lock screen; the bar and the session state follow.
  await page.evaluate(() => navigator.mediaSession.handlers.pause({ action: 'pause' }));
  await expect(page.locator('#audio-play-btn .icon-play')).toBeVisible();
  await expect.poll(async () => (await ms()).state).toBe('paused');
  await page.evaluate(() => navigator.mediaSession.handlers.play({ action: 'play' }));
  await expect(page.locator('#audio-play-btn .icon-pause')).toBeVisible();
  await expect.poll(async () => (await ms()).state).toBe('playing');

  // Next track = the auto-advance to the next session.
  const before = page.url();
  await page.evaluate(() => navigator.mediaSession.handlers.nexttrack({ action: 'nexttrack' }));
  await expect.poll(() => page.url(), { timeout: 30000 }).not.toBe(before);
  const h1Next = page.locator('.session-content h1').first();
  await expect.poll(async () => (await ms()).title, { timeout: 30000 }).toBe((await h1Next.innerText()).trim());
});

test('bfcache restore (pageshow persisted) resyncs the player bar to the element', async ({ page }) => {
  await startPlaying(page);
  // Back from bfcache: Safari paused the media without a `pause` event, so the bar still says ❚❚.
  await page.evaluate(() => {
    const a = window.__audioPlayer.getAudioElement();
    a.pause();
  });
  await page.evaluate(() => {
    document.querySelector('#audio-play-btn .icon-play').style.display = 'none';
    document.querySelector('#audio-play-btn .icon-pause').style.display = '';
    window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
  });
  await expect(page.locator('#audio-play-btn .icon-play')).toBeVisible();
  await expect(page.locator('#audio-play-btn .icon-pause')).toBeHidden();
});
