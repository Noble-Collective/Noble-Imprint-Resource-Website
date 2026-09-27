/**
 * Audio-synced highlight (shared narration engine — @noble-collective/userdata/narration, the
 * mobile app's NarrationAlignment ported; Collective-Shared ARCHITECTURE §9b).
 *
 * Guards: every narrated sentence finds its text (spoken ≠ displayed: verse numbers, †, spelled-out
 * references, lists, repeats); a Bible highlight never spans verses; heading headphones start at
 * the heading; the Bible's next chapter plays in place (no page load).
 *
 * Needs real audio: run the local server with AUDIO_DEV_SOURCE=https://resources.noblecollective.org
 * (see src/server/audio.js) unless its service account can read the audio bucket.
 * Whole-library numbers: `node scripts/audio-audit.js`.
 */
const { test, expect } = require('./fixtures');

const BASE_URL = 'http://localhost:8080';

async function alignmentOf(page, url) {
  await page.goto(BASE_URL + url);
  await page.waitForFunction(() => window.__audioPlayer && window.__audioPlayer.debugAlignment(), null, { timeout: 30000 });
  return page.evaluate(() => window.__audioPlayer.debugAlignment());
}
const litShare = (rows) => {
  const total = rows.reduce((a, r) => a + (r.end - r.start), 0);
  return rows.filter((r) => r.lit).reduce((a, r) => a + (r.end - r.start), 0) / total;
};

test.describe('Bible: every sentence lit, one verse at a time', () => {
  for (const [book, ch] of [['Genesis', 28], ['John', 1], ['Psalm', 136], ['Psalm', 23], ['Song%20of%20Solomon', 1]]) {
    test(`${decodeURIComponent(book)} ${ch}`, async ({ page }) => {
      const rows = await alignmentOf(page, `/bible/bsb/${book}?chapter=${ch}`);
      expect(rows.length).toBeGreaterThan(5);
      expect(rows.filter((r) => !r.lit).map((r) => r.text)).toEqual([]);
      // No highlight contains a verse number strictly inside it.
      expect(rows.filter((r) => r.sups > 0).map((r) => r.text)).toEqual([]);
    });
  }

  test('John 1:12–13 (one spoken sentence) lights one verse at a time', async ({ page }) => {
    const rows = await alignmentOf(page, '/bible/bsb/John?chapter=1');
    const v13 = rows.find((r) => /^children born not of blood/i.test(r.text));
    expect(v13, 'verse 13 is its own highlight').toBeTruthy();
    expect(v13.lit).toMatch(/^children born not of blood/);
  });

  test('Psalm 136: each repeated refrain lights its own line, not the first one', async ({ page }) => {
    const rows = await alignmentOf(page, '/bible/bsb/Psalm?chapter=136');
    const refrains = rows.filter((r) => /His loving devotion endures forever/.test(r.text));
    expect(refrains.length).toBeGreaterThan(20);
    // Each refrain lights its own place in the page (the old matcher lit the stanza's first one).
    expect(new Set(refrains.map((r) => r.at)).size).toBe(refrains.length);
  });
});

test.describe('Books: the spoken text finds the page text', () => {
  for (const [url, min] of [
    ['/narrative-journey-series/foundations/the-call-of-christ/6-session3-theway', 0.98],
    ['/vade-mecum/hear-my-son/03-wisdom-calls-out', 0.97], // spelled-out references + removed parentheticals
    ['/passage/homestead/05-partfour-journal', 0.98], // oldest data: leftover "- " list markers
  ]) {
    test(url.split('/').pop(), async ({ page }) => {
      const rows = await alignmentOf(page, url);
      expect(litShare(rows)).toBeGreaterThanOrEqual(min);
    });
  }
});

test('a heading headphone starts playback at that heading and lights it', async ({ page }) => {
  await page.goto(BASE_URL + '/bible/bsb/Genesis?chapter=28');
  await page.waitForFunction(() => window.__audioPlayer && window.__audioPlayer.debugAlignment());
  const icon = page.locator('.session-content h3 .heading-audio-icon').first();
  await icon.click();
  await expect.poll(() => page.evaluate(() => window.__audioPlayer.isPlaying()), { timeout: 15000 }).toBe(true);
  const heading = await page.locator('.session-content h3').first().textContent();
  const row = (await page.evaluate(() => window.__audioPlayer.debugAlignment())).find((r) => r.lit && heading.startsWith(r.lit));
  // Starts just before the heading (lead-in ≤ 0.3 s so the first word isn't clipped).
  await expect.poll(() => page.evaluate(() => window.__audioPlayer.getAudioElement().currentTime), { timeout: 10000 })
    .toBeGreaterThanOrEqual(row.start - 0.35);
  const t = await page.evaluate(() => window.__audioPlayer.getAudioElement().currentTime);
  expect(t).toBeLessThan(row.end + 1);
  // The overlay sits over the heading.
  const box = await page.locator('.session-content h3').first().boundingBox();
  const ov = await page.locator('#audio-highlight-overlays > div').first().boundingBox();
  expect(Math.abs(ov.y - box.y)).toBeLessThan(box.height);
});

test('Bible: the next chapter plays in place (no page load) with its own highlight', async ({ page }) => {
  await page.goto(BASE_URL + '/bible/bsb/Genesis?chapter=28');
  await page.locator('#audio-fab').click();
  await expect.poll(() => page.evaluate(() => window.__audioPlayer.isPlaying()), { timeout: 15000 }).toBe(true);
  await page.evaluate(() => { window.__noReload = true; });
  // The chapter ends.
  await page.evaluate(() => {
    const a = window.__audioPlayer.getAudioElement();
    a.pause();
    a.dispatchEvent(new Event('ended'));
  });
  await expect(page).toHaveURL(/chapter=29$/, { timeout: 15000 });
  await expect(page.locator('.session-content h1')).toHaveText(/Genesis 29/);
  expect(await page.evaluate(() => window.__noReload)).toBe(true); // same page, not a reload
  await expect(page.locator('.sidebar .nav-session-item.active')).toHaveText(/29/);
  await expect.poll(() => page.evaluate(() => {
    const rows = window.__audioPlayer.debugAlignment();
    return rows && rows.length > 5 && rows.every((r) => r.lit);
  }), { timeout: 15000 }).toBe(true);
  await expect.poll(() => page.evaluate(() => window.__audioPlayer.isPlaying()), { timeout: 15000 }).toBe(true);
  await expect(page.locator('#audio-fab')).toHaveAttribute('data-audio-file', '029.mp3');
});
