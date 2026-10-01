/**
 * Safari / WebKit regressions (2026-10-01 audit — plans/2026-10-01-safari-audit.md).
 * Run: npx playwright test -c playwright.safari.config.js
 *
 * Public pages only, read-only. The working-tree client assets are routed in place of the deployed
 * ones, so these test LOCAL code against the live HTML (or SAFARI_BASE_URL's).
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
  // Skip the first-visit onboarding coach (it overlays the header controls).
  await page.addInitScript(() => { try { localStorage.setItem('nc_onboarded_v1', '1'); } catch { /* ignore */ } });
});

// iOS pauses/resumes the element from outside the page (lock screen, Control Center, AirPods out,
// a phone call). The in-page play/pause button must follow the element, not just our own taps.
test('player button follows play/pause made outside the page', async ({ page }) => {
  await page.goto(SESSION);
  await page.locator('#audio-fab').click();
  await expect.poll(() => page.evaluate(() => !!window.__audioPlayer.isPlaying()), { timeout: 20000 }).toBe(true);
  const pauseIcon = page.locator('#audio-play-btn .icon-pause');
  const playIcon = page.locator('#audio-play-btn .icon-play');
  await expect(pauseIcon).toBeVisible();

  await page.evaluate(() => window.__audioPlayer.getAudioElement().pause()); // lock-screen pause
  await expect(playIcon).toBeVisible();
  await expect(pauseIcon).toBeHidden();

  await page.evaluate(() => window.__audioPlayer.getAudioElement().play()); // lock-screen play
  await expect(pauseIcon).toBeVisible();
  await expect(playIcon).toBeHidden();
});

// iOS Safari zooms the page when a focused text field / select has font-size < 16px, and leaves it
// zoomed after blur. Every reader form control must be >= 16px on touch devices.
test('reader form controls are >= 16px on touch screens (no iOS focus zoom)', async ({ page }, testInfo) => {
  await page.goto(SESSION);
  await expect.poll(() => page.evaluate(() => !!window.__ncBooted)).toBe(true);
  const sizes = await page.evaluate(() => {
    // The answer box, note box and notebook search are built on demand; build bare copies so the
    // injected reader stylesheet applies to them.
    const host = document.createElement('div');
    host.innerHTML = '<textarea class="nc-answer__ta"></textarea>'
      + '<div class="nc-note-pop"><textarea></textarea></div>'
      + '<input class="nc-search" type="search">';
    document.body.appendChild(host);
    const px = (el) => parseFloat(getComputedStyle(el).fontSize);
    return {
      answer: px(host.querySelector('.nc-answer__ta')),
      note: px(host.querySelector('.nc-note-pop textarea')),
      search: px(host.querySelector('.nc-search')),
      speed: px(document.getElementById('audio-speed')),
      touch: matchMedia('(hover: none) and (pointer: coarse)').matches,
    };
  });
  test.skip(!sizes.touch, `not a touch device (${testInfo.project.name})`);
  for (const k of ['answer', 'note', 'search', 'speed']) expect(sizes[k], k).toBeGreaterThanOrEqual(16);
});

// With storage blocked (Safari "Block All Cookies", some embedded/private contexts) every
// localStorage access throws SecurityError — that must not take the whole audio player down.
test('audio player works when localStorage throws', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', { configurable: true, get() { throw new DOMException('blocked', 'SecurityError'); } });
  });
  await page.goto(SESSION);
  expect(await page.evaluate(() => typeof window.__audioPlayer)).toBe('object');
  await page.locator('#audio-fab').click();
  await expect.poll(() => page.evaluate(() => !!window.__audioPlayer.isPlaying()), { timeout: 20000 }).toBe(true);
  await page.waitForTimeout(1500); // a few timeupdates (each saves the position)
  expect(await page.evaluate(() => window.__audioPlayer.isPlaying())).toBe(true);
});

// Safari renders <select> natively and ignores its background-color, so the player's dark speed
// chip came out white with light-gray "1x" text (unreadable). A dark color-scheme fixes the native
// control.
test('speed select renders as a dark native control', async ({ page }) => {
  await page.goto(SESSION);
  expect(await page.evaluate(() => getComputedStyle(document.getElementById('audio-speed')).colorScheme)).toContain('dark');
});

// Share… on iOS opens the native share sheet; cancelling it rejects with AbortError. That's the
// user saying "no" — we must not then try to copy (which, outside the tap, fails on Safari and
// shows "Couldn't copy link").
test('cancelling the native share sheet does not fall back to copying', async ({ page }) => {
  await page.addInitScript(() => {
    window.__copied = [];
    Object.defineProperty(navigator, 'share', { configurable: true, value: () => Promise.reject(new DOMException('cancelled', 'AbortError')) });
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: (t) => { window.__copied.push(t); return Promise.resolve(); } } });
  });
  await page.goto(SESSION);
  await expect.poll(() => page.evaluate(() => !!window.__ncBooted)).toBe(true);
  await page.evaluate(() => {
    const p = [...document.querySelectorAll('.session-content p')].find((x) => x.textContent.trim().length > 60);
    p.scrollIntoView({ block: 'center' });
    const w = document.createTreeWalker(p, NodeFilter.SHOW_TEXT);
    const t = w.nextNode();
    const r = document.createRange(); r.setStart(t, 0); r.setEnd(t, Math.min(15, t.length));
    const s = getSelection(); s.removeAllRanges(); s.addRange(r);
  });
  const share = page.locator('.nc-toolbar [aria-label="Share"]');
  await expect(share).toBeVisible();
  await share.click();
  await page.locator('.nc-share-menu__item', { hasText: 'Share…' }).click();
  await page.waitForTimeout(500);
  expect(await page.evaluate(() => window.__copied)).toEqual([]);
  await expect(page.locator('.nc-toast')).toHaveCount(0);
});
