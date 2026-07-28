/**
 * Manual Playwright tests for AJAX session navigation.
 * Run with: npx playwright test tests/ajax-nav-manual.spec.js --headed
 */
const { test, expect } = require('./fixtures');

const BASE = 'http://localhost:8080';
// The Call of Christ has multiple sessions without audio — good for testing nav
const BOOK_URL = '/narrative-journey-series/foundations/the-call-of-christ';
const SESSION_1 = BOOK_URL + '/1-frontmatter';
const SESSION_2 = BOOK_URL + '/2-seriesorientation';
const SESSION_3 = BOOK_URL + '/3-intro-the-opening';

test.describe('AJAX Session Navigation', () => {
  test('clicking sidebar link navigates without full page reload', async ({ page }) => {
    await page.goto(BASE + SESSION_1);
    await page.waitForSelector('.session-content');

    // Verify ajax-nav.js loaded
    const hasAjaxNav = await page.evaluate(() => !!window.__ajaxNav);
    expect(hasAjaxNav).toBe(true);

    // Record the initial page load marker
    await page.evaluate(() => { window.__ajaxNavTestMarker = 'initial-load'; });

    // Click the second session link in the sidebar
    const session2Link = page.locator('.nav-session-item').nth(1);
    await session2Link.click();

    // Wait for the content to change
    await page.waitForFunction(() => {
      return document.title.includes('Series Orientation') || document.title.includes('Orientation');
    }, { timeout: 10000 });

    // Verify NO full page reload happened — our marker should still exist
    const markerSurvived = await page.evaluate(() => window.__ajaxNavTestMarker === 'initial-load');
    expect(markerSurvived).toBe(true);

    // Verify URL changed
    expect(page.url()).toContain(SESSION_2);

    // Verify sidebar active state updated (scope to sidebar, not mobile TOC dropdown clone)
    const activeLink = page.locator('.sidebar .nav-session-item.active');
    await expect(activeLink).toHaveCount(1);

    // Verify breadcrumb updated
    const breadcrumb = page.locator('.breadcrumb');
    await expect(breadcrumb).toContainText('Series Orientation');
  });

  test('clicking prev/next navigation links uses AJAX', async ({ page }) => {
    await page.goto(BASE + SESSION_2);
    await page.waitForSelector('.session-content');

    await page.evaluate(() => { window.__ajaxNavTestMarker = 'session2'; });

    // Click Next
    const nextLink = page.locator('.session-nav-next');
    await nextLink.click();

    await page.waitForFunction(() => {
      return !document.title.includes('Series Orientation');
    }, { timeout: 10000 });

    // Verify no reload
    const markerSurvived = await page.evaluate(() => window.__ajaxNavTestMarker === 'session2');
    expect(markerSurvived).toBe(true);

    // URL should be session 3
    expect(page.url()).toContain('3-intro');

    // Now click Previous
    await page.evaluate(() => { window.__ajaxNavTestMarker = 'session3'; });
    const prevLink = page.locator('.session-nav-prev');
    await prevLink.click();

    await page.waitForFunction(() => {
      return document.title.includes('Series Orientation') || document.title.includes('Orientation');
    }, { timeout: 10000 });

    const markerSurvived2 = await page.evaluate(() => window.__ajaxNavTestMarker === 'session3');
    expect(markerSurvived2).toBe(true);
  });

  test('browser back/forward works after AJAX navigation', async ({ page }) => {
    await page.goto(BASE + SESSION_1);
    await page.waitForSelector('.session-content');

    await page.evaluate(() => { window.__ajaxNavTestMarker = 'history-test'; });

    // Navigate to session 2 via sidebar
    const session2Link = page.locator('.nav-session-item').nth(1);
    await session2Link.click();
    await page.waitForFunction(() => document.title.includes('Series Orientation') || document.title.includes('Orientation'), { timeout: 10000 });

    // Go back
    await page.goBack();
    await page.waitForFunction(() => document.title.includes('Front Matter'), { timeout: 10000 });

    // Marker should still exist — AJAX nav handled the back
    const markerSurvived = await page.evaluate(() => window.__ajaxNavTestMarker === 'history-test');
    expect(markerSurvived).toBe(true);

    // Go forward
    await page.goForward();
    await page.waitForFunction(() => document.title.includes('Series Orientation') || document.title.includes('Orientation'), { timeout: 10000 });

    expect(page.url()).toContain(SESSION_2);
  });

  test('mobile TOC dropdown updates after AJAX navigation', async ({ page }) => {
    // Set mobile viewport
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto(BASE + SESSION_1);
    await page.waitForSelector('.session-content');

    // Check initial mobile TOC label
    const mobileLabel = page.locator('.mobile-toc-label');
    await expect(mobileLabel).toContainText('Front Matter');

    // Navigate via session nav (next)
    const nextLink = page.locator('.session-nav-next');
    await nextLink.click();
    await page.waitForFunction(() => !document.title.includes('Front Matter'), { timeout: 10000 });

    // Mobile TOC label should update
    await expect(mobileLabel).not.toContainText('Front Matter');
  });

  test('non-session links still trigger full page reload', async ({ page }) => {
    await page.goto(BASE + SESSION_1);
    await page.waitForSelector('.session-content');

    await page.evaluate(() => { window.__ajaxNavTestMarker = 'should-not-survive'; });

    // Click the book back link (sidebar-back) — should be a full reload
    // Scope to the actual sidebar (not mobile TOC dropdown clone)
    const backLink = page.locator('.sidebar .sidebar-back');
    await backLink.click();

    // Wait for navigation
    await page.waitForURL('**/' + 'the-call-of-christ', { timeout: 10000 });

    // Marker should be gone — full page reload
    const markerGone = await page.evaluate(() => window.__ajaxNavTestMarker === undefined);
    expect(markerGone).toBe(true);
  });

  test('direct URL visit works (full server render, no AJAX)', async ({ page }) => {
    await page.goto(BASE + SESSION_2);
    await page.waitForSelector('.session-content');

    // Verify page rendered correctly
    await expect(page.locator('.breadcrumb')).toContainText('Series Orientation');
    await expect(page.locator('.session-content')).not.toBeEmpty();

    // Verify AJAX nav is initialized
    const hasAjaxNav = await page.evaluate(() => !!window.__ajaxNav);
    expect(hasAjaxNav).toBe(true);
  });
});
