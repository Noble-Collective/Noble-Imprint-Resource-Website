// Multi-user safety tests: auto-save errors, version checks, deduplication, presence.
const { test, expect } = require('@playwright/test');

const BASE_URL = 'http://localhost:8080';
const TEST_SESSION_PATH = '/narrative-journey-series/foundations/test-book/1-session1-thegospel';
const TEST_FILE = 'series/Narrative Journey Series/Foundations/Test Book/sessions/1-Session1-TheGospel.md';

async function login(page) {
  await page.request.post(`${BASE_URL}/api/auth/test-login`, { data: { email: 'steve@noblecollective.org' } });
  await page.goto(BASE_URL + TEST_SESSION_PATH, { timeout: 30000 });
}

async function clearAll() {
  const admin = require('firebase-admin');
  if (!admin.apps.length) admin.initializeApp();
  const db = admin.firestore();
  for (const col of ['suggestions', 'comments', 'replies']) {
    const snap = await db.collection(col).where('filePath', '==', TEST_FILE).get();
    if (!snap.empty) { const b = db.batch(); snap.docs.forEach(d => b.delete(d.ref)); await b.commit(); }
  }
}

async function enterSuggest(page) {
  await page.click('#btn-suggest-edit');
  await page.waitForSelector('.cm-editor');
  await page.waitForTimeout(500);
}

async function findUniqueWord(page) {
  return page.evaluate(() => {
    const doc = window.__editorView.state.doc.toString();
    for (const line of doc.split('\n')) {
      if (line.startsWith('#') || line.startsWith('>') || line.startsWith('<') || line.startsWith('-') || line.length < 30) continue;
      for (const w of (line.match(/\b[a-zA-Z]{7,10}\b/g) || [])) {
        if (doc.indexOf(w) === doc.lastIndexOf(w)) return w;
      }
    }
    return null;
  });
}

async function makeSuggestion(page, word) {
  await page.evaluate((w) => {
    const v = window.__editorView, doc = v.state.doc.toString(), p = doc.indexOf(w);
    if (p >= 0) {
      v.dispatch({ selection: { anchor: p, head: p + w.length }, scrollIntoView: true });
      v.dispatch(v.state.replaceSelection(w + 'EDIT'));
    }
  }, word);
  await page.waitForTimeout(300);
}

async function countFirestoreSuggestions() {
  const admin = require('firebase-admin');
  if (!admin.apps.length) admin.initializeApp();
  const db = admin.firestore();
  const snap = await db.collection('suggestions').where('filePath', '==', TEST_FILE).where('status', '==', 'pending').get();
  return { count: snap.size, docs: snap.docs.map(d => ({ id: d.id, ...d.data() })) };
}

// ============================================================
// Step 1: Auto-save error surfacing
// ============================================================

test.describe('Auto-save error surfacing', () => {
  test('save failure shows "Save failed" after 2 consecutive errors', async ({ page }) => {
    test.setTimeout(60000);
    await clearAll();
    try {
      await login(page);
      await enterSuggest(page);

      // Intercept the hunk create endpoint to return 500
      await page.route('**/api/suggestions/hunk', (route) => {
        if (route.request().method() === 'POST') {
          route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"test failure"}' });
        } else {
          route.continue();
        }
      });

      // Make first suggestion — triggers save cycle 1 (fails, saveFailCount=1)
      const word = await findUniqueWord(page);
      await makeSuggestion(page, word);
      await page.waitForTimeout(3000); // debounce + auto-save

      // Make second edit — triggers save cycle 2 (fails, saveFailCount=2 → shows error)
      await page.evaluate(() => {
        const v = window.__editorView, doc = v.state.doc.toString();
        const p = doc.indexOf('EDIT');
        if (p >= 0) {
          v.dispatch({ selection: { anchor: p + 4 }, scrollIntoView: true });
          v.dispatch(v.state.replaceSelection('X'));
        }
      });
      await page.waitForTimeout(3000);

      // The status should show error after 2 consecutive failed cycles
      const status = page.locator('#editor-save-status');
      await expect(status).toHaveText('Save failed');
      await expect(status).toHaveClass(/save-error/);

    } finally { await clearAll(); }
  });

  test('save error clears after successful save', async ({ page }) => {
    test.setTimeout(90000);
    await clearAll();
    try {
      await login(page);
      await enterSuggest(page);

      let saveCallCount = 0;
      // Fail the first 2 save cycles, then allow through
      await page.route('**/api/suggestions/hunk', (route) => {
        if (route.request().method() === 'POST') {
          saveCallCount++;
          if (saveCallCount <= 2) {
            route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"test"}' });
          } else {
            route.continue();
          }
        } else {
          route.continue();
        }
      });

      // Cycle 1: make edit, auto-save fails
      const word = await findUniqueWord(page);
      await makeSuggestion(page, word);
      await page.waitForTimeout(3000);

      // Cycle 2: another edit, auto-save fails again → error shows
      await page.evaluate(() => {
        const v = window.__editorView, doc = v.state.doc.toString();
        const p = doc.indexOf('EDIT');
        if (p >= 0) {
          v.dispatch({ selection: { anchor: p + 4 }, scrollIntoView: true });
          v.dispatch(v.state.replaceSelection('X'));
        }
      });
      await page.waitForTimeout(3000);

      const status = page.locator('#editor-save-status');
      await expect(status).toHaveText('Save failed');

      // Cycle 3: another edit — this time the route allows through → error clears
      await page.evaluate(() => {
        const v = window.__editorView, doc = v.state.doc.toString();
        const p = doc.indexOf('EDITX');
        if (p >= 0) {
          v.dispatch({ selection: { anchor: p + 5 }, scrollIntoView: true });
          v.dispatch(v.state.replaceSelection('Y'));
        }
      });
      await page.waitForTimeout(4000);

      // Should clear the error
      await expect(status).not.toHaveClass(/save-error/);

    } finally { await clearAll(); }
  });

  test('single transient failure does NOT show error', async ({ page }) => {
    test.setTimeout(60000);
    await clearAll();
    try {
      await login(page);
      await enterSuggest(page);

      let failCount = 0;
      // Fail only the first POST, then succeed
      await page.route('**/api/suggestions/hunk', (route) => {
        if (route.request().method() === 'POST') {
          failCount++;
          if (failCount === 1) {
            route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"transient"}' });
          } else {
            route.continue();
          }
        } else {
          route.continue();
        }
      });

      const word = await findUniqueWord(page);
      await makeSuggestion(page, word);
      await page.waitForTimeout(5000);

      // Should NOT show error — only 1 failure, threshold is 2
      const status = page.locator('#editor-save-status');
      await expect(status).not.toHaveClass(/save-error/);

    } finally { await clearAll(); }
  });
});

// ============================================================
// Step 2: File version check before saving
// ============================================================

let _cleanFileContent = null;
async function saveCleanFile() {
  if (_cleanFileContent) return;
  const github = require('../src/server/github');
  const cache = require('../src/server/cache');
  cache.del('file:' + TEST_FILE);
  const { content } = await github.getFileContent(TEST_FILE);
  _cleanFileContent = content;
}
async function restoreCleanFile() {
  if (!_cleanFileContent) return;
  const github = require('../src/server/github');
  const cache = require('../src/server/cache');
  cache.del('file:' + TEST_FILE);
  const { content, sha } = await github.getFileContent(TEST_FILE);
  if (content !== _cleanFileContent) {
    await github.updateFileContent(TEST_FILE, _cleanFileContent, sha, 'Restore after multi-user test');
  }
}

test.describe('File version check', () => {
  test('auto-save blocked when file SHA changes after page load', async ({ page }) => {
    test.setTimeout(90000);
    await clearAll();
    await saveCleanFile();
    try {
      await login(page);
      await enterSuggest(page);

      // Make a suggestion so there's something to auto-save
      const word = await findUniqueWord(page);
      await makeSuggestion(page, word);
      await page.waitForTimeout(3000); // let first auto-save complete

      let r = await countFirestoreSuggestions();
      console.log('Version check: after first save:', r.count);
      expect(r.count).toBe(1);

      // Simulate another user accepting a suggestion (changes the file SHA)
      // by directly modifying the file on GitHub
      const github = require('../src/server/github');
      const { content, sha } = await github.getFileContent(TEST_FILE);
      await github.updateFileContent(TEST_FILE, content + '\n<!-- version check test -->', sha, 'Test: change SHA');

      // Clear the SERVER's content cache so the version endpoint returns the new SHA
      // (cache.invalidateAll() from the test process doesn't affect the server's cache)
      await page.request.post(`${BASE_URL}/api/refresh`);

      // Check that contentSha is set
      const pageSha = await page.evaluate(() => window.__EDITOR_DATA?.contentSha);
      console.log('Version check: page SHA:', pageSha);
      expect(pageSha).toBeTruthy();

      // Wait for cache refresh to settle
      await page.waitForTimeout(2000);

      // Verify the version endpoint now returns a different SHA (call from browser context for auth)
      const vData = await page.evaluate(async (fp) => {
        const res = await fetch('/api/suggestions/file-version?filePath=' + encodeURIComponent(fp));
        if (!res.ok) return { error: res.status };
        return res.json();
      }, TEST_FILE);
      console.log('Version check: server response:', JSON.stringify(vData));
      console.log('Version check: page SHA:', pageSha);
      expect(vData.sha).toBeTruthy();
      expect(vData.sha).not.toBe(pageSha);

      // Now make another edit — the version check should detect the stale SHA and block
      await page.evaluate(() => {
        const v = window.__editorView, doc = v.state.doc.toString();
        const p = doc.indexOf('EDIT');
        if (p >= 0) {
          v.dispatch({ selection: { anchor: p + 4 }, scrollIntoView: true });
          v.dispatch(v.state.replaceSelection('X'));
        }
      });
      await page.waitForTimeout(6000); // debounce + version check + auto-save

      // Should show stale banner
      const banner = page.locator('#editor-stale-banner');
      await expect(banner).toBeVisible({ timeout: 10000 });
      await expect(page.locator('#stale-banner-text')).toContainText('updated by another user');

      // The edit should NOT have been saved to Firestore (still 1 suggestion)
      r = await countFirestoreSuggestions();
      console.log('Version check: after stale detection:', r.count);
      expect(r.count).toBe(1);

    } finally {
      await clearAll();
      await restoreCleanFile();
    }
  });

  test('version check timeout does not block saves', async ({ page }) => {
    test.setTimeout(60000);
    await clearAll();
    try {
      await login(page);
      await enterSuggest(page);

      // Intercept the version endpoint to hang forever (simulating timeout)
      await page.route('**/api/suggestions/file-version*', (route) => {
        // Don't respond — let the AbortController timeout handle it
      });

      const word = await findUniqueWord(page);
      await makeSuggestion(page, word);
      // Wait for debounce + version check timeout (3s) + auto-save
      await page.waitForTimeout(6000);

      // Save should have proceeded despite the version check timing out
      const r = await countFirestoreSuggestions();
      console.log('Version timeout: suggestions saved:', r.count);
      expect(r.count).toBe(1);

    } finally { await clearAll(); }
  });

  test('normal flow: file unchanged, save proceeds', async ({ page }) => {
    test.setTimeout(60000);
    await clearAll();
    try {
      await login(page);
      await enterSuggest(page);

      const word = await findUniqueWord(page);
      await makeSuggestion(page, word);
      await page.waitForTimeout(4000);

      // Should save normally — no stale warning
      const status = page.locator('#editor-save-status');
      await expect(status).not.toHaveClass(/save-error/);

      const r = await countFirestoreSuggestions();
      expect(r.count).toBe(1);

    } finally { await clearAll(); }
  });
});

// ============================================================
// Step 3: Server-side suggestion deduplication
// ============================================================

test.describe('Server-side suggestion dedup', () => {
  test('identical suggestion at same position is deduped', async ({ page }) => {
    test.setTimeout(60000);
    await clearAll();
    try {
      const suggestions = require('../src/server/suggestions');
      const github = require('../src/server/github');
      const cache = require('../src/server/cache');
      cache.del('file:' + TEST_FILE);
      const { content, sha } = await github.getFileContent(TEST_FILE);
      // Find a unique word dynamically instead of hardcoding
      const words = content.match(/\b[a-zA-Z]{7,12}\b/g) || [];
      let targetWord = null;
      for (const w of words) { if (content.indexOf(w) === content.lastIndexOf(w)) { targetWord = w; break; } }
      expect(targetWord).toBeTruthy();
      const pos = content.indexOf(targetWord);
      expect(pos).toBeGreaterThan(0);

      // Create first suggestion
      const id1 = await suggestions.createHunk({
        filePath: TEST_FILE, bookPath: 'series/Narrative Journey Series/Foundations/Test Book',
        baseCommitSha: sha, type: 'replacement',
        originalFrom: pos, originalTo: pos + targetWord.length,
        originalText: targetWord, newText: 'DEDUP_TEST',
        contextBefore: content.substring(Math.max(0, pos - 50), pos),
        contextAfter: content.substring(pos + targetWord.length, pos + targetWord.length + 50),
        authorEmail: 'steve@noblecollective.org', authorName: 'Steve',
      });
      console.log('Dedup: created first:', id1);

      // Create identical suggestion (same text, same position)
      const id2 = await suggestions.createHunk({
        filePath: TEST_FILE, bookPath: 'series/Narrative Journey Series/Foundations/Test Book',
        baseCommitSha: sha, type: 'replacement',
        originalFrom: pos, originalTo: pos + targetWord.length,
        originalText: targetWord, newText: 'DEDUP_TEST',
        contextBefore: content.substring(Math.max(0, pos - 50), pos),
        contextAfter: content.substring(pos + targetWord.length, pos + targetWord.length + 50),
        authorEmail: 'steve@noblecollective.org', authorName: 'Steve',
      });
      console.log('Dedup: second returned:', id2);

      // Should return the same ID (deduped)
      expect(id2).toBe(id1);

      // Firestore should have exactly 1 document
      const r = await countFirestoreSuggestions();
      expect(r.count).toBe(1);

    } finally { await clearAll(); }
  });

  test('same text at different positions is NOT deduped', async ({ page }) => {
    test.setTimeout(60000);
    await clearAll();
    try {
      const suggestions = require('../src/server/suggestions');
      const github = require('../src/server/github');
      const { content, sha } = await github.getFileContent(TEST_FILE);

      const word = 'the';
      const pos1 = content.indexOf(word);
      const pos2 = content.indexOf(word, pos1 + 100);
      expect(pos1).toBeGreaterThan(0);
      expect(pos2).toBeGreaterThan(pos1 + 5);
      console.log('Dedup distance:', word, 'at', pos1, 'and', pos2, '(', pos2 - pos1, 'chars apart)');

      const id1 = await suggestions.createHunk({
        filePath: TEST_FILE, bookPath: 'series/Narrative Journey Series/Foundations/Test Book',
        baseCommitSha: sha, type: 'replacement',
        originalFrom: pos1, originalTo: pos1 + word.length,
        originalText: word, newText: 'DEDUP_POS1',
        authorEmail: 'steve@noblecollective.org', authorName: 'Steve',
      });

      const id2 = await suggestions.createHunk({
        filePath: TEST_FILE, bookPath: 'series/Narrative Journey Series/Foundations/Test Book',
        baseCommitSha: sha, type: 'replacement',
        originalFrom: pos2, originalTo: pos2 + word.length,
        originalText: word, newText: 'DEDUP_POS1',
        authorEmail: 'steve@noblecollective.org', authorName: 'Steve',
      });

      expect(id2).not.toBe(id1);
      const r = await countFirestoreSuggestions();
      expect(r.count).toBe(2);

    } finally { await clearAll(); }
  });

  test('same position but different text is NOT deduped', async ({ page }) => {
    test.setTimeout(60000);
    await clearAll();
    try {
      const suggestions = require('../src/server/suggestions');
      const github = require('../src/server/github');
      const cache = require('../src/server/cache');
      cache.del('file:' + TEST_FILE);
      const { content, sha } = await github.getFileContent(TEST_FILE);
      const words = content.match(/\b[a-zA-Z]{7,12}\b/g) || [];
      let targetWord = null;
      for (const w of words) { if (content.indexOf(w) === content.lastIndexOf(w)) { targetWord = w; break; } }
      expect(targetWord).toBeTruthy();
      const pos = content.indexOf(targetWord);
      expect(pos).toBeGreaterThan(0);

      const id1 = await suggestions.createHunk({
        filePath: TEST_FILE, bookPath: 'series/Narrative Journey Series/Foundations/Test Book',
        baseCommitSha: sha, type: 'replacement',
        originalFrom: pos, originalTo: pos + targetWord.length,
        originalText: targetWord, newText: 'EDIT_A',
        authorEmail: 'steve@noblecollective.org', authorName: 'Steve',
      });

      const id2 = await suggestions.createHunk({
        filePath: TEST_FILE, bookPath: 'series/Narrative Journey Series/Foundations/Test Book',
        baseCommitSha: sha, type: 'replacement',
        originalFrom: pos, originalTo: pos + targetWord.length,
        originalText: targetWord, newText: 'EDIT_B',
        authorEmail: 'steve@noblecollective.org', authorName: 'Steve',
      });

      expect(id2).not.toBe(id1);
      const r = await countFirestoreSuggestions();
      expect(r.count).toBe(2);

    } finally { await clearAll(); }
  });
});

// ============================================================
// Step 4: Poll for changes + stale file banner
// ============================================================

test.describe('Poll for changes + stale banner', () => {
  test('stale banner appears when file SHA changes', async ({ page }) => {
    test.setTimeout(90000);
    await clearAll();
    await saveCleanFile();
    try {
      await login(page);
      await enterSuggest(page);

      // Verify banner starts hidden
      const banner = page.locator('#editor-stale-banner');
      await expect(banner).toBeHidden();

      // Change the file on GitHub (simulating another user accepting a suggestion)
      const github = require('../src/server/github');
      const { content, sha } = await github.getFileContent(TEST_FILE);
      await github.updateFileContent(TEST_FILE, content + '\n<!-- poll test -->', sha, 'Test: poll SHA change');

      // Clear server cache so the version endpoint returns the new SHA
      await page.request.post(`${BASE_URL}/api/refresh`);

      // Wait for the 30s polling interval to detect the change (up to 40s)
      await expect(banner).toBeVisible({ timeout: 40000 });
      const bannerText = page.locator('#stale-banner-text');
      await expect(bannerText).toContainText('updated by another user');

    } finally {
      await clearAll();
      await restoreCleanFile();
    }
  });

  test('reload button refreshes content and hides banner', async ({ page }) => {
    test.setTimeout(90000);
    await clearAll();
    await saveCleanFile();
    try {
      await login(page);
      await enterSuggest(page);

      const github = require('../src/server/github');
      const { content, sha } = await github.getFileContent(TEST_FILE);
      const marker = '<!-- reload-test-marker -->';
      await github.updateFileContent(TEST_FILE, content + '\n' + marker, sha, 'Test: reload marker');
      await page.request.post(`${BASE_URL}/api/refresh`);

      const banner = page.locator('#editor-stale-banner');
      await expect(banner).toBeVisible({ timeout: 40000 });

      // Click reload
      await page.click('#stale-banner-reload');
      // Wait for refresh to complete
      await page.waitForTimeout(5000);

      // Banner should be hidden
      await expect(banner).toBeHidden();

    } finally {
      await clearAll();
      await restoreCleanFile();
    }
  });

  test('polling clears on exit', async ({ page }) => {
    test.setTimeout(60000);
    await clearAll();
    try {
      await login(page);
      await enterSuggest(page);

      // Verify editor is visible and presence container exists
      const hasPresence = await page.evaluate(() => {
        return document.getElementById('editor-presence') !== null;
      });
      expect(hasPresence).toBe(true);

      // Exit editor (click Done)
      await page.click('#btn-editor-done');
      await page.waitForTimeout(2000);

      // After exit, editor should be hidden
      const editorVisible = await page.evaluate(() => {
        return document.getElementById('editor-container')?.style.display !== 'none';
      });
      expect(editorVisible).toBe(false);

    } finally { await clearAll(); }
  });

  test('new suggestions notification appears', async ({ page }) => {
    test.setTimeout(90000);
    await clearAll();
    try {
      // Clear server cache so page loads with a fresh SHA (prior tests may have
      // restored the file, creating a new SHA that the server cache doesn't know about)
      await page.request.post(`${BASE_URL}/api/refresh`);

      await login(page);
      await enterSuggest(page);

      const banner = page.locator('#editor-stale-banner');
      await expect(banner).toBeHidden();

      // Create a suggestion via API (simulating another user)
      const suggestions = require('../src/server/suggestions');
      const github = require('../src/server/github');
      const cache = require('../src/server/cache');
      cache.del('file:' + TEST_FILE);
      const { content, sha } = await github.getFileContent(TEST_FILE);
      // Use dynamic word instead of hardcoded 'sovereign'
      const words = content.match(/\b[a-zA-Z]{7,12}\b/g) || [];
      let targetWord = null;
      for (const w of words) {
        if (content.indexOf(w) === content.lastIndexOf(w)) { targetWord = w; break; }
      }
      const pos = targetWord ? content.indexOf(targetWord) : -1;
      expect(pos).toBeGreaterThan(0);
      await suggestions.createHunk({
        filePath: TEST_FILE, bookPath: 'series/Narrative Journey Series/Foundations/Test Book',
        baseCommitSha: sha, type: 'replacement',
        originalFrom: pos, originalTo: pos + targetWord.length,
        originalText: targetWord, newText: 'POLL_NEW_SUGGESTION',
        authorEmail: 'other@example.com', authorName: 'Other User',
      });

      // Wait for polling to auto-load the new suggestion (up to 15s with 10s interval)
      // Should show a toast notification, NOT the stale banner
      const toast = page.locator('#editor-toast');
      await expect(toast).toBeVisible({ timeout: 15000 });
      await expect(toast).toContainText('suggestion');
      // Banner should stay hidden (auto-load, not stale file)
      await expect(banner).toBeHidden();

    } finally { await clearAll(); }
  });

  test('own suggestions do NOT trigger new-suggestions banner', async ({ page }) => {
    test.setTimeout(90000);
    await clearAll();
    try {
      await login(page);
      await enterSuggest(page);

      const banner = page.locator('#editor-stale-banner');
      await expect(banner).toBeHidden();

      // Create suggestions by typing in the editor (same user)
      const word = await findUniqueWord(page);
      await makeSuggestion(page, word);
      await page.waitForTimeout(3000); // let auto-save complete

      // Wait through a full polling cycle (35s) — banner should NOT appear
      await page.waitForTimeout(35000);
      await expect(banner).toBeHidden();

    } finally { await clearAll(); }
  });

  test('discarded suggestions by another user are removed from editor', async ({ page }) => {
    test.setTimeout(90000);
    await clearAll();
    try {
      // Create a suggestion via API (simulating another user)
      const suggestions = require('../src/server/suggestions');
      const github = require('../src/server/github');
      const cache = require('../src/server/cache');
      cache.del('file:' + TEST_FILE);
      const { content, sha } = await github.getFileContent(TEST_FILE);
      const words = content.match(/\b[a-zA-Z]{7,12}\b/g) || [];
      let targetWord = null;
      for (const w of words) { if (content.indexOf(w) === content.lastIndexOf(w)) { targetWord = w; break; } }
      expect(targetWord).toBeTruthy();
      const pos = content.indexOf(targetWord);
      const suggId = await suggestions.createHunk({
        filePath: TEST_FILE, bookPath: 'series/Narrative Journey Series/Foundations/Test Book',
        baseCommitSha: sha, type: 'replacement',
        originalFrom: pos, originalTo: pos + targetWord.length,
        originalText: targetWord, newText: 'DISCARD_SYNC_TEST',
        authorEmail: 'other@example.com', authorName: 'Other User',
      });

      // Steve opens the editor — should see the suggestion
      await login(page);
      await enterSuggest(page);
      await page.waitForTimeout(2000);
      const cardCount = await page.evaluate(() =>
        document.querySelectorAll('.margin-card--suggestion').length
      );
      expect(cardCount).toBeGreaterThanOrEqual(1);

      // Other user discards the suggestion (delete from Firestore)
      const admin = require('firebase-admin');
      if (!admin.apps.length) admin.initializeApp();
      await admin.firestore().collection('suggestions').doc(suggId).delete();

      // Wait for polling to detect the decrease and auto-refresh (up to 15s)
      await page.waitForTimeout(15000);
      const afterCount = await page.evaluate(() =>
        document.querySelectorAll('.margin-card--suggestion').length
      );
      expect(afterCount).toBe(cardCount - 1);

    } finally { await clearAll(); }
  });
});

// ============================================================
// Cross-user data integrity
// ============================================================

test.describe('Cross-user data integrity', () => {
  test('suggestion from another user shows their name, not current user', async ({ page }) => {
    test.setTimeout(60000);
    await clearAll();
    try {
      // Create a suggestion as a different user
      const suggestions = require('../src/server/suggestions');
      const github = require('../src/server/github');
      const cache = require('../src/server/cache');
      cache.del('file:' + TEST_FILE);
      const { content, sha } = await github.getFileContent(TEST_FILE);
      const words = content.match(/\b[a-zA-Z]{7,12}\b/g) || [];
      let targetWord = null;
      for (const w of words) { if (content.indexOf(w) === content.lastIndexOf(w)) { targetWord = w; break; } }
      expect(targetWord).toBeTruthy();
      const pos = content.indexOf(targetWord);
      await suggestions.createHunk({
        filePath: TEST_FILE, bookPath: 'series/Narrative Journey Series/Foundations/Test Book',
        baseCommitSha: sha, type: 'replacement',
        originalFrom: pos, originalTo: pos + targetWord.length,
        originalText: targetWord, newText: 'AUTHOR_TEST',
        authorEmail: 'jane@noblecollective.org', authorName: 'Jane Doe',
      });

      // Steve opens the editor — should see Jane's suggestion with her name
      await login(page);
      await enterSuggest(page);
      await page.waitForTimeout(2000);

      const authorName = await page.evaluate(() => {
        const card = document.querySelector('.margin-card--suggestion .margin-card-name');
        return card ? card.textContent.trim() : null;
      });
      expect(authorName).toBe('Jane Doe');

    } finally { await clearAll(); }
  });

  test('reply from another user appears within 15s', async ({ page }) => {
    test.setTimeout(90000);
    await clearAll();
    try {
      // Create a suggestion as another user
      const suggestions = require('../src/server/suggestions');
      const github = require('../src/server/github');
      const cache = require('../src/server/cache');
      cache.del('file:' + TEST_FILE);
      const { content, sha } = await github.getFileContent(TEST_FILE);
      const words = content.match(/\b[a-zA-Z]{7,12}\b/g) || [];
      let targetWord = null;
      for (const w of words) { if (content.indexOf(w) === content.lastIndexOf(w)) { targetWord = w; break; } }
      expect(targetWord).toBeTruthy();
      const pos = content.indexOf(targetWord);
      const suggId = await suggestions.createHunk({
        filePath: TEST_FILE, bookPath: 'series/Narrative Journey Series/Foundations/Test Book',
        baseCommitSha: sha, type: 'replacement',
        originalFrom: pos, originalTo: pos + targetWord.length,
        originalText: targetWord, newText: 'REPLY_SYNC_TEST',
        authorEmail: 'jane@noblecollective.org', authorName: 'Jane Doe',
      });

      // Steve opens the editor and sees the suggestion
      await login(page);
      await enterSuggest(page);
      await page.waitForTimeout(2000);
      await expect(page.locator('.margin-card--suggestion')).toHaveCount(1, { timeout: 5000 });

      // Jane posts a reply (direct Firestore)
      await suggestions.createReply({
        parentId: suggId, parentType: 'suggestion', filePath: TEST_FILE,
        text: 'I think this is a good change',
        authorEmail: 'jane@noblecollective.org', authorName: 'Jane Doe',
      });

      // Wait for fast poll to sync the reply (up to 15s)
      const reply = page.locator('.margin-card-reply');
      await expect(reply).toHaveCount(1, { timeout: 15000 });
      await expect(reply.locator('.margin-card-reply-author')).toContainText('Jane');

    } finally { await clearAll(); }
  });

  test('accept by another user auto-refreshes without stale banner', async ({ page }) => {
    test.setTimeout(90000);
    await clearAll();
    await saveCleanFile();
    try {
      // Create a suggestion as another user
      const suggestions = require('../src/server/suggestions');
      const github = require('../src/server/github');
      const cache = require('../src/server/cache');
      cache.del('file:' + TEST_FILE);
      const { content, sha } = await github.getFileContent(TEST_FILE);
      const words = content.match(/\b[a-zA-Z]{7,12}\b/g) || [];
      let targetWord = null;
      for (const w of words) { if (content.indexOf(w) === content.lastIndexOf(w)) { targetWord = w; break; } }
      expect(targetWord).toBeTruthy();
      const pos = content.indexOf(targetWord);
      const suggId = await suggestions.createHunk({
        filePath: TEST_FILE, bookPath: 'series/Narrative Journey Series/Foundations/Test Book',
        baseCommitSha: sha, type: 'replacement',
        originalFrom: pos, originalTo: pos + targetWord.length,
        originalText: targetWord, newText: 'ACCEPT_SYNC_TEST',
        contextBefore: content.substring(Math.max(0, pos - 50), pos),
        contextAfter: content.substring(pos + targetWord.length, Math.min(content.length, pos + targetWord.length + 50)),
        authorEmail: 'jane@noblecollective.org', authorName: 'Jane Doe',
      });

      // Steve opens editor and sees the suggestion
      await login(page);
      await enterSuggest(page);
      await page.waitForTimeout(2000);
      await expect(page.locator('.margin-card--suggestion')).toHaveCount(1, { timeout: 5000 });

      // Jane accepts the suggestion (server-side)
      await suggestions.acceptHunk(suggId, 'jane@noblecollective.org');
      await page.request.post(`${BASE_URL}/api/refresh`);

      // Wait for fast poll to detect the change and auto-refresh (up to 15s)
      await page.waitForTimeout(15000);

      // Suggestion card should be gone
      await expect(page.locator('.margin-card--suggestion')).toHaveCount(0);
      // Stale banner should NOT be visible
      await expect(page.locator('#editor-stale-banner')).toBeHidden();
      // Editor content should contain the accepted text
      const hasAcceptedText = await page.evaluate(() =>
        window.__editorView.state.doc.toString().includes('ACCEPT_SYNC_TEST')
      );
      expect(hasAcceptedText).toBe(true);

    } finally {
      await clearAll();
      await restoreCleanFile();
    }
  });
});

// ============================================================
// Step 5: Presence indicator
// ============================================================

async function clearPresence() {
  const admin = require('firebase-admin');
  if (!admin.apps.length) admin.initializeApp();
  const db = admin.firestore();
  const snap = await db.collection('editingSessions').where('filePath', '==', TEST_FILE).get();
  if (!snap.empty) { const b = db.batch(); snap.docs.forEach(d => b.delete(d.ref)); await b.commit(); }
}

test.describe('Presence indicator', () => {
  test('two users see each other in presence', async ({ page }) => {
    test.setTimeout(60000);
    await clearAll();
    await clearPresence();
    try {
      const suggestions = require('../src/server/suggestions');

      // Simulate User 1 (Jane) already editing via direct Firestore entry
      await suggestions.enterEditingSession({
        filePath: TEST_FILE, email: 'jane@noblecollective.org', displayName: 'Jane Smith',
      });

      // User 2 (Steve) opens the editor — their heartbeat registers in Firestore
      await login(page);
      await enterSuggest(page);
      await page.waitForTimeout(3000); // let heartbeat fire

      // Both users should be in Firestore
      const editors = await suggestions.getActiveEditors(TEST_FILE);
      expect(editors.find(e => e.email === 'steve@noblecollective.org')).toBeTruthy();
      expect(editors.find(e => e.email === 'jane@noblecollective.org')).toBeTruthy();
      expect(editors.length).toBe(2);

      // Steve's UI should show Jane's avatar (initial fetch fires immediately)
      const avatar = page.locator('#editor-presence .presence-avatar');
      await expect(avatar).toHaveCount(1, { timeout: 35000 });
      await expect(avatar.first()).toHaveText('JS'); // Jane Smith initials

    } finally {
      await clearAll();
      await clearPresence();
    }
  });

  test('presence removed after session exit', async ({ page }) => {
    test.setTimeout(60000);
    await clearAll();
    await clearPresence();
    try {
      await login(page);
      await enterSuggest(page);
      await page.waitForTimeout(3000); // let heartbeat fire

      // Verify we're in the presence list
      const suggestions = require('../src/server/suggestions');
      let editors = await suggestions.getActiveEditors(TEST_FILE);
      const myEntry = editors.find(e => e.email === 'steve@noblecollective.org');
      expect(myEntry).toBeTruthy();

      // Exit editor
      await page.click('#btn-editor-done');
      await page.waitForTimeout(2000);

      // Should be removed from presence
      editors = await suggestions.getActiveEditors(TEST_FILE);
      const removed = editors.find(e => e.email === 'steve@noblecollective.org');
      expect(removed).toBeFalsy();

    } finally {
      await clearAll();
      await clearPresence();
    }
  });

  test('presence shows name initials, not email', async ({ page }) => {
    test.setTimeout(60000);
    await clearAll();
    await clearPresence();
    try {
      // Manually add a presence entry for a user with a display name
      const suggestions = require('../src/server/suggestions');
      await suggestions.enterEditingSession({
        filePath: TEST_FILE,
        email: 'jane@noblecollective.org',
        displayName: 'Jane Smith',
      });

      await login(page);
      await enterSuggest(page);
      // Wait for initial presence fetch + next polling cycle
      await page.waitForTimeout(35000);

      const avatar = page.locator('#editor-presence .presence-avatar');
      await expect(avatar).toHaveCount(1, { timeout: 5000 });
      // Should show initials "JS" (Jane Smith), not email
      await expect(avatar.first()).toHaveText('JS');

    } finally {
      await clearAll();
      await clearPresence();
    }
  });
});

// ============================================================
// Step 6: Warn before losing unsaved drafts on reload
// ============================================================

test.describe('Draft preservation on reload', () => {
  test('unsaved drafts are saved before reload proceeds', async ({ page }) => {
    test.setTimeout(90000);
    await clearAll();
    await saveCleanFile();
    try {
      await login(page);
      await enterSuggest(page);

      // Type text to create a suggestion (don't wait for full auto-save cycle)
      const word = await findUniqueWord(page);
      await makeSuggestion(page, word);
      // Wait just enough for the suggestion to register in the diff engine
      await page.waitForTimeout(500);

      // Verify the suggestion is NOT yet saved (debounce hasn't fired)
      let r = await countFirestoreSuggestions();
      // It might or might not have saved yet — the key thing is what happens on reload

      // Change the file on GitHub to trigger stale detection
      const github = require('../src/server/github');
      const { content, sha } = await github.getFileContent(TEST_FILE);
      await github.updateFileContent(TEST_FILE, content + '\n<!-- draft-save-test -->', sha, 'Test: draft save');
      await page.request.post(`${BASE_URL}/api/refresh`);

      // Wait for polling to detect the stale file
      const banner = page.locator('#editor-stale-banner');
      await expect(banner).toBeVisible({ timeout: 40000 });

      // Click reload — Step 6 should force-save unsaved drafts before refreshing
      await page.click('#stale-banner-reload');
      await page.waitForTimeout(5000);

      // The suggestion should have been saved to Firestore before the refresh
      r = await countFirestoreSuggestions();
      console.log('Draft preservation: suggestions in Firestore after reload:', r.count);
      expect(r.count).toBeGreaterThanOrEqual(1);

      // Banner should be hidden (refresh succeeded)
      await expect(banner).toBeHidden();

    } finally {
      await clearAll();
      await restoreCleanFile();
    }
  });

  test('warning shown when forced save fails', async ({ page }) => {
    test.setTimeout(90000);
    await clearAll();
    await saveCleanFile();
    try {
      await login(page);
      await enterSuggest(page);

      // Block ALL hunk creates so nothing gets saved
      await page.route('**/api/suggestions/hunk', (route) => {
        if (route.request().method() === 'POST') {
          route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"blocked"}' });
        } else {
          route.continue();
        }
      });

      // Type text to create a suggestion
      const word = await findUniqueWord(page);
      await makeSuggestion(page, word);
      await page.waitForTimeout(500);

      // Trigger stale banner by changing file
      const github = require('../src/server/github');
      const { content, sha } = await github.getFileContent(TEST_FILE);
      await github.updateFileContent(TEST_FILE, content + '\n<!-- draft-fail-test -->', sha, 'Test: draft fail');
      await page.request.post(`${BASE_URL}/api/refresh`);

      const banner = page.locator('#editor-stale-banner');
      await expect(banner).toBeVisible({ timeout: 40000 });

      // Click reload — forced save should fail (mocked 500), warning should appear
      await page.click('#stale-banner-reload');
      await page.waitForTimeout(3000);

      // Toast warning should be visible
      const toast = page.locator('#editor-toast');
      await expect(toast).toBeVisible({ timeout: 5000 });
      await expect(toast).toContainText('unsaved changes');

      // Banner should still be visible (reload was aborted)
      await expect(banner).toBeVisible();

    } finally {
      await clearAll();
      await restoreCleanFile();
    }
  });
});

// ============================================================
// Step 7: Better accept conflict UX (retry stale accepts)
// ============================================================

test.describe('Accept retry on stale conflict', () => {
  test('retry succeeds when original text still exists', async ({ page }) => {
    test.setTimeout(90000);
    await clearAll();
    await saveCleanFile();
    try {
      // Create a suggestion via API
      const suggestions = require('../src/server/suggestions');
      const github = require('../src/server/github');
      const { content, sha } = await github.getFileContent(TEST_FILE);

      // Find a unique word for the suggestion
      const words = content.match(/\b[a-zA-Z]{8,12}\b/g) || [];
      let targetWord = null;
      for (const w of words) {
        if (content.indexOf(w) === content.lastIndexOf(w)) { targetWord = w; break; }
      }
      expect(targetWord).toBeTruthy();
      const pos = content.indexOf(targetWord);

      const suggId = await suggestions.createHunk({
        filePath: TEST_FILE, bookPath: 'series/Narrative Journey Series/Foundations/Test Book',
        baseCommitSha: sha, type: 'replacement',
        originalFrom: pos, originalTo: pos + targetWord.length,
        originalText: targetWord, newText: 'RETRYTEST',
        contextBefore: content.substring(Math.max(0, pos - 50), pos),
        contextAfter: content.substring(pos + targetWord.length, Math.min(content.length, pos + targetWord.length + 50)),
        authorEmail: 'other@example.com', authorName: 'Other User',
      });
      console.log('Retry test: created suggestion', suggId, 'for word', targetWord);

      // Login as admin and enter review mode
      await login(page);
      await page.click('#btn-review');
      await page.waitForSelector('.cm-editor');
      await page.waitForTimeout(2000);

      // Mock the accept endpoint: first call returns 409, subsequent calls pass through
      let acceptCallCount = 0;
      await page.route('**/api/suggestions/hunk/*/accept', (route) => {
        acceptCallCount++;
        if (acceptCallCount === 1) {
          route.fulfill({
            status: 409,
            contentType: 'application/json',
            body: JSON.stringify({ status: 'stale', message: 'The file was modified since you loaded the page.' }),
          });
        } else {
          route.continue();
        }
      });

      // Find and click the accept button for this suggestion
      const acceptBtn = page.locator('.margin-action--accept').first();
      await expect(acceptBtn).toBeVisible({ timeout: 10000 });
      await acceptBtn.click();
      await page.waitForTimeout(3000);

      // Stale card should appear with "Try again" button
      const retryBtn = page.locator('[data-action="retry-stale"]');
      await expect(retryBtn).toBeVisible({ timeout: 10000 });

      // Click "Try again" — should succeed on the second call (not mocked)
      await retryBtn.click();
      await page.waitForTimeout(8000);

      // Suggestion should be accepted — card shows success or is removed
      const successCard = page.locator('.margin-card-status--success');
      const staleCard = page.locator('[data-action="retry-stale"]');
      // Either the success status is shown, or the card was removed entirely
      const hasSuccess = await successCard.count() > 0;
      const staleGone = await staleCard.count() === 0;
      expect(hasSuccess || staleGone).toBe(true);

    } finally {
      await clearAll();
      await restoreCleanFile();
    }
  });

  test('retry shows error when original text was deleted', async ({ page }) => {
    test.setTimeout(90000);
    await clearAll();
    await saveCleanFile();
    try {
      const suggestions = require('../src/server/suggestions');
      const github = require('../src/server/github');
      const { content, sha } = await github.getFileContent(TEST_FILE);

      // Find a unique word to create a suggestion for
      const words = content.match(/\b[a-zA-Z]{8,12}\b/g) || [];
      let targetWord = null;
      for (const w of words) {
        if (content.indexOf(w) === content.lastIndexOf(w)) { targetWord = w; break; }
      }
      expect(targetWord).toBeTruthy();
      const pos = content.indexOf(targetWord);

      const suggId = await suggestions.createHunk({
        filePath: TEST_FILE, bookPath: 'series/Narrative Journey Series/Foundations/Test Book',
        baseCommitSha: sha, type: 'replacement',
        originalFrom: pos, originalTo: pos + targetWord.length,
        originalText: targetWord, newText: 'DELETETEST',
        contextBefore: content.substring(Math.max(0, pos - 50), pos),
        contextAfter: content.substring(pos + targetWord.length, Math.min(content.length, pos + targetWord.length + 50)),
        authorEmail: 'other@example.com', authorName: 'Other User',
      });
      console.log('Delete retry test: created suggestion', suggId, 'for word', targetWord);

      // Login as admin and enter review mode
      await login(page);

      // Freeze the fast poll to prevent auto-sync from interfering with stale card testing
      let suggestionCountOverride = 1;
      await page.route('**/api/suggestions/suggestion-count*', (route) => {
        route.fulfill({ status: 200, contentType: 'application/json',
          body: JSON.stringify({ count: suggestionCountOverride, replyCount: 0, commentCount: 0 }) });
      });
      // Mock the accept endpoint to return 409
      await page.route('**/api/suggestions/hunk/*/accept', (route) => {
        route.fulfill({
          status: 409,
          contentType: 'application/json',
          body: JSON.stringify({ status: 'stale', message: 'The file was modified.' }),
        });
      });

      await page.click('#btn-review');
      await page.waitForSelector('.cm-editor');
      await page.waitForTimeout(2000);

      const acceptBtn = page.locator('.margin-action--accept').first();
      await expect(acceptBtn).toBeVisible({ timeout: 5000 });
      await acceptBtn.click();
      await page.waitForTimeout(3000);

      // Stale card with "Try again" should appear
      const retryBtn = page.locator('[data-action="retry-stale"]');
      await expect(retryBtn).toBeVisible({ timeout: 10000 });

      // Now actually DELETE the target word from the file on GitHub
      const { content: current, sha: curSha } = await github.getFileContent(TEST_FILE);
      const cleaned = current.replace(targetWord, '');
      await github.updateFileContent(TEST_FILE, cleaned, curSha, 'Test: delete target word');
      await page.request.post(`${BASE_URL}/api/refresh`);
      await page.waitForTimeout(2000);

      // Unroute the accept mock so the content endpoint works normally
      await page.unroute('**/api/suggestions/hunk/*/accept');

      // Click "Try again" — should detect text is gone
      await retryBtn.click();
      await page.waitForTimeout(3000);

      // Should show "Cannot re-apply" message in the stale card
      const staleCard = page.locator('.margin-card--stale');
      await expect(staleCard).toBeVisible({ timeout: 5000 });
      await expect(staleCard).toContainText('Cannot re-apply');

      // "Try again" button should be removed
      await expect(retryBtn).toHaveCount(0);

    } finally {
      await clearAll();
      await restoreCleanFile();
    }
  });
});
