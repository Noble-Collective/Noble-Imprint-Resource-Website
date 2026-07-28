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

  test('each shared block shows an inline affordance naming its source file + edit link', async ({ page }) => {
    await login(page, S5_PATH);
    await enterSuggestMode(page);
    const affordances = page.locator('.cm-shared-affordance');
    await expect(affordances.first()).toBeVisible();
    const joined = (await affordances.allInnerTexts()).join('\n');
    expect(joined).toContain('commonBook.md');
    expect(joined).toContain('commonSeries.md');
    // admin sees an "Edit <file> →" link pointing at the ?editFile route
    const link = page.locator('.cm-shared-editlink').first();
    await expect(link).toBeVisible();
    expect(await link.getAttribute('href')).toContain('editFile=');
    // the old heavy top banner is gone
    expect(await page.locator('#editor-shared-banner').count()).toBe(0);
  });

  test('parameterized spans are read-only in suggest mode (edit blocked by the filter)', async ({ page }) => {
    await login(page, S5_PATH);
    await enterSuggestMode(page);
    // Drive the change filter directly — the {id} value lives inside a masked
    // (atomic) <Question> tag, so a cursor can't be placed there via the UI anyway.
    const result = await page.evaluate(() => {
      const v = window.__editorView;
      const segs = window.__EDITOR_DATA.segments || [];
      let span = null;
      for (const s of segs) for (const r of (s.readonlySpans || [])) if (r.reason === 'id') span = r;
      if (!span) return { found: false };
      const before = v.state.doc.toString();
      const pos = span.bufFrom + 1; // inside the substituted id value
      v.dispatch({ changes: { from: pos, to: pos, insert: 'ZZ' } });
      return { found: true, changed: v.state.doc.toString() !== before };
    });
    expect(result.found).toBeTruthy();
    expect(result.changed).toBeFalsy(); // parameterized span edit blocked
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

// Count pending suggestions on a file (authenticated via the page's cookie).
async function suggestionCount(page, filePath) {
  const r = await page.request.get(BASE_URL + '/api/suggestions/content', { params: { filePath } });
  if (!r.ok()) return -1;
  const j = await r.json();
  return (j.pendingSuggestions || []).length;
}

test.describe('Shared-content editing — P3 (suggest routing to shared files)', () => {
  test('editing BOOK-level shared prose routes the suggestion to commonBook.md', async ({ page }) => {
    await login(page, S5_PATH);
    await enterSuggestMode(page);
    const before = await getDoc(page);
    await cursorAfter(page, 'reads the same in every session');
    await page.keyboard.type(' BOOKEDIT');
    await page.waitForTimeout(400);
    expect(await getDoc(page)).not.toEqual(before); // shared prose IS editable in suggest mode

    await expect.poll(() => suggestionCount(page, BOOK_COMMON), { timeout: 10000 }).toBeGreaterThan(0);
    expect(await suggestionCount(page, S5_FILE)).toBe(0);       // not the session file
    expect(await suggestionCount(page, SERIES_COMMON)).toBe(0); // not the series file
  });

  test('editing SERIES-level shared prose routes the suggestion to commonSeries.md', async ({ page }) => {
    await login(page, S5_PATH);
    await enterSuggestMode(page);
    await cursorAfter(page, 'changes every session in the series');
    await page.keyboard.type(' SERIESEDIT');
    await page.waitForTimeout(400);

    await expect.poll(() => suggestionCount(page, SERIES_COMMON), { timeout: 10000 }).toBeGreaterThan(0);
    expect(await suggestionCount(page, S5_FILE)).toBe(0);
    expect(await suggestionCount(page, BOOK_COMMON)).toBe(0);
  });

  test('a session edit and a shared edit route to their respective files', async ({ page }) => {
    await login(page, S5_PATH);
    await enterSuggestMode(page);
    await cursorAfter(page, 'native session content');
    await page.keyboard.type(' SESS');
    await page.waitForTimeout(300);
    await cursorAfter(page, 'reads the same in every session');
    await page.keyboard.type(' BOOKX');
    await page.waitForTimeout(500);

    await expect.poll(() => suggestionCount(page, S5_FILE), { timeout: 10000 }).toBeGreaterThan(0);
    await expect.poll(() => suggestionCount(page, BOOK_COMMON), { timeout: 10000 }).toBeGreaterThan(0);
  });
});

test.describe('Shared-content editing — P4 (direct edit of the shared file)', () => {
  test('the affordance link opens the common file as a single-file direct edit', async ({ page }) => {
    await login(page, S5_PATH + '?editFile=' + encodeURIComponent(BOOK_COMMON));
    const info = await page.evaluate(() => ({
      editing: window.__EDITOR_DATA.editingSharedFile ? window.__EDITOR_DATA.editingSharedFile.path : null,
      sessionFilePath: window.__EDITOR_DATA.sessionFilePath,
      segments: window.__EDITOR_DATA.segments,
      raw: window.__EDITOR_DATA.rawContent,
    }));
    expect(info.editing).toBe(BOOK_COMMON);
    expect(info.sessionFilePath).toBe(BOOK_COMMON); // edits target the common file
    expect(info.segments).toBeNull();               // single-file: no include resolution
    expect(info.raw).toContain('book-level');
    // back-to-session banner present
    await expect(page.locator('.editor-sharedfile-banner')).toBeVisible();
    // editor auto-opened showing the RAW common file (block tags visible, unresolved)
    await page.waitForSelector('#codemirror-host .cm-editor', { timeout: 10000 });
    await page.waitForTimeout(500);
    const doc = await getDoc(page);
    expect(doc).toContain('TestSharedBookNote');
    expect(doc).toContain('book-level');
  });

  test('series-level shared file also opens for an admin', async ({ page }) => {
    await login(page, S5_PATH + '?editFile=' + encodeURIComponent(SERIES_COMMON));
    const p = await page.evaluate(() => window.__EDITOR_DATA.editingSharedFile ? window.__EDITOR_DATA.editingSharedFile.path : null);
    expect(p).toBe(SERIES_COMMON);
  });

  test('?editFile with an unreadable path does NOT open a shared-file edit', async ({ page }) => {
    await login(page, S5_PATH + '?editFile=' + encodeURIComponent('series/Does Not Exist/commonSeries.md'));
    const info = await page.evaluate(() => ({
      editing: window.__EDITOR_DATA.editingSharedFile,
      // falls back to the normal session edit target
      sessionFilePath: window.__EDITOR_DATA.sessionFilePath,
    }));
    expect(info.editing).toBeNull();
    expect(info.sessionFilePath).toBe(S5_FILE);
  });
});

test.describe('Shared-content editing — endpoint + reconstruction + reload', () => {
  test('GET /api/editor-model returns the resolved buffer, segments, and files with SHAs', async ({ page }) => {
    await login(page, S5_PATH); // establishes the auth cookie in the page context
    const r = await page.request.get(BASE_URL + '/api/editor-model/narrative-journey-series/foundations/test-book/5-session5-includes');
    expect(r.ok()).toBeTruthy();
    const j = await r.json();
    expect(j.resolvedContent).toContain('book-level');
    expect(j.segments.some(s => s.kind === 'shared')).toBeTruthy();
    expect(j.files.map(f => f.level)).toEqual(expect.arrayContaining(['session', 'series', 'book']));
    expect(j.files.every(f => typeof f.sha === 'string')).toBeTruthy();
  });

  test('GET /api/editor-model denies an unauthenticated request', async ({ request }) => {
    const r = await request.get(BASE_URL + '/api/editor-model/narrative-journey-series/foundations/test-book/5-session5-includes');
    // Test Book is hidden, so an anonymous request is refused (404 to avoid
    // revealing it; a visible book would 403). Either way: not authorized.
    expect(r.ok()).toBeFalsy();
    expect([401, 403, 404]).toContain(r.status());
  });

  test('DIRECT-mode save reconstructs the session SOURCE (@include lines), never resolved content', async ({ page }) => {
    await login(page, S5_PATH);
    await enterDirectMode(page);
    let captured = null;
    await page.route('**/api/suggestions/direct-edit', async (route) => {
      captured = route.request().postDataJSON();
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'ok', sha: 'faux-sha' }) });
    });
    await cursorAfter(page, 'native session content');
    await page.keyboard.type(' RECON');
    await page.waitForTimeout(300);
    await page.click('#btn-editor-done');
    await page.waitForSelector('#commit-modal', { state: 'visible' });
    await page.click('#commit-confirm');
    await expect.poll(() => captured, { timeout: 8000 }).not.toBeNull();
    expect(captured.filePath).toBe(S5_FILE);                       // writes to the SESSION file
    expect(captured.content).toContain('<!-- @include: TestSharedBookNote'); // directive re-emitted
    expect(captured.content).toContain('RECON');                   // session edit preserved
    expect(captured.content).not.toContain('reads the same in every session'); // book prose NOT inlined
  });

  test('a shared-file suggestion reloads mapped into the buffer', async ({ page }) => {
    await login(page, S5_PATH);
    await enterSuggestMode(page);
    await cursorAfter(page, 'reads the same in every session');
    await page.keyboard.type(' ANCHORX');
    await page.waitForTimeout(400);
    await expect.poll(() => suggestionCount(page, BOOK_COMMON), { timeout: 10000 }).toBeGreaterThan(0);
    // reload — the shared suggestion should come back materialized in the buffer
    await page.goto(BASE_URL + S5_PATH);
    await enterSuggestMode(page);
    await expect.poll(async () => (await getDoc(page)) || '', { timeout: 8000 }).toContain('ANCHORX');
  });
});
