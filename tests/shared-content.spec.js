// Noble Imprint — Shared-content editing (@include) tests
// P2: resolved buffer renders in the editor, shared segments are tinted + read-only
//     in both modes, a banner names the source file, and SESSION edits still route
//     to the session file. P3/P4 add shared-line suggestion routing + link-out.
const { test, expect } = require('./fixtures');

const BASE_URL = 'http://localhost:8080';
const S5_PATH = '/narrative-journey-series/foundations/test-book/5-session5-includes';
const S5_FILE = 'series/Narrative Journey Series/Foundations/Test Book/sessions/5-Session5-Includes.md';
const S1_PATH = '/narrative-journey-series/foundations/test-book/1-session1-thegospel';
const SERIES_COMMON = 'series/Narrative Journey Series/commonSeries.md';
const BOOK_COMMON = 'series/Narrative Journey Series/Foundations/Test Book/commonBook.md';
const TEST_EMAIL = 'steve@noblecollective.org';

async function login(page, path) {
  const res = await page.request.post(`${BASE_URL}/api/auth/test-login`, { data: { email: TEST_EMAIL } });
  expect(res.ok()).toBeTruthy();
  for (let attempt = 0; attempt < 3; attempt++) {
    try { await page.goto(BASE_URL + path, { timeout: 20000 }); return; }
    catch { if (attempt < 2) await page.waitForTimeout(3000); }
  }
  await page.goto(BASE_URL + path);
}
async function enterSuggestMode(page) {
  await page.click('#btn-suggest-edit');
  await page.waitForSelector('#codemirror-host .cm-editor');
  await page.waitForTimeout(600);
}
async function enterDirectMode(page) {
  await page.click('#btn-direct-edit');
  await page.waitForSelector('#codemirror-host .cm-editor');
  await page.waitForTimeout(600);
}
const getDoc = (page) => page.evaluate(() => window.__editorView ? window.__editorView.state.doc.toString() : null);

// Place cursor after the first occurrence of `text` and focus.
async function cursorAfter(page, text) {
  const ok = await page.evaluate((t) => {
    const v = window.__editorView; if (!v) return false;
    const pos = v.state.doc.toString().indexOf(t);
    if (pos === -1) return false;
    v.dispatch({ selection: { anchor: pos + t.length } });
    v.focus();
    return true;
  }, text);
  expect(ok).toBeTruthy();
  await page.waitForTimeout(150);
}

test.describe('Shared-content editing — P2 (render, tint, banner, read-only)', () => {
  test('resolved shared content is visible in the editor buffer (no raw @include)', async ({ page }) => {
    await login(page, S5_PATH);
    await enterSuggestMode(page);
    const doc = await getDoc(page);
    expect(doc).toBeTruthy();
    // shared blocks are inlined... (source authors book-level as **book-level**)
    expect(doc).toContain('book-level');
    expect(doc).toContain('series-level');
    expect(doc).toContain('I believe in the Son'); // creed fragment (bold=)
    // ...and the raw directive is gone from the buffer
    expect(doc).not.toContain('@include');
    // session-native content is still present
    expect(doc).toContain('native session content');
  });

  test('shared lines carry the tint decoration class', async ({ page }) => {
    await login(page, S5_PATH);
    await enterSuggestMode(page);
    const count = await page.locator('.cm-shared-line').count();
    expect(count).toBeGreaterThan(0);
  });

  test('banner names the source file + level when cursor enters shared content', async ({ page }) => {
    await login(page, S5_PATH);
    await enterSuggestMode(page);
    await cursorAfter(page, 'book-level');
    await expect(page.locator('#editor-shared-banner')).toBeVisible();
    await expect(page.locator('#shared-banner-name')).toHaveText('commonBook.md');
    // moving into series-level shared content updates the banner
    await cursorAfter(page, 'series-level');
    await expect(page.locator('#shared-banner-name')).toHaveText('commonSeries.md');
    // moving back to a session line hides the banner
    await cursorAfter(page, 'native session content');
    await expect(page.locator('#editor-shared-banner')).toBeHidden();
  });

  test('shared content is READ-ONLY in suggest mode', async ({ page }) => {
    await login(page, S5_PATH);
    await enterSuggestMode(page);
    const before = await getDoc(page);
    await cursorAfter(page, 'book-level');
    await page.keyboard.type('XXXX');
    await page.waitForTimeout(300);
    const after = await getDoc(page);
    expect(after).toEqual(before); // edit blocked, buffer unchanged
  });

  test('shared content is READ-ONLY in direct mode', async ({ page }) => {
    await login(page, S5_PATH);
    await enterDirectMode(page);
    const before = await getDoc(page);
    await cursorAfter(page, 'series-level');
    await page.keyboard.type('ZZZZ');
    await page.waitForTimeout(300);
    const after = await getDoc(page);
    expect(after).toEqual(before);
  });

  test('SESSION content is still editable and the suggestion routes to the session file', async ({ page }) => {
    await login(page, S5_PATH);
    await enterSuggestMode(page);
    const before = await getDoc(page);
    await cursorAfter(page, 'native session content');
    await page.keyboard.type('EDIT');
    await page.waitForTimeout(400);
    const after = await getDoc(page);
    expect(after).not.toEqual(before); // session edit allowed

    // auto-save (1.5s debounce) → suggestion lands on the SESSION file
    await expect.poll(async () => {
      const r = await page.request.get(BASE_URL + '/api/suggestions/content', { params: { filePath: S5_FILE } });
      if (!r.ok()) return -1;
      const j = await r.json();
      return (j.pendingSuggestions || []).length;
    }, { timeout: 10000 }).toBeGreaterThan(0);

    // and NOT on either shared file
    for (const fp of [SERIES_COMMON, BOOK_COMMON]) {
      const r = await page.request.get(BASE_URL + '/api/suggestions/content', { params: { filePath: fp } });
      const j = await r.json();
      expect((j.pendingSuggestions || []).length).toBe(0);
    }
  });

  test('REGRESSION: a no-include session (Session 1) exposes no segment data', async ({ page }) => {
    await login(page, S1_PATH);
    await enterSuggestMode(page);
    const info = await page.evaluate(() => ({
      hasData: !!window.__EDITOR_DATA,
      segments: window.__EDITOR_DATA ? window.__EDITOR_DATA.segments : 'nodata',
      resolved: window.__EDITOR_DATA ? window.__EDITOR_DATA.resolvedContent : 'nodata',
      sharedLines: document.querySelectorAll('.cm-shared-line').length,
    }));
    expect(info.hasData).toBeTruthy();
    expect(info.segments).toBeNull();
    expect(info.resolved).toBeNull();
    expect(info.sharedLines).toBe(0);
  });
});
