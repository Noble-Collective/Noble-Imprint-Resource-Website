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
      await expect(status).toHaveText('Save failed', { timeout: 10000 });

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
  test('session-created suggestion discarded by another user disappears from author screen', async ({ page }) => {
    test.setTimeout(90000);
    await clearAll();
    try {
      // Steve opens the editor and creates a suggestion via the UI (loadedFromServer: false)
      await page.request.post(`${BASE_URL}/api/refresh`);
      await login(page);
      await enterSuggest(page);
      const word = await findUniqueWord(page);
      await makeSuggestion(page, word);
      await page.waitForTimeout(3000); // wait for auto-save

      // Verify suggestion card is visible
      const cardCount = await page.locator('.margin-card--suggestion').count();
      expect(cardCount).toBeGreaterThanOrEqual(1);

      // Verify it was saved to Firestore
      const r = await countFirestoreSuggestions();
      expect(r.count).toBeGreaterThanOrEqual(1);

      // Another user discards the suggestion (delete from Firestore)
      const admin = require('firebase-admin');
      if (!admin.apps.length) admin.initializeApp();
      for (const doc of r.docs) { await admin.firestore().collection('suggestions').doc(doc.id).delete(); }

      // Wait for 10s poll to detect the removal and auto-load
      await page.waitForTimeout(15000);

      // Card should be gone — the author's session-created suggestion was removed by another user
      const afterCount = await page.locator('.margin-card--suggestion').count();
      expect(afterCount).toBe(0);

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

  test('draft suggestion shows current user name, not another user with a pending suggestion', async ({ page }) => {
    test.setTimeout(60000);
    await clearAll();
    try {
      const suggestions = require('../src/server/suggestions');
      const github = require('../src/server/github');
      const cache = require('../src/server/cache');
      cache.del('file:' + TEST_FILE);
      const { content, sha } = await github.getFileContent(TEST_FILE);

      // Find two unique words — one for Jane's existing suggestion, one for Steve's new edit
      const words = content.match(/\b[a-zA-Z]{7,12}\b/g) || [];
      const unique = [];
      for (const w of words) {
        if (content.indexOf(w) === content.lastIndexOf(w)) unique.push(w);
        if (unique.length >= 2) break;
      }
      expect(unique.length).toBeGreaterThanOrEqual(2);
      const janeWord = unique[0];
      const steveWord = unique[1];
      const janePos = content.indexOf(janeWord);

      // Jane has a pending insertion suggestion
      await suggestions.createHunk({
        filePath: TEST_FILE, bookPath: 'series/Narrative Journey Series/Foundations/Test Book',
        baseCommitSha: sha, type: 'insertion',
        originalFrom: janePos, originalTo: janePos,
        originalText: '', newText: 'JANEINSERT',
        contextBefore: content.substring(Math.max(0, janePos - 50), janePos),
        contextAfter: content.substring(janePos, Math.min(content.length, janePos + 50)),
        authorEmail: 'jane@noblecollective.org', authorName: 'Jane Doe',
      });

      // Steve opens the editor — Jane's suggestion is loaded
      await page.request.post(`${BASE_URL}/api/refresh`);
      await login(page);
      await enterSuggest(page);
      await page.waitForTimeout(2000);

      // Steve makes his own insertion on a DIFFERENT word
      await page.evaluate((w) => {
        const v = window.__editorView, doc = v.state.doc.toString();
        const p = doc.indexOf(w);
        if (p >= 0) {
          v.dispatch({ selection: { anchor: p, head: p }, scrollIntoView: true });
          v.dispatch(v.state.replaceSelection('STEVEINSERT'));
        }
      }, steveWord);
      await page.waitForTimeout(500);

      // Steve's draft card should show his name, NOT Jane's
      // Find the card for Steve's edit (contains 'STEVEINSERT')
      const draftAuthor = await page.evaluate(() => {
        const cards = document.querySelectorAll('.margin-card--suggestion');
        for (const card of cards) {
          if (card.textContent.includes('STEVEINSERT')) {
            const name = card.querySelector('.margin-card-name');
            return name ? name.textContent.trim() : null;
          }
        }
        return null;
      });
      // Steve is logged in as steve@noblecollective.org — the card should NOT say 'Jane Doe'
      expect(draftAuthor).not.toBe('Jane Doe');

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

      // Draft should be preserved in the editor — the user's edit must not be lost
      const editorContent = await page.evaluate(() => window.__editorView.state.doc.toString());
      expect(editorContent).toContain('EDIT');

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
      // Clear server cache first — a previous test may have modified the file,
      // leaving the server's 30s cache out of sync with GitHub
      await page.request.post(`${BASE_URL}/api/refresh`);
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
      // Clear server cache first — a previous test may have modified the file,
      // leaving the server's 30s cache out of sync with GitHub
      await page.request.post(`${BASE_URL}/api/refresh`);
      await login(page);

      // Freeze both polls to prevent interference with stale card testing:
      // - suggestion-count poll (10s): could trigger autoLoadNewSuggestions
      // - file-version poll (30s): could trigger refreshFromGitHub after file modification
      await page.route('**/api/suggestions/suggestion-count*', (route) => {
        route.fulfill({ status: 200, contentType: 'application/json',
          body: JSON.stringify({ count: 1, replyCount: 0, commentCount: 0 }) });
      });
      await page.route('**/api/suggestions/file-version*', (route) => {
        route.fulfill({ status: 200, contentType: 'application/json',
          body: JSON.stringify({ sha: sha }) });
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


// ============================================================
// Step 8: Polling safety + coverage gaps
// ============================================================

test.describe('Polling safety + coverage gaps', () => {

  test('comment from another user auto-loads within 15s', async ({ page }) => {
    test.setTimeout(90000);
    await clearAll();
    try {
      const suggestions = require('../src/server/suggestions');
      const github = require('../src/server/github');
      const cache = require('../src/server/cache');
      cache.del('file:' + TEST_FILE);
      const { content, sha } = await github.getFileContent(TEST_FILE);

      // Find a unique word to use as the comment anchor
      const words = content.match(/\b[a-zA-Z]{8,12}\b/g) || [];
      let targetWord = null;
      for (const w of words) {
        if (content.indexOf(w) === content.lastIndexOf(w)) { targetWord = w; break; }
      }
      expect(targetWord).toBeTruthy();
      const pos = content.indexOf(targetWord);

      // Open editor first (no comments yet)
      await page.request.post(`${BASE_URL}/api/refresh`);
      await login(page);
      await enterSuggest(page);
      await page.waitForTimeout(2000);

      // Verify no comment cards initially
      const initialComments = await page.locator('.margin-card--comment').count();
      expect(initialComments).toBe(0);

      // Now create a comment as another user (while editor is open)
      await suggestions.createComment({
        filePath: TEST_FILE,
        bookPath: 'series/Narrative Journey Series/Foundations/Test Book',
        baseCommitSha: sha, from: pos, to: pos + targetWord.length,
        selectedText: targetWord, commentText: 'Review this section please',
        authorEmail: 'jane@noblecollective.org', authorName: 'Jane Doe',
        fileContent: content,
      });

      // Wait for 10s poll to detect commentCount change and auto-load
      const commentCard = page.locator('.margin-card--comment');
      await expect(commentCard).toHaveCount(1, { timeout: 15000 });

    } finally {
      await clearAll();
    }
  });

  test('reply to comment auto-loads within 15s', async ({ page }) => {
    test.setTimeout(90000);
    await clearAll();
    try {
      const suggestions = require('../src/server/suggestions');
      const github = require('../src/server/github');
      const cache = require('../src/server/cache');
      cache.del('file:' + TEST_FILE);
      const { content, sha } = await github.getFileContent(TEST_FILE);

      // Find a unique word for the comment anchor
      const words = content.match(/\b[a-zA-Z]{8,12}\b/g) || [];
      let targetWord = null;
      for (const w of words) {
        if (content.indexOf(w) === content.lastIndexOf(w)) { targetWord = w; break; }
      }
      expect(targetWord).toBeTruthy();
      const pos = content.indexOf(targetWord);

      // Create comment BEFORE opening editor so it's loaded on page render
      const commentId = await suggestions.createComment({
        filePath: TEST_FILE,
        bookPath: 'series/Narrative Journey Series/Foundations/Test Book',
        baseCommitSha: sha, from: pos, to: pos + targetWord.length,
        selectedText: targetWord, commentText: 'Needs attention',
        authorEmail: 'jane@noblecollective.org', authorName: 'Jane Doe',
        fileContent: content,
      });

      // Open editor — comment should be visible
      await page.request.post(`${BASE_URL}/api/refresh`);
      await login(page);
      await enterSuggest(page);
      await page.waitForTimeout(2000);

      // Verify comment card loaded, no replies yet
      await expect(page.locator('.margin-card--comment')).toHaveCount(1, { timeout: 5000 });
      const initialReplies = await page.locator('.margin-card-reply').count();
      expect(initialReplies).toBe(0);

      // Now create a reply as another user (while editor is open)
      await suggestions.createReply({
        parentId: commentId, parentType: 'comment', filePath: TEST_FILE,
        text: 'I agree, let me fix this',
        authorEmail: 'bob@noblecollective.org', authorName: 'Bob Smith',
      });

      // Wait for 10s poll to detect replyCount change and auto-load
      const reply = page.locator('.margin-card-reply');
      await expect(reply).toHaveCount(1, { timeout: 15000 });

    } finally {
      await clearAll();
    }
  });

  test('discarded suggestion stays discarded through polling cycles', async ({ page }) => {
    test.setTimeout(90000);
    await clearAll();
    try {
      const suggestions = require('../src/server/suggestions');
      const github = require('../src/server/github');
      const cache = require('../src/server/cache');
      cache.del('file:' + TEST_FILE);
      const { content, sha } = await github.getFileContent(TEST_FILE);

      // Find a unique word for the suggestion
      const words = content.match(/\b[a-zA-Z]{8,12}\b/g) || [];
      let targetWord = null;
      for (const w of words) {
        if (content.indexOf(w) === content.lastIndexOf(w)) { targetWord = w; break; }
      }
      expect(targetWord).toBeTruthy();
      const pos = content.indexOf(targetWord);

      // Create suggestion as another user
      await suggestions.createHunk({
        filePath: TEST_FILE, bookPath: 'series/Narrative Journey Series/Foundations/Test Book',
        baseCommitSha: sha, type: 'replacement',
        originalFrom: pos, originalTo: pos + targetWord.length,
        originalText: targetWord, newText: 'DISCARDTEST',
        contextBefore: content.substring(Math.max(0, pos - 50), pos),
        contextAfter: content.substring(pos + targetWord.length, Math.min(content.length, pos + targetWord.length + 50)),
        authorEmail: 'jane@noblecollective.org', authorName: 'Jane Doe',
      });

      // Open editor in suggest mode
      await page.request.post(`${BASE_URL}/api/refresh`);
      await login(page);
      await enterSuggest(page);
      await page.waitForTimeout(2000);

      // Verify suggestion card is visible
      const suggCard = page.locator('.margin-card--suggestion:not(.margin-card--stale)');
      await expect(suggCard).toHaveCount(1, { timeout: 5000 });

      // Click discard button
      const discardBtn = page.locator('.margin-action--reject').first();
      await expect(discardBtn).toBeVisible({ timeout: 5000 });
      await discardBtn.click();
      await page.waitForTimeout(2000);

      // Verify card is gone
      await expect(suggCard).toHaveCount(0);

      // Wait through two full polling cycles (25s) — card must stay gone
      console.log('Discard test: waiting 25s through polling cycles...');
      await page.waitForTimeout(25000);

      // Verify card is STILL gone (polling did not re-add it)
      const finalCount = await page.locator('.margin-card--suggestion:not(.margin-card--stale)').count();
      expect(finalCount).toBe(0);

    } finally {
      await clearAll();
    }
  });

  test('accept completes cleanly despite polling', async ({ page }) => {
    test.setTimeout(90000);
    await clearAll();
    await saveCleanFile();
    try {
      const suggestions = require('../src/server/suggestions');
      const github = require('../src/server/github');
      const cache = require('../src/server/cache');
      cache.del('file:' + TEST_FILE);
      const { content, sha } = await github.getFileContent(TEST_FILE);

      // Find a unique word for the suggestion
      const words = content.match(/\b[a-zA-Z]{8,12}\b/g) || [];
      let targetWord = null;
      for (const w of words) {
        if (content.indexOf(w) === content.lastIndexOf(w)) { targetWord = w; break; }
      }
      expect(targetWord).toBeTruthy();
      const pos = content.indexOf(targetWord);

      await suggestions.createHunk({
        filePath: TEST_FILE, bookPath: 'series/Narrative Journey Series/Foundations/Test Book',
        baseCommitSha: sha, type: 'replacement',
        originalFrom: pos, originalTo: pos + targetWord.length,
        originalText: targetWord, newText: 'POLLTEST',
        contextBefore: content.substring(Math.max(0, pos - 50), pos),
        contextAfter: content.substring(pos + targetWord.length, Math.min(content.length, pos + targetWord.length + 50)),
        authorEmail: 'jane@noblecollective.org', authorName: 'Jane Doe',
      });

      // Login as admin, enter review mode
      await page.request.post(`${BASE_URL}/api/refresh`);
      await login(page);
      await page.click('#btn-review');
      await page.waitForSelector('.cm-editor');
      await page.waitForTimeout(2000);

      // Verify suggestion card visible
      const suggCard = page.locator('.margin-card--suggestion:not(.margin-card--stale)');
      await expect(suggCard).toHaveCount(1, { timeout: 5000 });

      // Click accept
      const acceptBtn = page.locator('.margin-action--accept').first();
      await expect(acceptBtn).toBeVisible({ timeout: 5000 });
      await acceptBtn.click();

      // Wait for accept to complete + at least one poll cycle
      await page.waitForTimeout(15000);

      // Verify: no duplicate cards, suggestion accepted
      const remainingCards = await page.locator('.margin-card--suggestion:not(.margin-card--stale)').count();
      expect(remainingCards).toBe(0);

      // No error toasts
      const errorToast = await page.evaluate(() => {
        const t = document.getElementById('editor-toast');
        return t && t.style.display !== 'none' && t.classList.contains('editor-toast--error');
      });
      expect(errorToast).toBeFalsy();

      // Editor should still be functional
      const editorWorks = await page.evaluate(() => !!window.__editorView && !!window.__editorView.state.doc);
      expect(editorWorks).toBe(true);

    } finally {
      await clearAll();
      await restoreCleanFile();
    }
  });

  test('presence expires after 90s without heartbeat', async ({ page }) => {
    test.setTimeout(90000);
    await clearAll();
    await clearPresence();
    try {
      const suggestions = require('../src/server/suggestions');
      const admin = require('firebase-admin');
      if (!admin.apps.length) admin.initializeApp();
      const db = admin.firestore();

      // Create a STALE presence entry — heartbeat 95 seconds in the past
      const staleDocId = TEST_FILE.replace(/\//g, '__') + '::stale@example.com';
      await db.collection('editingSessions').doc(staleDocId).set({
        filePath: TEST_FILE,
        email: 'stale@example.com',
        displayName: 'Stale User',
        photoURL: null,
        heartbeat: admin.firestore.Timestamp.fromMillis(Date.now() - 95000),
      });

      // Create a FRESH presence entry
      await suggestions.enterEditingSession({
        filePath: TEST_FILE, email: 'fresh@example.com',
        displayName: 'Fresh User', photoURL: null,
      });

      // Server-side check: getActiveEditors should filter out the stale entry
      const editors = await suggestions.getActiveEditors(TEST_FILE);
      const staleEditor = editors.find(e => e.email === 'stale@example.com');
      const freshEditor = editors.find(e => e.email === 'fresh@example.com');
      expect(staleEditor).toBeFalsy();
      expect(freshEditor).toBeTruthy();

      // Browser-side check: open editor, verify presence display
      await page.request.post(`${BASE_URL}/api/refresh`);
      await login(page);
      await enterSuggest(page);

      // Wait for presence display to load (initial heartbeat + fetch)
      const avatar = page.locator('#editor-presence .presence-avatar');
      await expect(avatar).toHaveCount(1, { timeout: 35000 });

      // Only fresh user should appear (steve is current user, stale is filtered)
      const avatarText = await avatar.first().textContent();
      expect(avatarText).toContain('FU'); // Fresh User initials

    } finally {
      await clearAll();
      await clearPresence();
    }
  });

});

// ============================================================
// Card position drift after scroll
// ============================================================

test.describe('Card position accuracy', () => {
  test('card near end of document aligns with text after scroll', async ({ page }) => {
    test.setTimeout(60000);
    await clearAll();
    try {
      // Create a suggestion near the end of the document
      const suggestions = require('../src/server/suggestions');
      const github = require('../src/server/github');
      const cache = require('../src/server/cache');
      cache.del('file:' + TEST_FILE);
      const { content, sha } = await github.getFileContent(TEST_FILE);

      // Find a unique word in the last 10% of the document
      const startPos = Math.floor(content.length * 0.9);
      const nearby = content.substring(startPos, content.length);
      const words = nearby.match(/\b[a-zA-Z]{7,12}\b/g) || [];
      let targetWord = null;
      for (const w of words) { if (content.indexOf(w) === content.lastIndexOf(w)) { targetWord = w; break; } }
      expect(targetWord).toBeTruthy();
      const pos = content.indexOf(targetWord);

      await suggestions.createHunk({
        filePath: TEST_FILE, bookPath: 'series/Narrative Journey Series/Foundations/Test Book',
        baseCommitSha: sha, type: 'replacement',
        originalFrom: pos, originalTo: pos + targetWord.length,
        originalText: targetWord, newText: 'DRIFT_TEST',
        contextBefore: content.substring(Math.max(0, pos - 50), pos),
        contextAfter: content.substring(pos + targetWord.length, Math.min(content.length, pos + targetWord.length + 50)),
        authorEmail: 'other@example.com', authorName: 'Other User',
        fileContent: content,
      });

      await login(page);
      await enterSuggest(page);
      await page.waitForTimeout(2000);

      // Scroll to the suggestion (near end of document)
      await page.evaluate(() => {
        const v = window.__editorView;
        const reg = v.state.field(window.__annotationRegistry);
        for (const [id, a] of reg) {
          if (a.kind === 'suggestion') {
            v.dispatch({
              selection: { anchor: a.currentFrom },
              effects: v.constructor.scrollIntoView(a.currentFrom, { y: 'center' }),
            });
            break;
          }
        }
      });
      // Wait for CM6 height recalculation + debounced reposition
      await page.waitForTimeout(800);

      // Check drift: card position vs line position
      const drift = await page.evaluate(() => {
        const v = window.__editorView;
        const reg = v.state.field(window.__annotationRegistry);
        for (const [id, a] of reg) {
          if (a.kind !== 'suggestion') continue;
          let lineTop = 0;
          try { lineTop = v.lineBlockAt(a.currentFrom).top; } catch {}
          const card = document.querySelector('.margin-card[data-hunk-id="' + id + '"]');
          const cardTop = card ? parseFloat(card.style.top) || 0 : -1;
          return Math.abs(Math.round(cardTop - lineTop));
        }
        return -1;
      });
      console.log('Drift after scroll to end:', drift + 'px');
      // Card should be within 30px of the text (allows for resolveOverlaps adjustment)
      expect(drift).toBeLessThan(30);

    } finally { await clearAll(); }
  });
});

// ============================================================
// Accept precision: short common words must not misplace
// ============================================================

test.describe('Accept precision for short words', () => {
  test('short word accept stays correct after prior accept triggers reanchor', async ({ page }) => {
    test.setTimeout(120000);
    await clearAll();
    await saveCleanFile();
    try {
      const suggestions = require('../src/server/suggestions');
      const github = require('../src/server/github');
      const cache = require('../src/server/cache');
      cache.del('file:' + TEST_FILE);
      const { content, sha } = await github.getFileContent(TEST_FILE);

      // Find "that" — appears many times
      const word = 'that';
      const allPositions = [];
      let idx = 0;
      while ((idx = content.indexOf(word, idx)) >= 0) { allPositions.push(idx); idx += word.length; }
      expect(allPositions.length).toBeGreaterThan(5);

      // Target: "that" in the MIDDLE of the document
      const targetIdx = Math.floor(allPositions.length / 2);
      const targetPos = allPositions[targetIdx];
      const ctx = {
        contextBefore: content.substring(Math.max(0, targetPos - 50), targetPos),
        contextAfter: content.substring(targetPos + word.length, Math.min(content.length, targetPos + word.length + 50)),
      };

      // Create as insertion first, then update to replacement
      // (simulates auto-save create → update when diff recomputes)
      const shortWordId = await suggestions.createHunk({
        filePath: TEST_FILE, bookPath: 'series/Narrative Journey Series/Foundations/Test Book',
        baseCommitSha: sha, type: 'insertion',
        originalFrom: targetPos, originalTo: targetPos,
        originalText: '', newText: 'REPLACED-' + word,
        ...ctx, authorEmail: 'other@example.com', authorName: 'Other User',
      });
      await suggestions.updateHunk(shortWordId, {
        type: 'replacement',
        originalFrom: targetPos, originalTo: targetPos + word.length,
        originalText: word, newText: 'REPLACED-' + word, ...ctx,
      });

      // Create a DIFFERENT suggestion NEAR the target "that" — close enough
      // that accepting it changes the text within the 80-char prefix/suffix
      // This causes the reanchor prefix match to fail after the other accept
      const nearbyText = content.substring(Math.max(0, targetPos - 40), targetPos);
      const nearbyWords = nearbyText.match(/\b[a-zA-Z]{5,10}\b/g) || [];
      let uniqueWord = null;
      for (const w of nearbyWords) { if (content.indexOf(w) === content.lastIndexOf(w)) { uniqueWord = w; break; } }
      // Fallback: use any unique word in the prefix zone
      if (!uniqueWord) {
        const prefixZone = content.substring(Math.max(0, targetPos - 80), targetPos);
        const pWords = prefixZone.match(/\b[a-zA-Z]{5,12}\b/g) || [];
        for (const w of pWords) { if (content.indexOf(w) === content.lastIndexOf(w)) { uniqueWord = w; break; } }
      }
      expect(uniqueWord).toBeTruthy();
      const uPos = content.indexOf(uniqueWord);
      const otherId = await suggestions.createHunk({
        filePath: TEST_FILE, bookPath: 'series/Narrative Journey Series/Foundations/Test Book',
        baseCommitSha: sha, type: 'replacement',
        originalFrom: uPos, originalTo: uPos + uniqueWord.length,
        originalText: uniqueWord, newText: 'OTHERCHANGE',
        contextBefore: content.substring(Math.max(0, uPos - 50), uPos),
        contextAfter: content.substring(uPos + uniqueWord.length, Math.min(content.length, uPos + uniqueWord.length + 50)),
        authorEmail: 'other@example.com', authorName: 'Other User',
        fileContent: content,
      });

      // Accept the OTHER suggestion first — triggers reanchorAnnotations
      await page.request.post(`${BASE_URL}/api/auth/test-login`, { data: { email: 'steve@noblecollective.org' } });
      await page.request.post(`${BASE_URL}/api/refresh`);
      const otherAccept = await page.request.put(`${BASE_URL}/api/suggestions/hunk/${otherId}/accept`, {
        headers: { 'Content-Type': 'application/json' },
      });
      expect(otherAccept.ok()).toBeTruthy();

      // Now accept the short-word suggestion (after reanchor ran)
      await page.request.post(`${BASE_URL}/api/refresh`);
      const shortAccept = await page.request.put(`${BASE_URL}/api/suggestions/hunk/${shortWordId}/accept`, {
        headers: { 'Content-Type': 'application/json' },
      });

      if (shortAccept.ok()) {
        // Verify it was applied at the RIGHT position, not at the first "that"
        cache.del('file:' + TEST_FILE);
        const { content: afterContent } = await github.getFileContent(TEST_FILE);
        const offset = 'OTHERCHANGE'.length - uniqueWord.length;
        const adjTarget = uPos < targetPos ? targetPos + offset : targetPos;
        const replacedAt = afterContent.indexOf('REPLACED-that');
        const firstThat = afterContent.indexOf('that');
        console.log('First "that":', firstThat, '| REPLACED-that at:', replacedAt, '| Expected near:', adjTarget);
        // Must be near intended position, not at the first occurrence
        expect(Math.abs(replacedAt - adjTarget)).toBeLessThan(30);
      } else {
        // Stale is acceptable — better than corrupting the wrong position
        console.log('Accept returned stale (acceptable)');
        expect(shortAccept.status()).toBe(409);
      }

    } finally {
      await clearAll();
      await restoreCleanFile();
    }
  });
});

test.describe('Accept safety for short words', () => {
  test('accept returns stale instead of misplacing short common word', async ({ page }) => {
    test.setTimeout(90000);
    await clearAll();
    await saveCleanFile();
    try {
      const suggestions = require('../src/server/suggestions');
      const github = require('../src/server/github');
      const cache = require('../src/server/cache');
      cache.del('file:' + TEST_FILE);
      const { content, sha } = await github.getFileContent(TEST_FILE);

      // Find "that" in the middle of the document
      const word = 'that';
      const allPositions = [];
      let idx = 0;
      while ((idx = content.indexOf(word, idx)) >= 0) { allPositions.push(idx); idx += word.length; }
      const targetPos = allPositions[Math.floor(allPositions.length / 2)];

      // Create suggestion with CORRECT anchor data (full fileContent provided)
      const suggId = await suggestions.createHunk({
        filePath: TEST_FILE, bookPath: 'series/Narrative Journey Series/Foundations/Test Book',
        baseCommitSha: sha, type: 'replacement',
        originalFrom: targetPos, originalTo: targetPos + word.length,
        originalText: word, newText: 'MISPLACE-TEST',
        contextBefore: content.substring(Math.max(0, targetPos - 50), targetPos),
        contextAfter: content.substring(targetPos + word.length, Math.min(content.length, targetPos + word.length + 50)),
        authorEmail: 'other@example.com', authorName: 'Other User',
        fileContent: content,
      });

      // Now REWRITE the text around the target position via direct edit,
      // destroying the context but keeping "that" elsewhere in the document
      const before = content.substring(0, targetPos - 100);
      const after = content.substring(targetPos + 100);
      const mangled = before + 'COMPLETELY DIFFERENT CONTENT REPLACES THE ORIGINAL SECTION HERE' + after;
      await github.updateFileContent(TEST_FILE, mangled, sha, 'Mangle context for test');

      // Clear caches so accept sees the mangled file
      await page.request.post(BASE_URL + '/api/refresh');
      cache.del('file:' + TEST_FILE);

      // Accept the suggestion — context is destroyed, "that" still exists elsewhere
      await page.request.post(BASE_URL + '/api/auth/test-login', { data: { email: 'steve@noblecollective.org' } });
      const acceptRes = await page.request.put(BASE_URL + '/api/suggestions/hunk/' + suggId + '/accept', {
        headers: { 'Content-Type': 'application/json' },
      });

      if (acceptRes.ok()) {
        // If it succeeded, it MUST be near the intended position
        cache.del('file:' + TEST_FILE);
        const { content: afterContent } = await github.getFileContent(TEST_FILE);
        const placedAt = afterContent.indexOf('MISPLACE-TEST');
        console.log('MISPLACE-TEST at:', placedAt, '| intended near:', targetPos);
        // The replacement must be near the original target (within 200 chars
        // to account for the mangling), NOT at some random first occurrence
        expect(Math.abs(placedAt - targetPos)).toBeLessThan(200);
      } else {
        // Returning 409 stale is the CORRECT behavior — refuse rather than guess
        console.log('Accept returned stale (correct behavior)');
        expect(acceptRes.status()).toBe(409);
      }

    } finally {
      await clearAll();
      await restoreCleanFile();
    }
  });
});

// --- Multi-word replacement produces single suggestion ---
test.describe('Multi-word replacement', () => {
  test.beforeEach(async () => { await clearAll(); });
  test.afterEach(async () => { await clearAll(); });

  test('selecting 4 words and typing replacement creates exactly 1 suggestion card', async ({ page }) => {
    await login(page);
    await enterSuggest(page);

    // Find 4 consecutive words in body text to select and replace
    const fourWords = await page.evaluate(() => {
      const doc = window.__editorView.state.doc.toString();
      for (const line of doc.split('\n')) {
        if (line.startsWith('#') || line.startsWith('>') || line.startsWith('<') || line.startsWith('-') || line.length < 40) continue;
        // Find 4 consecutive words (all alphabetic, 4+ chars each)
        const match = line.match(/\b([a-zA-Z]{4,}\s+[a-zA-Z]{4,}\s+[a-zA-Z]{4,}\s+[a-zA-Z]{4,})\b/);
        if (match) {
          const pos = doc.indexOf(match[1]);
          if (pos >= 0) return { text: match[1], pos };
        }
      }
      return null;
    });
    expect(fourWords).not.toBeNull();
    console.log('Found 4 words:', JSON.stringify(fourWords.text), 'at pos', fourWords.pos);

    // Select the 4 words and type replacement text
    await page.evaluate(({ text, pos }) => {
      const v = window.__editorView;
      v.dispatch({ selection: { anchor: pos, head: pos + text.length }, scrollIntoView: true });
    }, fourWords);
    await page.waitForTimeout(100);

    // Type replacement text (simulating real user typing)
    await page.evaluate(({ pos, text }) => {
      const v = window.__editorView;
      // Replace selection with new text (like user typing)
      v.dispatch(v.state.replaceSelection('completely different words here'));
    }, fourWords);

    // Wait for draftPlugin debounce (300ms) + a bit more
    await page.waitForTimeout(600);

    // Count suggestion cards in the margin panel
    const cardCount = await page.evaluate(() => {
      const cards = document.querySelectorAll('.margin-card--suggestion');
      return cards.length;
    });
    console.log('Margin cards after replacement:', cardCount);

    // Should be exactly 1 card, not 3-4
    expect(cardCount).toBe(1);

    // Count draft hunks from the diff engine
    const hunkCount = await page.evaluate(() => {
      const { getCurrentHunks } = window.__suggestionModule || {};
      if (typeof getCurrentHunks === 'function') return getCurrentHunks().length;
      // Fallback: check decorations
      return document.querySelectorAll('.cm-suggestion-insert, .cm-suggestion-delete').length > 0 ? 1 : 0;
    });
    console.log('Draft hunks:', hunkCount);
    expect(hunkCount).toBeLessThanOrEqual(1);

    // Wait for auto-save (1.5s debounce + network)
    await page.waitForTimeout(3000);

    // Verify Firestore has exactly 1 suggestion
    const { count } = await countFirestoreSuggestions();
    console.log('Firestore suggestions after auto-save:', count);
    expect(count).toBe(1);

    // Verify the card still shows as 1 (no duplication after save)
    const finalCards = await page.evaluate(() => {
      return document.querySelectorAll('.margin-card--suggestion').length;
    });
    console.log('Margin cards after auto-save:', finalCards);
    expect(finalCards).toBe(1);
  });

  test('typing progressively into replaced selection stays as 1 card', async ({ page }) => {
    await login(page);
    await enterSuggest(page);

    // Find 4 consecutive words
    const fourWords = await page.evaluate(() => {
      const doc = window.__editorView.state.doc.toString();
      for (const line of doc.split('\n')) {
        if (line.startsWith('#') || line.startsWith('>') || line.startsWith('<') || line.startsWith('-') || line.length < 40) continue;
        const match = line.match(/\b([a-zA-Z]{4,}\s+[a-zA-Z]{4,}\s+[a-zA-Z]{4,}\s+[a-zA-Z]{4,})\b/);
        if (match) {
          const pos = doc.indexOf(match[1]);
          if (pos >= 0) return { text: match[1], pos };
        }
      }
      return null;
    });
    expect(fourWords).not.toBeNull();

    // Select and replace with first character
    await page.evaluate(({ pos, text }) => {
      const v = window.__editorView;
      v.dispatch({ selection: { anchor: pos, head: pos + text.length }, scrollIntoView: true });
      v.dispatch(v.state.replaceSelection('n'));
    }, fourWords);
    await page.waitForTimeout(100);

    // Type more characters one at a time (simulating real typing)
    const moreChars = 'ew words replac';
    for (const ch of moreChars) {
      await page.evaluate((c) => {
        const v = window.__editorView;
        const cursor = v.state.selection.main.head;
        v.dispatch({ changes: { from: cursor, to: cursor, insert: c } });
      }, ch);
      await page.waitForTimeout(50);
    }

    // Wait for draftPlugin debounce
    await page.waitForTimeout(500);

    // Should still be exactly 1 card
    const cardCount = await page.evaluate(() => {
      return document.querySelectorAll('.margin-card--suggestion').length;
    });
    console.log('Cards after progressive typing:', cardCount);
    expect(cardCount).toBe(1);
  });
});

// --- Edit region tracking: separate edits stay separate, single edits stay unified ---
test.describe('Edit region tracking', () => {
  test.beforeEach(async () => { await clearAll(); });
  test.afterEach(async () => { await clearAll(); });

  test('two nearby separate word replacements produce 2 cards, not 1', async ({ page }) => {
    await login(page);
    await enterSuggest(page);

    // Replace 'calling' → 'asking', then 'you' → 'everyone' (~8 chars apart)
    // These are two separate user actions and should produce 2 separate suggestion cards
    await page.evaluate(() => {
      const v = window.__editorView;
      const doc = v.state.doc.toString();
      const line = doc.indexOf('Jesus is calling you to follow him');
      if (line < 0) throw new Error('Test line not found');

      // Edit 1: replace 'calling' with 'asking'
      const p1 = line + 'Jesus is '.length;
      v.dispatch({ selection: { anchor: p1, head: p1 + 'calling'.length }, scrollIntoView: true });
      v.dispatch(v.state.replaceSelection('asking'));
    });
    await page.waitForTimeout(100);

    await page.evaluate(() => {
      const v = window.__editorView;
      const doc = v.state.doc.toString();
      const chunk = doc.indexOf('asking you');
      if (chunk < 0) throw new Error('asking you not found after edit 1');

      // Edit 2: replace 'you' with 'everyone'
      const p2 = chunk + 'asking '.length;
      v.dispatch({ selection: { anchor: p2, head: p2 + 'you'.length } });
      v.dispatch(v.state.replaceSelection('everyone'));
    });

    await page.waitForTimeout(600);

    const cardCount = await page.evaluate(() =>
      document.querySelectorAll('.margin-card--suggestion').length
    );
    console.log('Two nearby separate edits — cards:', cardCount);
    expect(cardCount).toBe(2);
  });

  test('three separate edits in same sentence produce 3 cards', async ({ page }) => {
    await login(page);
    await enterSuggest(page);

    // Replace word 2 ('is' → 'was'), word 4 ('you' → 'them'), add comma after word 7 ('him')
    // Steve's exact test case — should be 3 separate suggestion cards
    await page.evaluate(() => {
      const v = window.__editorView;
      let doc = v.state.doc.toString();
      const line = doc.indexOf('Jesus is calling you to follow him');
      if (line < 0) throw new Error('Test line not found');

      // Edit 1: 'is' → 'was'
      const p1 = line + 'Jesus '.length;
      v.dispatch({ selection: { anchor: p1, head: p1 + 2 }, scrollIntoView: true });
      v.dispatch(v.state.replaceSelection('was'));
    });
    await page.waitForTimeout(100);

    await page.evaluate(() => {
      const v = window.__editorView;
      const doc = v.state.doc.toString();
      const chunk = doc.indexOf('was calling you');
      // Edit 2: 'you' → 'them'
      const p2 = chunk + 'was calling '.length;
      v.dispatch({ selection: { anchor: p2, head: p2 + 3 } });
      v.dispatch(v.state.replaceSelection('them'));
    });
    await page.waitForTimeout(100);

    await page.evaluate(() => {
      const v = window.__editorView;
      const doc = v.state.doc.toString();
      const himIdx = doc.indexOf('follow him!');
      // Edit 3: add comma after 'him'
      const p3 = himIdx + 'follow him'.length;
      v.dispatch({ changes: { from: p3, to: p3, insert: ',' } });
    });

    await page.waitForTimeout(600);

    const cardCount = await page.evaluate(() =>
      document.querySelectorAll('.margin-card--suggestion').length
    );
    console.log('Three separate edits — cards:', cardCount);
    expect(cardCount).toBe(3);
  });

  test('replacement sharing common word produces 1 card, not 2', async ({ page }) => {
    await login(page);
    await enterSuggest(page);

    // Replace 'helpless and hopeless condition' with 'dark and broken state'
    // diffChars finds ' and ' as common and splits into 2 hunks — but it was 1 user action
    await page.evaluate(() => {
      const v = window.__editorView;
      const doc = v.state.doc.toString();
      const phrase = 'helpless and hopeless condition';
      const pos = doc.indexOf(phrase);
      if (pos < 0) throw new Error('phrase not found: ' + phrase);

      v.dispatch({ selection: { anchor: pos, head: pos + phrase.length }, scrollIntoView: true });
      v.dispatch(v.state.replaceSelection('dark and broken state'));
    });

    await page.waitForTimeout(600);

    const cardCount = await page.evaluate(() =>
      document.querySelectorAll('.margin-card--suggestion').length
    );
    console.log('Shared-word replacement — cards:', cardCount);
    expect(cardCount).toBe(1);
  });

  test('edit + auto-save + nearby separate edit produces 2 cards', async ({ page }) => {
    await login(page);
    await enterSuggest(page);

    // Edit 1: 'calling' → 'asking'
    await page.evaluate(() => {
      const v = window.__editorView;
      const doc = v.state.doc.toString();
      const line = doc.indexOf('Jesus is calling you');
      const p = line + 'Jesus is '.length;
      v.dispatch({ selection: { anchor: p, head: p + 'calling'.length }, scrollIntoView: true });
      v.dispatch(v.state.replaceSelection('asking'));
    });

    // Wait for auto-save to complete (1.5s debounce + network)
    await page.waitForTimeout(4000);

    // Verify edit 1 saved
    const savedCards = await page.evaluate(() =>
      document.querySelectorAll('.margin-card--suggestion').length
    );
    expect(savedCards).toBe(1);

    // Edit 2: 'you' → 'everyone' (nearby but separate action)
    await page.evaluate(() => {
      const v = window.__editorView;
      const doc = v.state.doc.toString();
      const chunk = doc.indexOf('asking you');
      const p = chunk + 'asking '.length;
      v.dispatch({ selection: { anchor: p, head: p + 'you'.length } });
      v.dispatch(v.state.replaceSelection('everyone'));
    });

    // Wait for second auto-save
    await page.waitForTimeout(4000);

    const finalCards = await page.evaluate(() =>
      document.querySelectorAll('.margin-card--suggestion').length
    );
    console.log('Edit + auto-save + nearby edit — final cards:', finalCards);
    expect(finalCards).toBe(2);
  });

  test('bold multi-word selection produces 1 card, not 2', async ({ page }) => {
    await login(page);
    await enterSuggest(page);

    // Bold 'follow him' — toggleFormat dispatches one transaction replacing
    // 'follow him' with '**follow him**'. diffChars produces 2 insertion hunks
    // for the ** markers. Should be 1 card since it's one user action.
    await page.evaluate(() => {
      const v = window.__editorView;
      const doc = v.state.doc.toString();
      const phrase = 'follow him';
      const pos = doc.indexOf(phrase + '!');
      if (pos < 0) throw new Error('phrase not found');

      v.dispatch({ selection: { anchor: pos, head: pos + phrase.length }, scrollIntoView: true });
      const selected = v.state.sliceDoc(pos, pos + phrase.length);
      // Simulate toggleFormat bold: replace selection with **selection**
      v.dispatch({ changes: { from: pos, to: pos + phrase.length, insert: '**' + selected + '**' } });
    });

    await page.waitForTimeout(600);

    const cardCount = await page.evaluate(() =>
      document.querySelectorAll('.margin-card--suggestion').length
    );
    console.log('Bold multi-word — cards:', cardCount);
    expect(cardCount).toBe(1);
  });

  test('backspace 1 char from end of word shows only that char as deleted', async ({ page }) => {
    await login(page);
    await enterSuggest(page);

    // Put cursor at end of 'philosophy' and backspace once — should delete just 'y'
    await page.evaluate(() => {
      const v = window.__editorView;
      const doc = v.state.doc.toString();
      const pos = doc.indexOf('philosophy') + 10; // right after the 'y'
      v.dispatch({ selection: { anchor: pos }, scrollIntoView: true });
    });
    await page.keyboard.press('Backspace');
    await page.waitForTimeout(600);

    const deleted = await page.evaluate(() =>
      Array.from(document.querySelectorAll('.cm-suggestion-delete')).map(e => e.textContent)
    );
    console.log('Backspace 1 char — strikethrough:', deleted);

    // Should show just 'y' as deleted, not the entire word 'philosophy'
    expect(deleted.length).toBe(1);
    expect(deleted[0]).toBe('y');
  });

  test('two character insertions in same word produce valid suggestion after save', async ({ page }) => {
    await login(page);
    await enterSuggest(page);

    // Insert 's' at end of 'hopeless' (making 'hopelesss'), wait for save
    await page.evaluate(() => {
      const v = window.__editorView, d = v.state.doc.toString();
      const pos = d.indexOf('hopeless ') + 8;
      v.dispatch({ changes: { from: pos, to: pos, insert: 's' } });
    });
    await page.waitForTimeout(4000);

    const savedCards = await page.evaluate(() =>
      document.querySelectorAll('.margin-card--suggestion').length
    );
    expect(savedCards).toBe(1);

    // Now insert '1' inside the same word (before the last 2 chars)
    await page.evaluate(() => {
      const v = window.__editorView, d = v.state.doc.toString();
      const pos = d.indexOf('hopelesss') + 7;
      v.dispatch({ changes: { from: pos, to: pos, insert: '1' } });
    });
    await page.waitForTimeout(4000);

    // The card should NOT be stuck on "Saving..."
    const state = await page.evaluate(() => {
      const cards = document.querySelectorAll('.margin-card--suggestion');
      return {
        saving: Array.from(cards).filter(c => c.textContent.includes('Saving')).length,
        del: Array.from(document.querySelectorAll('.cm-suggestion-delete')).map(e => e.textContent),
        ins: Array.from(document.querySelectorAll('.cm-suggestion-insert')).map(e => e.textContent),
      };
    });
    console.log('Same-word double insertion — saving:', state.saving, 'del:', state.del, 'ins:', state.ins);
    expect(state.saving).toBe(0);

    // Check Firestore: no entry should be a bogus replacement of a FRAGMENT of the word.
    // Valid results: the full word "hopeless" → combined change, or separate insertions.
    // Bogus: a partial fragment like "hopele" → "1".
    const { docs } = await countFirestoreSuggestions();
    const bogus = docs.filter(d =>
      d.type === 'replacement' && d.originalText !== 'hopeless' &&
      d.originalText.length > 2 && 'hopeless'.includes(d.originalText)
    );
    console.log('Suggestions:', docs.map(d => '[' + d.type + '] ' + d.originalText + ' → ' + d.newText));
    console.log('Bogus fragments:', bogus.length);
    expect(bogus.length).toBe(0);
  });
});
