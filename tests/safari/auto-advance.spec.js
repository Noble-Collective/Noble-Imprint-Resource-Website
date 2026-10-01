/**
 * iOS auto-advance (plans/2026-10-01-safari-audit.md #8). WebKit on iOS lets an un-tapped play() start
 * only within ~1 s of the previous gesture-started track ending. The `ended` handler used to make 2–3
 * network round-trips before play(), which on cellular overran that window ("Tap to continue
 * listening", or silence with the phone locked). The player now prefetches the next unit ~30 s before
 * the end, so `ended` can start it at once.
 *
 * Models iOS: play() rejects (NotAllowedError) when called more than 1 s after the last `ended`, and
 * the API calls a fetch-in-`ended` path would need are slowed to 1.5 s, like a slow phone connection.
 * Run: npx playwright test -c playwright.safari.config.js auto-advance
 */
const path = require('path');
const { test, expect } = require('@playwright/test');

const ROOT = path.join(__dirname, '..', '..', 'src', 'public');
const LOCAL_ASSETS = [
  [/\/static\/js\/audio-player\.js(\?|$)/, 'js/audio-player.js'],
  [/\/static\/js\/ajax-nav\.js(\?|$)/, 'js/ajax-nav.js'],
];

async function setup(page, slowRe) {
  for (const [re, file] of LOCAL_ASSETS) {
    await page.route(re, (route) => route.fulfill({ path: path.join(ROOT, file), contentType: 'application/javascript' }));
  }
  await page.route(slowRe, async (route) => {
    await new Promise((r) => setTimeout(r, 1500));
    await route.continue();
  });
  await page.addInitScript(() => {
    try { localStorage.setItem('nc_onboarded_v1', '1'); } catch { /* ignore */ }
    // The player's <audio> isn't in the document, so `ended` is caught on the element: its own
    // listeners note the time first, before the player's handler runs.
    let lastEnded = -Infinity;
    const realAdd = EventTarget.prototype.addEventListener;
    EventTarget.prototype.addEventListener = function (type, fn, opts) {
      if (type === 'ended' && this instanceof HTMLMediaElement && typeof fn === 'function') {
        const inner = fn;
        fn = function (e) { lastEnded = performance.now(); return inner.call(this, e); };
      }
      return realAdd.call(this, type, fn, opts);
    };
    const realPlay = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function () {
      if (performance.now() - lastEnded > 1000 && lastEnded > 0) {
        window.__lateGap = Math.round(performance.now() - lastEnded);
        return Promise.reject(new DOMException('un-gestured play', 'NotAllowedError'));
      }
      return realPlay.call(this);
    };
  });
}

async function playToTheEnd(page) {
  await page.locator('#audio-fab').click();
  // Playing, with a known duration (seeking to `duration - 8` before then sets NaN).
  await expect.poll(() => page.evaluate(() => {
    const a = window.__audioPlayer.getAudioElement();
    return !!a && !a.paused && isFinite(a.duration) && a.currentTime > 0.5;
  }), { timeout: 30000 }).toBe(true);
  // Into the last 30 s, one seek (a second seek this close to the end can leave WebKit's element
  // without a time): the prefetch starts on the next timeupdate and its two slow calls (~3 s) finish
  // before the end, ~8 s later.
  await page.evaluate(() => { const a = window.__audioPlayer.getAudioElement(); a.currentTime = a.duration - 8; });
}

test('a session auto-advance starts the next session inside iOS\'s 1 s window', async ({ page }) => {
  const BOOK = '/narrative-journey-series/foundations/the-call-of-christ';
  await setup(page, /\/api\/(session-data|audio\/url)\//);
  await page.goto(BOOK + '/4-session1-thegospel');
  await playToTheEnd(page);

  await page.waitForURL(new RegExp(BOOK + '/5-session2-thewater'), { timeout: 20000 });
  await expect.poll(() => page.evaluate(() => window.__audioPlayer.isPlaying()), { timeout: 10000 }).toBe(true);
  await expect(page.locator('#audio-tap-banner')).toHaveCount(0);
  expect(await page.evaluate(() => window.__lateGap ?? null)).toBeNull();
});

test('a Bible chapter auto-advance starts the next chapter inside iOS\'s 1 s window', async ({ page }) => {
  await setup(page, /(\/api\/audio\/url\/|\/bible\/bsb\/Proverbs\?chapter=2)/);
  await page.goto('/bible/bsb/Proverbs?chapter=1');
  await playToTheEnd(page);

  await page.waitForURL(/chapter=2/, { timeout: 20000 });
  await expect.poll(() => page.evaluate(() => window.__audioPlayer.isPlaying()), { timeout: 10000 }).toBe(true);
  await expect(page.locator('#audio-tap-banner')).toHaveCount(0);
  expect(await page.evaluate(() => window.__lateGap ?? null)).toBeNull();
});
