/**
 * AJAX Session Navigation — Automated Playwright Tests
 *
 * Tests the AJAX navigation system used for audio auto-advance.
 * Manual navigation (sidebar clicks, prev/next) always does full page reload.
 * Only the audio ended handler calls navigateToSession() programmatically.
 *
 * Run with: npx playwright test tests/ajax-nav.spec.js --workers=1
 * Server must be running on port 8080.
 */
const { test, expect } = require('./fixtures');

const BASE_URL = 'http://localhost:8080';
const TEST_EMAIL = 'steve@noblecollective.org';

// Test Book (hidden, requires auth) — has editor toolbar for logged-in users
const TEST_BOOK_URL = '/narrative-journey-series/foundations/test-book';
const SESSION_1 = TEST_BOOK_URL + '/1-session1-thegospel';
const SESSION_2 = TEST_BOOK_URL + '/2-session2-thewater';
const SESSION_3 = TEST_BOOK_URL + '/3-session3-theway';

// Public book (no auth needed, no editor) — The Call of Christ
const PUBLIC_BOOK_URL = '/narrative-journey-series/foundations/the-call-of-christ';
const PUBLIC_SESSION_1 = PUBLIC_BOOK_URL + '/1-frontmatter';
const PUBLIC_SESSION_2 = PUBLIC_BOOK_URL + '/2-seriesorientation';
const PUBLIC_SESSION_3 = PUBLIC_BOOK_URL + '/3-intro-the-opening';

// ============================================================
// HELPERS
// ============================================================

async function login(page) {
  const res = await page.request.post(`${BASE_URL}/api/auth/test-login`, {
    data: { email: TEST_EMAIL },
  });
  expect(res.ok()).toBeTruthy();
}

/** Navigate to a session page, retrying on timeout (server may be rebuilding content tree). */
async function goTo(page, path) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await page.goto(BASE_URL + path, { timeout: 15000 });
      return;
    } catch {
      if (attempt < 2) await page.waitForTimeout(3000);
    }
  }
  await page.goto(BASE_URL + path);
}

/** Set a JS marker on the page — survives AJAX nav but dies on full reload. */
async function setMarker(page, name) {
  await page.evaluate((n) => { window.__testMarker = n; }, name);
}

/** Check whether the marker survived (true = no full reload happened). */
async function markerSurvived(page, name) {
  return page.evaluate((n) => window.__testMarker === n, name);
}

/** Wait for AJAX nav to complete by watching for a title change. */
async function waitForTitleContaining(page, text, timeout = 10000) {
  await page.waitForFunction(
    (t) => document.title.includes(t),
    text,
    { timeout }
  );
}

// ============================================================
// PROGRAMMATIC AJAX NAVIGATION (auto-advance path)
// ============================================================

test.describe('AJAX Navigation — Auto-Advance', () => {
  test('window.__ajaxNav is exposed on session pages', async ({ page }) => {
    await goTo(page, PUBLIC_SESSION_1);
    await page.waitForSelector('.session-content');

    const hasAjaxNav = await page.evaluate(() => !!window.__ajaxNav);
    expect(hasAjaxNav).toBe(true);

    const hasMethod = await page.evaluate(() => typeof window.__ajaxNav.navigateToSession === 'function');
    expect(hasMethod).toBe(true);
  });

  test('navigateToSession swaps content without full page reload', async ({ page }) => {
    await goTo(page, PUBLIC_SESSION_1);
    await page.waitForSelector('.session-content');
    await setMarker(page, 'ajax-test');

    const initialContent = await page.locator('.session-content').textContent();

    await page.evaluate((url) => window.__ajaxNav.navigateToSession(url), PUBLIC_SESSION_2);
    await waitForTitleContaining(page, 'Series Orientation');

    // Marker survives = no full page reload
    expect(await markerSurvived(page, 'ajax-test')).toBe(true);

    // Content changed
    const newContent = await page.locator('.session-content').textContent();
    expect(newContent).not.toEqual(initialContent);
  });

  test('sidebar active state updates after navigateToSession', async ({ page }) => {
    await goTo(page, PUBLIC_SESSION_1);
    await page.waitForSelector('.session-content');

    const initialActive = await page.locator('.sidebar .nav-session-item.active').textContent();

    await page.evaluate((url) => window.__ajaxNav.navigateToSession(url), PUBLIC_SESSION_2);
    await waitForTitleContaining(page, 'Series Orientation');

    const newActive = await page.locator('.sidebar .nav-session-item.active').textContent();
    expect(newActive).not.toEqual(initialActive);
    await expect(page.locator('.sidebar .nav-session-item.active')).toHaveCount(1);
  });

  test('breadcrumb updates after navigateToSession', async ({ page }) => {
    await goTo(page, PUBLIC_SESSION_1);
    await page.waitForSelector('.session-content');

    await page.evaluate((url) => window.__ajaxNav.navigateToSession(url), PUBLIC_SESSION_2);
    await waitForTitleContaining(page, 'Series Orientation');

    await expect(page.locator('.breadcrumb')).toContainText('Series Orientation');
  });

  test('document title and URL update after navigateToSession', async ({ page }) => {
    await goTo(page, PUBLIC_SESSION_1);
    await page.waitForSelector('.session-content');

    await page.evaluate((url) => window.__ajaxNav.navigateToSession(url), PUBLIC_SESSION_2);
    await waitForTitleContaining(page, 'Series Orientation');

    expect(page.url()).toContain(PUBLIC_SESSION_2);
  });

  test('multiple sequential navigateToSession calls work', async ({ page }) => {
    await goTo(page, PUBLIC_SESSION_1);
    await page.waitForSelector('.session-content');
    await setMarker(page, 'multi-nav');

    await page.evaluate((url) => window.__ajaxNav.navigateToSession(url), PUBLIC_SESSION_2);
    await waitForTitleContaining(page, 'Series Orientation');

    await page.evaluate((url) => window.__ajaxNav.navigateToSession(url), PUBLIC_SESSION_3);
    await page.waitForFunction(
      (t) => !document.title.includes(t),
      'Series Orientation',
      { timeout: 10000 }
    );

    expect(await markerSurvived(page, 'multi-nav')).toBe(true);
    expect(page.url()).toContain('3-intro');
  });

  test('scrolls to top after navigateToSession', async ({ page }) => {
    await goTo(page, PUBLIC_SESSION_1);
    await page.waitForSelector('.session-content');

    await page.evaluate(() => window.scrollTo(0, 500));
    await page.waitForTimeout(200);
    expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(0);

    await page.evaluate((url) => window.__ajaxNav.navigateToSession(url), PUBLIC_SESSION_2);
    await waitForTitleContaining(page, 'Series Orientation');

    expect(await page.evaluate(() => window.scrollY)).toBe(0);
  });

  test('rapid successive navigations abort cleanly', async ({ page }) => {
    await goTo(page, PUBLIC_SESSION_1);
    await page.waitForSelector('.session-content');
    await setMarker(page, 'rapid-nav');

    // Fire 3 navigations rapidly — earlier ones should be aborted
    await page.evaluate((urls) => {
      window.__ajaxNav.navigateToSession(urls[0]);
      window.__ajaxNav.navigateToSession(urls[1]);
      window.__ajaxNav.navigateToSession(urls[2]);
    }, [PUBLIC_SESSION_2, PUBLIC_SESSION_3, PUBLIC_SESSION_2]);

    await waitForTitleContaining(page, 'Series Orientation', 15000);

    expect(await markerSurvived(page, 'rapid-nav')).toBe(true);
  });

  test('loading indicator cleans up after navigation', async ({ page }) => {
    await goTo(page, PUBLIC_SESSION_1);
    await page.waitForSelector('.session-content');

    await page.evaluate((url) => window.__ajaxNav.navigateToSession(url), PUBLIC_SESSION_2);
    await waitForTitleContaining(page, 'Series Orientation');

    await page.waitForTimeout(500); // allow cleanup animation
    await expect(page.locator('.ajax-nav-progress')).toHaveCount(0);
  });

  test('verse popup works in content loaded via navigateToSession', async ({ page }) => {
    await goTo(page, PUBLIC_SESSION_1);
    await page.waitForSelector('.session-content');

    // Navigate to a session that likely has Bible references
    await page.evaluate((url) => window.__ajaxNav.navigateToSession(url), PUBLIC_SESSION_2);
    await waitForTitleContaining(page, 'Series Orientation');

    const bibleRefCount = await page.locator('.session-content .bible-ref').count();
    if (bibleRefCount > 0) {
      await page.locator('.session-content .bible-ref').first().click();
      await page.waitForTimeout(1000);

      const overlayVisible = await page.evaluate(() => {
        const overlay = document.querySelector('[data-verse-overlay]');
        return overlay && overlay.classList.contains('is-visible');
      });
      expect(overlayVisible).toBe(true);
    }
  });
});

// ============================================================
// MANUAL NAVIGATION = FULL PAGE RELOAD
// ============================================================

test.describe('AJAX Navigation — Manual Nav is Full Reload', () => {
  test('sidebar link click causes full page reload (not intercepted)', async ({ page }) => {
    await goTo(page, PUBLIC_SESSION_1);
    await page.waitForSelector('.session-content');
    await setMarker(page, 'should-die');

    const session2Link = page.locator('.sidebar .nav-session-item').nth(1);
    await session2Link.click();
    await page.waitForURL('**/' + PUBLIC_SESSION_2.split('/').pop(), { timeout: 10000 });

    // Marker should be gone — full page reload happened
    expect(await markerSurvived(page, 'should-die')).toBe(false);
  });

  test('next/prev nav links cause full page reload', async ({ page }) => {
    await goTo(page, PUBLIC_SESSION_2);
    await page.waitForSelector('.session-content');
    await setMarker(page, 'should-die');

    const nextLink = page.locator('.session-nav-next');
    await nextLink.click();
    await page.waitForURL('**/3-intro*', { timeout: 10000 });

    expect(await markerSurvived(page, 'should-die')).toBe(false);
  });

  test('back button after auto-advance does full page reload', async ({ page }) => {
    await goTo(page, PUBLIC_SESSION_1);
    await page.waitForSelector('.session-content');

    // Programmatic auto-advance (simulates audio ended)
    await page.evaluate((url) => window.__ajaxNav.navigateToSession(url), PUBLIC_SESSION_2);
    await waitForTitleContaining(page, 'Series Orientation');

    // Press back — popstate handler calls window.location.reload()
    // This causes a full page navigation. Wait for it to settle.
    await page.goBack();
    // Wait for the reload to complete — the page will reload at the session 1 URL
    await page.waitForLoadState('networkidle', { timeout: 15000 });
    await page.waitForSelector('.session-content', { timeout: 10000 });

    // We're back on session 1 via full page reload
    expect(page.url()).toContain(PUBLIC_SESSION_1);
  });
});

// ============================================================
// EDITOR BAIL-OUT
// ============================================================

test.describe('AJAX Navigation — Editor Safety', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('navigateToSession bails to full reload when editor is active', async ({ page }) => {
    await goTo(page, SESSION_1);
    await page.waitForSelector('.session-content');

    // Enter suggest mode
    await page.click('#btn-suggest-edit');
    await page.waitForSelector('#codemirror-host .cm-editor', { timeout: 10000 });
    await page.waitForTimeout(500);

    // Verify editor is active
    expect(await page.evaluate(() => !!window.__editorView)).toBe(true);

    await setMarker(page, 'should-die');

    // Call navigateToSession — should bail to full page reload
    await page.evaluate((url) => window.__ajaxNav.navigateToSession(url), SESSION_2);
    await page.waitForURL('**/' + SESSION_2.split('/').pop(), { timeout: 10000 });

    // Marker should be gone — editor bail-out triggered full reload
    expect(await markerSurvived(page, 'should-die')).toBe(false);
  });

  test('editor bail-out sets autoplay flag in localStorage when autoplay option is true', async ({ page }) => {
    await goTo(page, SESSION_1);
    await page.waitForSelector('.session-content');

    // Enter suggest mode
    await page.click('#btn-suggest-edit');
    await page.waitForSelector('#codemirror-host .cm-editor', { timeout: 10000 });
    await page.waitForTimeout(500);

    // Clear any existing autoplay flag
    await page.evaluate(() => localStorage.removeItem('audio-autoplay'));

    // Call navigateToSession with autoplay: true — will bail out to full reload
    // The bail-out sets localStorage before redirecting. After the redirect,
    // the new page's audio-player.js reads and clears the flag.
    // We use waitForNavigation to catch the redirect.
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 15000 }),
      page.evaluate((url) => {
        window.__ajaxNav.navigateToSession(url, { autoplay: true });
      }, SESSION_2),
    ]);

    // After the full reload, audio-player.js may have already consumed the flag.
    // But on the Test Book there's no audio, so audio-player.js doesn't load,
    // meaning the flag should still be in localStorage.
    const autoplayFlag = await page.evaluate(() => localStorage.getItem('audio-autoplay'));
    expect(autoplayFlag).toBe('true');

    // Clean up
    await page.evaluate(() => localStorage.removeItem('audio-autoplay'));
  });

  test('navigateToSession works normally when editor is NOT active', async ({ page }) => {
    await goTo(page, SESSION_1);
    await page.waitForSelector('.session-content');
    await setMarker(page, 'no-editor');

    // Don't enter editor — just navigate
    await page.evaluate((url) => window.__ajaxNav.navigateToSession(url), SESSION_2);
    await waitForTitleContaining(page, 'Session 2');

    // Marker survives — AJAX nav, no full reload
    expect(await markerSurvived(page, 'no-editor')).toBe(true);
    await expect(page.locator('.breadcrumb')).toContainText('Session 2');
  });
});

// ============================================================
// API ENDPOINT
// ============================================================

test.describe('AJAX Navigation — API Endpoint', () => {
  test('/api/session-data returns correct JSON structure', async ({ page }) => {
    await login(page);

    const res = await page.request.get(`${BASE_URL}/api/session-data${SESSION_1}`);
    expect(res.ok()).toBeTruthy();

    const data = await res.json();

    expect(data).toHaveProperty('title');
    expect(data).toHaveProperty('sidebarHtml');
    expect(data).toHaveProperty('mobileLabel');
    expect(data).toHaveProperty('breadcrumbHtml');
    expect(data).toHaveProperty('editToolbarHtml');
    expect(data).toHaveProperty('sessionHtml');
    expect(data).toHaveProperty('sessionNavHtml');
    expect(data).toHaveProperty('bookUrl');
    expect(data).toHaveProperty('nextSessionUrl');
    expect(data).toHaveProperty('editData');

    expect(data.title).toContain('Test Book');
    expect(data.bookUrl).toBe(TEST_BOOK_URL);
    expect(data.nextSessionUrl).toContain('2-session2');
    expect(data.editData).toBeTruthy();
    expect(data.editData).toHaveProperty('rawContent');
    expect(data.editData).toHaveProperty('editRole');
  });

  test('/api/session-data returns 404 for invalid session', async ({ page }) => {
    const res = await page.request.get(
      `${BASE_URL}/api/session-data/narrative-journey-series/foundations/test-book/nonexistent-session`
    );
    expect(res.status()).toBe(404);
  });

  test('/api/session-data returns editData:null for unauthenticated user', async ({ page }) => {
    const res = await page.request.get(`${BASE_URL}/api/session-data${PUBLIC_SESSION_1}`);
    expect(res.ok()).toBeTruthy();

    const data = await res.json();
    expect(data.editData).toBeNull();
  });
});
