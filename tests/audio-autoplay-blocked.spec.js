/**
 * Audio auto-advance when the browser blocks autoplay (iOS Safari).
 *
 * When a session's audio ends, the player AJAX-swaps in the next session and calls play() without a
 * user gesture; iOS rejects that with NotAllowedError and the player shows "Tap to continue
 * listening". The next session's timestamps must load regardless — before 2026-09-27 they only loaded
 * after a successful play(), so after the tap that session had no text highlight, no heading
 * headphone icons and no scrubber heading markers.
 *
 * Needs real audio: run the local server with AUDIO_DEV_SOURCE=https://resources.noblecollective.org
 * (see src/server/audio.js) unless its service account can read the audio bucket.
 */
const { test, expect } = require('./fixtures');

const BASE_URL = 'http://localhost:8080';
const BOOK = '/narrative-journey-series/foundations/the-call-of-christ';
const FROM = BOOK + '/4-session1-thegospel';
const NEXT = BOOK + '/5-session2-thewater';

test('blocked autoplay on auto-advance still loads the next session\'s highlight data', async ({ page }) => {
  // play() rejects like iOS Safari's un-gestured play while window.__blockPlay is set.
  await page.addInitScript(() => {
    const realPlay = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function () {
      if (window.__blockPlay) return Promise.reject(new DOMException('blocked', 'NotAllowedError'));
      return realPlay.call(this);
    };
  });
  await page.goto(BASE_URL + FROM);
  await expect(page.locator('#audio-fab')).toBeVisible();
  // The first session's heading icons load eagerly on page load.
  await expect(page.locator('.heading-audio-icon').first()).toBeAttached({ timeout: 15000 });

  // The listener started playback (auto-advance only happens after that).
  await page.locator('#audio-fab').click();
  await expect.poll(() => page.evaluate(() => window.__audioPlayer.isPlaying()), { timeout: 15000 }).toBe(true);

  // Every segment map the player builds from here on ("[audio] Mapped a/b segments …").
  const mappedLogs = [];
  page.on('console', (m) => {
    const hit = m.text().match(/^\[audio\] Mapped (\d+)\/(\d+) segments/);
    if (hit) mappedLogs.push({ mapped: +hit[1], total: +hit[2] });
  });
  await page.evaluate(() => { window.__blockPlay = true; });
  // What the audio `ended` handler does — by then the element is paused (ended), so ajax-nav's own
  // "was playing → reload timestamps" branch doesn't run; only playNextChapter can load them.
  await page.evaluate((url) => {
    window.__audioPlayer.getAudioElement().pause();
    return window.__ajaxNav.navigateToSession(url, { autoplay: true });
  }, NEXT);
  const banner = page.locator('#audio-tap-banner');
  await expect(banner).toBeVisible({ timeout: 15000 });
  await expect(page).toHaveURL(new RegExp(NEXT + '$'));

  // The user taps "continue".
  await page.evaluate(() => { window.__blockPlay = false; });
  await banner.click();

  // The swapped-in session's heading icons (built from its timestamps) are there.
  await expect(page.locator('.session-content .heading-audio-icon').first()).toBeAttached({ timeout: 15000 });

  // …and they come from the NEXT session's timestamps, not a stale load of the previous session's
  // (ajax-nav starts a timestamps load before the player knows the next session; it must not win).
  const res = await page.request.get(`${BASE_URL}/api/audio/url/narrative-journey-series/foundations/the-call-of-christ/5-session2-thewater.timestamps.json`);
  const nextCount = (await (await page.request.get((await res.json()).url)).json()).segments.length;
  await page.waitForTimeout(3000); // let any in-flight load land
  expect(mappedLogs.length).toBeGreaterThan(0);
  expect(mappedLogs[mappedLogs.length - 1].total).toBe(nextCount);
});
