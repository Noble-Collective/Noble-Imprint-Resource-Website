/**
 * The Home search box (Collective-Shared plans/2026-10-09-library-search-terms.md, P4): a reader finds a
 * book by a word that isn't in its title. Results come from /api/library/search (the shared matcher).
 * Run: npx playwright test -c playwright.safari.config.js tests/safari/library-search.spec.js
 * (SAFARI_BASE_URL=http://localhost:8080 before the markup is deployed). Public page, read-only GETs.
 *
 * LIBSEARCH_SHOTS=<dir> also saves the mockup screenshots (light + dark) into <dir>.
 */
const fs = require('fs');
const path = require('path');
const { test, expect } = require('@playwright/test');

const ROOT = path.join(__dirname, '..', '..', 'src', 'public');
const LOCAL_ASSETS = [
  [/\/static\/js\/library-search\.js(\?|$)/, 'js/library-search.js', 'application/javascript'],
  [/\/static\/css\/style\.css(\?|$)/, 'css/style.css', 'text/css'],
];

const box = (page) => page.locator('#nc-libsearch-q');
const results = (page) => page.locator('[data-nc-libresults]');
const rows = (page) => page.locator('[data-nc-libresults] .nc-libresults__row');
const head = (page) => page.locator('.nc-libresults__head');
const status = (page) => page.locator('[data-nc-libsearch-status]');

test.beforeEach(async ({ page }) => {
  for (const [re, file, contentType] of LOCAL_ASSETS) {
    await page.route(re, (route) => route.fulfill({ path: path.join(ROOT, file), contentType }));
  }
  await page.addInitScript(() => {
    try {
      localStorage.setItem('nc_onboarded_v1', '1');
    } catch { /* ignore */ }
  });
});

test('typing a topic replaces the series list with matching books', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.home-visual')).toBeVisible();
  await expect(results(page)).toBeHidden();

  await box(page).fill('catechism');
  await expect(head(page)).toHaveText('12 books match “catechism”');
  await expect(page.locator('.home-visual')).toBeHidden();
  await expect(page.locator('.home-text')).toBeHidden();
  await expect(status(page)).toHaveText('12 books match “catechism”');

  // The first five rows, then "Show all 12".
  await expect(rows(page)).toHaveCount(5);
  const first = rows(page).first();
  await expect(first.locator('.nc-libresults__title')).toContainText('The Call of Christ');
  await expect(first.locator('.nc-libresults__path')).toHaveText('Narrative Journey Series · Foundations');
  await expect(first.locator('.nc-libresults__chip')).toHaveText(/^Matches /);
  await expect(first).toHaveAttribute('href', '/narrative-journey-series/foundations/the-call-of-christ');
  await expect(first.locator('img')).toHaveAttribute('src', /\/cover\//);
  await expect(page.locator('.nc-libresults__more')).toHaveText('Show all 12');
  await page.locator('.nc-libresults__more').click();
  await expect(rows(page)).toHaveCount(12);
  await expect(page.locator('.nc-libresults__more')).toBeHidden();

  // The query is in the URL, so the page can be shared.
  await expect.poll(() => new URL(page.url()).searchParams.get('q')).toBe('catechism');
});

test('a topic match shows its reason; a title match does not', async ({ page }) => {
  await page.goto('/');
  await box(page).fill('kjv');
  await expect(head(page)).toHaveText('1 book matches “kjv”');
  await expect(rows(page)).toHaveCount(1);
  await expect(rows(page).first().locator('.nc-libresults__title')).toHaveText('King James Bible');
  await expect(rows(page).first().locator('.nc-libresults__path')).toHaveText('Bibles');
  await expect(rows(page).first().locator('.nc-libresults__chip')).toHaveText('Matches kjv');

  await box(page).fill('shortness');
  await expect(head(page)).toHaveText('1 book matches “shortness”');
  await expect(rows(page).first().locator('.nc-libresults__title')).toHaveText(/^On the Shortness of Life( Pre-Release| Preview)?$/);
  await expect(rows(page).first().locator('.nc-libresults__chip')).toHaveCount(0);
});

test('Clear brings the list back and empties the URL', async ({ page }) => {
  await page.goto('/');
  await box(page).fill('advent');
  await expect(rows(page).first()).toBeVisible();
  const clear = page.locator('[data-nc-libsearch-clear]');
  await expect(clear).toBeVisible();
  await clear.click();
  await expect(box(page)).toHaveValue('');
  await expect(box(page)).toBeFocused();
  await expect(results(page)).toBeHidden();
  await expect(page.locator('.home-visual')).toBeVisible();
  await expect(clear).toBeHidden();
  await expect.poll(() => new URL(page.url()).searchParams.has('q')).toBe(false);
});

test('a ?q= link opens with the results', async ({ page }) => {
  await page.goto('/?q=advent');
  await expect(box(page)).toHaveValue('advent');
  await expect(head(page)).toHaveText(/books? match(es)? “advent”/);
  await expect(rows(page).first().locator('.nc-libresults__title')).toContainText('Come, Let Us Adore Him');
  await expect(rows(page).first().locator('.nc-libresults__chip')).toHaveText('Matches advent');
  await expect(page.locator('.home-visual')).toBeHidden();
});

test('no results says so and suggests what to try', async ({ page }) => {
  await page.goto('/');
  await box(page).fill('zzqqxx');
  await expect(head(page)).toHaveText('No books match “zzqqxx”');
  await expect(rows(page)).toHaveCount(0);
  await expect(page.locator('.nc-libresults__empty')).toContainText('Try a theme, a Bible book, a person or a translation.');
  await expect(status(page)).toHaveText('No books match “zzqqxx”');
});

test('one letter keeps the list; typing is debounced', async ({ page }) => {
  const calls = [];
  page.on('request', (r) => { if (r.url().includes('/api/library/search')) calls.push(r.url()); });
  await page.goto('/');
  await box(page).pressSequentially('c', { delay: 0 });
  await page.waitForTimeout(400);
  await expect(results(page)).toBeHidden();
  await expect(page.locator('.home-visual')).toBeVisible();
  expect(calls).toHaveLength(0);

  await box(page).pressSequentially('atechism', { delay: 30 });
  await expect(head(page)).toHaveText('12 books match “catechism”');
  expect(calls.length).toBeLessThanOrEqual(2);
});

test('keyboard: arrows move through results, Esc clears', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === 'webkit-iphone' || testInfo.project.name === 'chromium-android', 'hardware keyboard');
  await page.goto('/');
  await box(page).focus();
  await page.keyboard.type('kjv');
  await expect(rows(page)).toHaveCount(1);
  await page.keyboard.press('ArrowDown');
  await expect(rows(page).first()).toBeFocused();
  await page.keyboard.press('ArrowUp');
  await expect(box(page)).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(box(page)).toHaveValue('');
  await expect(results(page)).toBeHidden();
  await expect(page.locator('.home-visual')).toBeVisible();

  // Enter searches at once (no reload); ArrowDown + Enter opens the book.
  await page.keyboard.type('kjv');
  await page.keyboard.press('Enter');
  await expect(rows(page)).toHaveCount(1);
  expect(new URL(page.url()).pathname).toBe('/');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/bible\/kjv/);
});

test('works in List view, and the example words fill the box', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('[data-nc-libsearch-hint]')).toHaveText('Try catechism, advent, parenting or KJV.');
  await page.locator('.view-toggle [data-mode="text"]').click();
  await expect(page.locator('.home-text')).toBeVisible();

  await page.locator('[data-nc-libsearch-hint] [data-q="advent"]').click();
  await expect(box(page)).toHaveValue('advent');
  await expect(rows(page).first()).toBeVisible();
  await expect(page.locator('.home-text')).toBeHidden();
  await expect(page.locator('[data-nc-libsearch-hint]')).toBeHidden();

  await page.locator('[data-nc-libsearch-clear]').click();
  await expect(page.locator('.home-text')).toBeVisible();
  await expect(page.locator('.home-visual')).toBeHidden();
});

test('search box is >= 16px on touch screens (no iOS focus zoom)', async ({ page }, testInfo) => {
  await page.goto('/');
  const r = await page.evaluate(() => ({
    px: parseFloat(getComputedStyle(document.getElementById('nc-libsearch-q')).fontSize),
    touch: matchMedia('(hover: none) and (pointer: coarse)').matches,
  }));
  test.skip(!r.touch, `not a touch device (${testInfo.project.name})`);
  expect(r.px).toBeGreaterThanOrEqual(16);
});

test('the box sits under the subtitle, above the sign-in card', async ({ page }) => {
  await page.goto('/');
  const order = await page.evaluate(() => {
    const main = document.querySelector('.main');
    const at = (sel) => [...main.children].indexOf(main.querySelector(`:scope > ${sel}`));
    return { sub: at('.page-subtitle'), box: at('.nc-libsearch'), prompt: at('.nc-prompt'), visual: at('.home-visual') };
  });
  expect(order.box).toBe(order.sub + 1);
  if (order.prompt >= 0) expect(order.prompt).toBeGreaterThan(order.box);
  expect(order.visual).toBeGreaterThan(order.box);
});

// Not a check: the screenshots kept in the plan's assets (desktop + phone, light + dark).
test('screenshots', async ({ page }, testInfo) => {
  const dir = process.env.LIBSEARCH_SHOTS;
  test.skip(!dir || testInfo.project.name === 'chromium-android', 'LIBSEARCH_SHOTS not set');
  fs.mkdirSync(dir, { recursive: true });
  const name = testInfo.project.name === 'webkit-iphone' ? 'phone' : 'desktop';
  for (const theme of ['light', 'dark']) {
    if (theme === 'dark') {
      await page.addInitScript(() => {
        try { localStorage.setItem('nc:reader-settings', JSON.stringify({ theme: 'dark' })); } catch { /* ignore */ }
      });
    }
    await page.goto('/');
    await expect(box(page)).toBeVisible();
    // The first-paint theme script needs FEATURE_USER_DATA (off in a local .env): set the class too.
    if (theme === 'dark') await page.evaluate(() => document.documentElement.classList.add('nc-dark'));
    await page.screenshot({ path: path.join(dir, `${name}-${theme}-idle.png`) });
    const q = name === 'phone' ? 'advent' : 'catechism';
    await box(page).fill(q);
    await expect(rows(page).first()).toBeVisible();
    await box(page).blur();
    await page.screenshot({ path: path.join(dir, `${name}-${theme}-${q}.png`), fullPage: name === 'desktop' });
  }
});
