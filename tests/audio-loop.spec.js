/**
 * Bible A–B loop (Scripture memory) — verse-snapped repeat with a 1 s beat, like the app and
 * Coram Deo. Verse timeline = the shared narration engine's verse split (segmentVerses), so A/B
 * land on the exact word a verse begins even when the narrator reads verses as one sentence.
 *
 * Needs real audio: local server with AUDIO_DEV_SOURCE=https://resources.noblecollective.org.
 */
const { test, expect } = require('./fixtures');

const BASE_URL = 'http://localhost:8080';

async function startPlaying(page, url) {
  await page.goto(BASE_URL + url);
  await page.locator('#audio-fab').click();
  await expect.poll(() => page.evaluate(() => window.__audioPlayer.isPlaying()), { timeout: 15000 }).toBe(true);
  await page.waitForFunction(() => window.__audioPlayer.debugAlignment());
  const expand = page.locator('#audio-expand-btn');
  if (await expand.isVisible()) await expand.click(); // mobile: open the extra row
}
// Seek into the piece whose text starts with `re` and let the player see it.
async function seekInto(page, re) {
  const at = await page.evaluate((src) => {
    const row = window.__audioPlayer.debugAlignment().find((r) => new RegExp(src).test(r.text));
    window.__audioPlayer.getAudioElement().currentTime = row.start + 0.3;
    return row.start + 0.3;
  }, re.source);
  await expect.poll(() => page.evaluate(() => window.__audioPlayer.getAudioElement().currentTime), { timeout: 8000 })
    .toBeGreaterThanOrEqual(at - 0.05);
}
const state = (page) => page.evaluate(() => window.__audioPlayer.loopState());
const now = (page) => page.evaluate(() => window.__audioPlayer.getAudioElement().currentTime);

test('A and B snap to whole verses — even inside one spoken sentence (Proverbs 1:1–3)', async ({ page }) => {
  await startPlaying(page, '/bible/bsb/Proverbs?chapter=1');
  await seekInto(page, /^for gaining wisdom/); // verse 2 — mid-sentence (1–3 are one sentence)
  await page.locator('#audio-loop-a').click();
  await seekInto(page, /^and for receiving instruction/); // verse 3
  await page.locator('#audio-loop-b').click();
  const s = await state(page);
  expect(s.a.verse).toBe(2);
  expect(s.b.verse).toBe(3);
  expect(s.on).toBe(true); // engages once both ends are set
  await expect(page.locator('#audio-loop-range')).toHaveText('Proverbs 1:2–3');
  await expect(page.locator('#audio-loop-toggle')).toHaveAttribute('aria-pressed', 'true');
  // A starts at the word verse 2 begins (just before it), not the sentence start.
  const rows = await page.evaluate(() => window.__audioPlayer.debugAlignment());
  const v2 = rows.find((r) => /^for gaining wisdom/.test(r.text));
  expect(s.a.time).toBe(v2.start);
  expect(s.a.seek).toBeGreaterThanOrEqual(v2.start - 0.3);
});

test('reaching B returns to A after a 1 s beat, and keeps repeating', async ({ page }) => {
  await startPlaying(page, '/bible/bsb/Proverbs?chapter=1');
  await seekInto(page, /^for gaining wisdom/);
  await page.locator('#audio-loop-a').click();
  await page.locator('#audio-loop-b').click(); // A = B = verse 2 (a single-verse loop)
  const s = await state(page);
  expect(s.a.verse).toBe(2);
  expect(s.b.verse).toBe(2);
  await expect(page.locator('#audio-loop-range')).toHaveText('Proverbs 1:2');
  // Jump to just before B.
  await page.evaluate((t) => { window.__audioPlayer.getAudioElement().currentTime = t; }, s.b.time - 0.4);
  await expect.poll(() => state(page).then((x) => x.gap), { timeout: 5000 }).toBe(true); // the beat
  expect(await now(page)).toBeLessThan(s.a.time + 0.1);
  await expect.poll(() => state(page).then((x) => x.gap), { timeout: 3000 }).toBe(false);
  await expect.poll(() => page.evaluate(() => window.__audioPlayer.isPlaying()), { timeout: 3000 }).toBe(true);
  const t = await now(page);
  expect(t).toBeGreaterThanOrEqual(s.a.seek - 0.05);
  expect(t).toBeLessThan(s.b.time);
});

test('repeat off plays straight through B; × clears', async ({ page }) => {
  await startPlaying(page, '/bible/bsb/Proverbs?chapter=1');
  await seekInto(page, /^for gaining wisdom/);
  await page.locator('#audio-loop-a').click();
  await page.locator('#audio-loop-b').click();
  await page.locator('#audio-loop-toggle').click();
  const s = await state(page);
  expect(s.on).toBe(false);
  expect(s.a).toBeTruthy(); // A/B kept
  await page.evaluate((t) => { window.__audioPlayer.getAudioElement().currentTime = t; }, s.b.time - 0.3);
  await expect.poll(() => now(page), { timeout: 5000 }).toBeGreaterThan(s.b.time + 0.2);
  expect((await state(page)).gap).toBe(false);
  await page.locator('#audio-loop-clear').click();
  const c = await state(page);
  expect(c.a).toBeNull();
  expect(c.b).toBeNull();
  await expect(page.locator('#audio-loop-range')).toHaveText('');
  await expect(page.locator('#audio-loop-clear')).toBeHidden();
});

test('in a heading, A takes the next verse and B the previous one', async ({ page }) => {
  await startPlaying(page, '/bible/bsb/Genesis?chapter=28');
  await seekInto(page, /^Esau Marries Mahalath/); // the heading between verses 5 and 6
  await page.locator('#audio-loop-a').click();
  await page.locator('#audio-loop-b').click();
  const s = await state(page);
  expect(s.a.verse).toBe(6);
  expect(s.b.verse).toBe(5);
  expect(s.on).toBe(false); // B before A: not engaged
  await expect(page.locator('#audio-loop-toggle')).toBeDisabled();
});

test('a loop ending on the last verse repeats instead of going to the next chapter', async ({ page }) => {
  await startPlaying(page, '/bible/bsb/Genesis?chapter=28');
  await seekInto(page, /^And this stone I have set up/); // the last verse (22)
  await page.locator('#audio-loop-a').click();
  await page.locator('#audio-loop-b').click();
  const s = await state(page);
  expect(s.b.verse).toBe(22);
  await page.evaluate(() => {
    const a = window.__audioPlayer.getAudioElement();
    a.pause();
    a.dispatchEvent(new Event('ended'));
  });
  await expect.poll(() => state(page).then((x) => x.gap), { timeout: 3000 }).toBe(true);
  await page.waitForTimeout(1500);
  await expect(page).toHaveURL(/chapter=28$/);
  expect(await now(page)).toBeLessThan(s.b.time);
});

test('the loop row is only on Bible pages; a chapter change clears it', async ({ page }) => {
  await page.goto(BASE_URL + '/narrative-journey-series/foundations/the-call-of-christ/6-session3-theway');
  await expect(page.locator('#audio-loop')).toHaveCount(0);
  await startPlaying(page, '/bible/bsb/Genesis?chapter=28');
  await seekInto(page, /^So Isaac called for Jacob/);
  await page.locator('#audio-loop-a').click();
  expect((await state(page)).a).toBeTruthy();
  await page.evaluate(() => {
    const a = window.__audioPlayer.getAudioElement();
    a.pause();
    a.dispatchEvent(new Event('ended'));
  });
  await expect(page).toHaveURL(/chapter=29$/, { timeout: 15000 });
  expect((await state(page)).a).toBeNull();
  await expect(page.locator('#audio-loop-range')).toHaveText('');
});
