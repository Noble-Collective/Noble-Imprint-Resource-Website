/**
 * Dark mode from the first paint (Bryan, 2026-10: "my computer is in dark mode and almost every page
 * I went to was flashing white 2-3 times before settling down").
 *
 * The dark theme, text size and reading font used to be applied only by the reader bundle — a module
 * script on the page's last line — so every page painted light (and in the default font) first. The
 * head now applies the saved settings before anything is drawn, and the dark colours live in
 * style.css. These tests BLOCK the reader bundle: what they see is what the browser paints before it.
 *
 * Run: npx playwright test tests/dark-first-paint.spec.js (server on port 8080).
 */
const { test, expect } = require('./fixtures');

const BASE_URL = 'http://localhost:8080';
// A public Passage session (the pages Bryan was reading).
const PAGE = '/passage/homestead/02-partone-preparation';

async function openWithoutReaderBundle(page, { scheme, settings } = {}) {
  await page.route(/reader-userdata-bundle\.js/, (route) => route.abort());
  if (scheme) await page.emulateMedia({ colorScheme: scheme });
  if (settings) {
    await page.addInitScript((s) => {
      localStorage.setItem('nc:reader-settings', JSON.stringify(s));
    }, settings);
  }
  await page.goto(BASE_URL + PAGE, { waitUntil: 'domcontentloaded' });
}

const bodyBg = (page) => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
const isDark = (page) => page.evaluate(() => document.documentElement.classList.contains('nc-dark'));

test('OS dark, no saved setting: dark before the reader bundle runs', async ({ page }) => {
  await openWithoutReaderBundle(page, { scheme: 'dark' });
  expect(await isDark(page)).toBe(true);
  expect(await bodyBg(page)).toBe('rgb(12, 10, 9)');
  // The page's own surfaces follow (the reading column, the footer).
  const footerBg = await page.evaluate(() => getComputedStyle(document.querySelector('.site-footer')).backgroundColor);
  expect(footerBg).not.toBe('rgb(255, 255, 255)');
});

test('OS dark but the reader chose Light: stays light', async ({ page }) => {
  await openWithoutReaderBundle(page, { scheme: 'dark', settings: { theme: 'light' } });
  expect(await isDark(page)).toBe(false);
});

test('OS light but the reader chose Dark: dark', async ({ page }) => {
  await openWithoutReaderBundle(page, { scheme: 'light', settings: { theme: 'dark' } });
  expect(await isDark(page)).toBe(true);
});

test('saved text size and font apply before the reader bundle runs', async ({ page }) => {
  await openWithoutReaderBundle(page, { scheme: 'light', settings: { fontSize: 'xl', fontFamily: 'serif' } });
  const p = await page.evaluate(() => {
    const el = document.querySelector('.session-content p');
    const cs = getComputedStyle(el);
    return { size: cs.fontSize, family: cs.fontFamily };
  });
  expect(p.size).toBe(`${17 * 1.75}px`);
  expect(p.family).toContain('Lora');
});
