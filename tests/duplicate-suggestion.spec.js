// Reproduce duplicate suggestions across various sequences.
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
  for (const col of ['suggestions', 'comments']) {
    const snap = await db.collection(col).where('filePath', '==', TEST_FILE).get();
    if (!snap.empty) { const b = db.batch(); snap.docs.forEach(d => b.delete(d.ref)); await b.commit(); }
  }
}

async function countFirestoreSuggestions() {
  const admin = require('firebase-admin');
  if (!admin.apps.length) admin.initializeApp();
  const db = admin.firestore();
  const fp = 'series/Narrative Journey Series/Foundations/Test Book/sessions/1-Session1-TheGospel.md';
  const snap = await db.collection('suggestions').where('filePath', '==', fp).where('status', '==', 'pending').get();
  return { count: snap.size, docs: snap.docs.map(d => ({ id: d.id, ...d.data() })) };
}

async function findWords(page, count) {
  return page.evaluate((n) => {
    const doc = window.__editorView.state.doc.toString();
    const lines = doc.split('\n');
    const found = [];
    for (const line of lines) {
      if (line.startsWith('#') || line.startsWith('>') || line.startsWith('<') || line.startsWith('-') || line.length < 30) continue;
      const ws = line.match(/\b[a-zA-Z]{6,10}\b/g) || [];
      for (const w of ws) {
        if (doc.indexOf(w) === doc.lastIndexOf(w) && !found.includes(w)) {
          found.push(w);
          if (found.length >= n) return found;
        }
      }
    }
    return found;
  }, count);
}

async function makeSuggestion(page, word) {
  await page.evaluate((w) => {
    const view = window.__editorView;
    const doc = view.state.doc.toString();
    const pos = doc.indexOf(w);
    if (pos >= 0) {
      view.dispatch({ selection: { anchor: pos, head: pos + w.length }, scrollIntoView: true });
      view.dispatch(view.state.replaceSelection(w + 'EDIT'));
    }
  }, word);
  await page.waitForTimeout(300);
}

async function addComment(page, word) {
  await page.evaluate((w) => {
    const view = window.__editorView;
    const doc = view.state.doc.toString();
    const pos = doc.indexOf(w);
    if (pos >= 0) view.dispatch({ selection: { anchor: pos, head: pos + w.length }, scrollIntoView: true });
  }, word);
  await page.waitForTimeout(300);
  await page.locator('.comment-tooltip-comment').click();
  await page.waitForTimeout(300);
  await page.fill('#comment-popup-input', 'Test comment');
  await page.click('#comment-popup-submit');
  await page.waitForTimeout(2000);
}

async function enterSuggest(page) {
  await page.click('#btn-suggest-edit');
  await page.waitForSelector('.cm-editor');
  await page.waitForTimeout(500);
}

async function leaveSuggest(page) {
  await page.click('#btn-editor-done');
  await page.waitForTimeout(1000);
}

function checkNoDuplicates(result, label) {
  const texts = result.docs.map(d => d.originalText + '→' + d.newText + '@' + d.originalFrom);
  const unique = new Set(texts);
  if (unique.size < texts.length) {
    console.log(`[${label}] DUPLICATE FOUND:`, texts);
  } else {
    console.log(`[${label}] OK — ${result.count} suggestions, no duplicates`);
  }
  return unique.size === texts.length;
}

// Scenario 1: 2 suggestions + 1 comment, leave, re-enter, discard
test('Scenario 1: 2 suggestions + comment, leave/re-enter, discard', async ({ page }) => {
  test.setTimeout(90000);
  await clearAll();
  try {
    await page.goto(BASE_URL + TEST_SESSION_PATH);
    await login(page);
    await enterSuggest(page);
    const words = await findWords(page, 3);
    console.log('S1 words:', words);

    await makeSuggestion(page, words[0]);
    await makeSuggestion(page, words[1]);
    await addComment(page, words[2]);
    await page.waitForTimeout(4000);

    let r = await countFirestoreSuggestions();
    console.log('S1 after create:', r.count);
    expect(r.count).toBe(2);

    await leaveSuggest(page);
    await login(page);
    await enterSuggest(page);
    await page.waitForTimeout(4000);

    r = await countFirestoreSuggestions();
    checkNoDuplicates(r, 'S1 after re-enter');
    expect(r.count).toBe(2);

    // Discard first
    const btn = page.locator('.margin-action--reject').first();
    if (await btn.isVisible()) { await btn.click(); await page.waitForTimeout(4000); }

    r = await countFirestoreSuggestions();
    checkNoDuplicates(r, 'S1 after discard');
    expect(r.count).toBe(1);
  } finally { await clearAll(); }
});

// Scenario 2: 1 suggestion + 2 comments, leave, re-enter, discard the suggestion
test('Scenario 2: 1 suggestion + 2 comments, leave/re-enter, discard', async ({ page }) => {
  test.setTimeout(90000);
  await clearAll();
  try {
    await page.goto(BASE_URL + TEST_SESSION_PATH);
    await login(page);
    await enterSuggest(page);
    const words = await findWords(page, 3);
    console.log('S2 words:', words);

    await makeSuggestion(page, words[0]);
    await addComment(page, words[1]);
    await addComment(page, words[2]);
    await page.waitForTimeout(4000);

    let r = await countFirestoreSuggestions();
    console.log('S2 after create:', r.count);
    expect(r.count).toBe(1);

    await leaveSuggest(page);
    await login(page);
    await enterSuggest(page);
    await page.waitForTimeout(4000);

    r = await countFirestoreSuggestions();
    checkNoDuplicates(r, 'S2 after re-enter');
    expect(r.count).toBe(1);

    const btn = page.locator('.margin-action--reject').first();
    if (await btn.isVisible()) { await btn.click(); await page.waitForTimeout(4000); }

    r = await countFirestoreSuggestions();
    console.log('S2 after discard:', r.count);
    expect(r.count).toBe(0);
  } finally { await clearAll(); }
});

// Scenario 3: type text, delete it, leave, re-enter — no ghost suggestions
test('Scenario 3: type and delete text, leave/re-enter — no ghost suggestions', async ({ page }) => {
  test.setTimeout(90000);
  await clearAll();
  try {
    await page.goto(BASE_URL + TEST_SESSION_PATH);
    await login(page);
    await enterSuggest(page);

    // Click somewhere in the text and type then delete
    await page.evaluate(() => {
      const view = window.__editorView;
      const doc = view.state.doc.toString();
      const lines = doc.split('\n');
      for (const line of lines) {
        if (line.length > 50 && !line.startsWith('#') && !line.startsWith('>') && !line.startsWith('<')) {
          const pos = doc.indexOf(line) + 20;
          view.dispatch({ selection: { anchor: pos }, scrollIntoView: true });
          break;
        }
      }
    });
    await page.waitForTimeout(300);

    // Type "test222"
    await page.keyboard.type('test222');
    await page.waitForTimeout(500);

    // Delete it
    for (let i = 0; i < 7; i++) await page.keyboard.press('Backspace');
    await page.waitForTimeout(4000);

    let r = await countFirestoreSuggestions();
    console.log('S3 after type+delete:', r.count);

    await leaveSuggest(page);
    await login(page);
    await enterSuggest(page);
    await page.waitForTimeout(4000);

    r = await countFirestoreSuggestions();
    console.log('S3 after re-enter:', r.count);
    // Should be 0 — typed and deleted, no net change
    expect(r.count).toBe(0);
  } finally { await clearAll(); }
});

// Scenario 4: 2 suggestions, leave, re-enter, discard one, wait, check for duplicates
test('Scenario 4: 2 suggestions, leave/re-enter, discard, long wait for stray auto-save', async ({ page }) => {
  test.setTimeout(90000);
  await clearAll();
  try {
    await page.goto(BASE_URL + TEST_SESSION_PATH);
    await login(page);
    await enterSuggest(page);
    const words = await findWords(page, 2);
    console.log('S4 words:', words);

    await makeSuggestion(page, words[0]);
    await makeSuggestion(page, words[1]);
    await page.waitForTimeout(4000);

    await leaveSuggest(page);
    await login(page);
    await enterSuggest(page);
    await page.waitForTimeout(2000);

    // Discard first
    const btn = page.locator('.margin-action--reject').first();
    if (await btn.isVisible()) { await btn.click(); }

    // Wait a LONG time to catch any stray auto-save that re-creates
    await page.waitForTimeout(6000);

    let r = await countFirestoreSuggestions();
    checkNoDuplicates(r, 'S4 after long wait');
    console.log('S4 margin cards:', await page.locator('.margin-card--suggestion').count());
    expect(r.count).toBe(1);
  } finally { await clearAll(); }
});

// Scenario 5: 3 suggestions, leave, re-enter, discard middle one
test('Scenario 5: 3 suggestions, leave/re-enter, discard middle', async ({ page }) => {
  test.setTimeout(90000);
  await clearAll();
  try {
    await page.goto(BASE_URL + TEST_SESSION_PATH);
    await login(page);
    await enterSuggest(page);
    const words = await findWords(page, 3);
    console.log('S5 words:', words);

    await makeSuggestion(page, words[0]);
    await makeSuggestion(page, words[1]);
    await makeSuggestion(page, words[2]);
    await page.waitForTimeout(4000);

    await leaveSuggest(page);
    await login(page);
    await enterSuggest(page);
    await page.waitForTimeout(2000);

    // Discard the MIDDLE card (second one)
    const cards = page.locator('.margin-action--reject');
    const count = await cards.count();
    if (count >= 2) {
      await cards.nth(1).click();
      await page.waitForTimeout(6000);
    }

    let r = await countFirestoreSuggestions();
    checkNoDuplicates(r, 'S5 after discard middle');
    console.log('S5 margin cards:', await page.locator('.margin-card--suggestion').count());
    expect(r.count).toBe(2);
  } finally { await clearAll(); }
});

// --- Utilities for tests that accept suggestions (modify GitHub file) ---
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
    await github.updateFileContent(TEST_FILE, _cleanFileContent, sha, 'Restore clean file after duplicate-suggestion test');
    console.log('[TEST] Restored clean file on GitHub');
  }
}

// Scenario 6: accept via server shifts positions — savedHunks keys must match
// Root cause: reanchorAnnotations updates position.from but not originalFrom.
// After accept, Firestore has stale originalFrom. The client uses originalFrom
// for savedHunks keys, but the diff engine's originalFrom comes from the current
// file. When the shift is > ±1, findOverlappingSavedHunk misses, and auto-save
// creates a duplicate Firestore document.
//
// This test:
// 1. Injects suggestions via server API at known positions
// 2. Accepts one server-side (causing a position shift > 2 for remaining)
// 3. Loads the page and enters suggest mode
// 4. Checks savedHunks keys match what the diff engine produces
// 5. Verifies no duplicate Firestore entries or margin cards
test('Scenario 6: accept shifts positions — savedHunks keys must stay in sync', async ({ page }) => {
  test.setTimeout(120000);
  await clearAll();
  await saveCleanFile();
  try {
    const github = require('../src/server/github');
    const suggestions = require('../src/server/suggestions');
    const { content: fileContent, sha } = await github.getFileContent(TEST_FILE);

    // Find 3 unique 7-10 char words, sorted by document position
    const words = [];
    for (const line of fileContent.split('\n')) {
      if (line.startsWith('#') || line.startsWith('>') || line.startsWith('<') || line.startsWith('-') || line.length < 30) continue;
      for (const w of (line.match(/\b[a-zA-Z]{7,10}\b/g) || [])) {
        if (fileContent.indexOf(w) === fileContent.lastIndexOf(w) && !words.some(x => x.word === w)) {
          words.push({ word: w, pos: fileContent.indexOf(w) });
          if (words.length >= 3) break;
        }
      }
      if (words.length >= 3) break;
    }
    words.sort((a, b) => a.pos - b.pos);
    console.log('S6 words:', words.map(w => w.word + '@' + w.pos));
    expect(words.length).toBe(3);

    const deleteWord = words[0]; // FIRST in doc — deletion here shifts everything after
    const keepWord = words[1];   // SECOND — must not be duplicated
    const keepWord2 = words[2];  // THIRD — must not be duplicated

    // Create deletion suggestion (will be accepted)
    const delId = await suggestions.createHunk({
      filePath: TEST_FILE, bookPath: 'series/Narrative Journey Series/Foundations/Test Book',
      baseCommitSha: sha, type: 'deletion',
      originalFrom: deleteWord.pos, originalTo: deleteWord.pos + deleteWord.word.length,
      originalText: deleteWord.word, newText: '',
      contextBefore: fileContent.substring(Math.max(0, deleteWord.pos - 50), deleteWord.pos),
      contextAfter: fileContent.substring(deleteWord.pos + deleteWord.word.length, deleteWord.pos + deleteWord.word.length + 50),
      authorEmail: 'steve@noblecollective.org', authorName: 'Steve', fileContent,
    });
    console.log('S6 deletion:', delId, '"' + deleteWord.word + '" @' + deleteWord.pos, '(' + deleteWord.word.length + ' chars)');

    // Create replacement suggestion (will be kept)
    const repId = await suggestions.createHunk({
      filePath: TEST_FILE, bookPath: 'series/Narrative Journey Series/Foundations/Test Book',
      baseCommitSha: sha, type: 'replacement',
      originalFrom: keepWord.pos, originalTo: keepWord.pos + keepWord.word.length,
      originalText: keepWord.word, newText: 'REPLACED1',
      contextBefore: fileContent.substring(Math.max(0, keepWord.pos - 50), keepWord.pos),
      contextAfter: fileContent.substring(keepWord.pos + keepWord.word.length, keepWord.pos + keepWord.word.length + 50),
      authorEmail: 'steve@noblecollective.org', authorName: 'Steve', fileContent,
    });
    console.log('S6 replacement:', repId, '"' + keepWord.word + '" @' + keepWord.pos);

    // Create insertion suggestion (will be kept)
    const insPos = keepWord2.pos + keepWord2.word.length;
    const insId = await suggestions.createHunk({
      filePath: TEST_FILE, bookPath: 'series/Narrative Journey Series/Foundations/Test Book',
      baseCommitSha: sha, type: 'insertion',
      originalFrom: insPos, originalTo: insPos,
      originalText: '', newText: 'INSERTED2',
      contextBefore: fileContent.substring(Math.max(0, insPos - 50), insPos),
      contextAfter: fileContent.substring(insPos, Math.min(fileContent.length, insPos + 50)),
      authorEmail: 'steve@noblecollective.org', authorName: 'Steve', fileContent,
    });
    console.log('S6 insertion:', insId, 'after "' + keepWord2.word + '" @' + insPos);

    let r = await countFirestoreSuggestions();
    expect(r.count).toBe(3);

    // Accept the deletion SERVER-SIDE — shifts file, re-anchors remaining
    const result = await suggestions.acceptHunk(delId, 'steve@noblecollective.org');
    console.log('S6 accept:', result.stale ? 'STALE' : 'OK');
    expect(result.stale).toBeFalsy();

    // Verify the position mismatch exists (this is the bug condition)
    r = await countFirestoreSuggestions();
    expect(r.count).toBe(2);
    // After fix: reanchorAnnotations syncs originalFrom with the resolved position,
    // so originalFrom and position.from must match for all remaining suggestions.
    for (const d of r.docs) {
      const posFrom = d.position?.from;
      if (posFrom != null) {
        console.log('S6 position sync:', d.id.slice(0, 8), 'originalFrom=' + d.originalFrom, 'position.from=' + posFrom,
          d.originalFrom === posFrom ? 'IN SYNC' : 'MISMATCH');
        expect(d.originalFrom).toBe(posFrom);
      }
    }

    // NOW load the page and enter suggest mode — auto-save must NOT create duplicates
    await login(page);
    await enterSuggest(page);
    await page.waitForTimeout(6000); // debounce (300ms) + auto-save timer (1500ms) + margin

    // Check savedHunks keys match the RESOLVED positions (where the diff engine
    // will look for them), not the stale Firestore originalFrom.
    // This is the core defect: savedHunks uses originalFrom but the diff engine
    // uses the position in the current file (which matches position.from).
    const keyCheck = await page.evaluate(() => {
      const v = window.__editorView;
      if (!v || !window.__savedHunks) return { error: 'not ready' };
      const savedKeys = [];
      for (const [k, id] of window.__savedHunks) savedKeys.push({ key: k, id: id.slice(0, 8) });
      const reg = v.state.field(window.__annotationRegistry);
      const regInfo = [];
      for (const [id, a] of reg) {
        if (a.kind === 'suggestion') {
          regInfo.push({ id: id.slice(0, 8), origFrom: a.originalFrom, origTo: a.originalTo || a.originalFrom });
        }
      }
      return { savedKeys, regInfo };
    });
    console.log('S6 savedHunks keys:', JSON.stringify(keyCheck.savedKeys));

    // The savedHunks keys MUST use the file's current positions (position.from),
    // not the stale originalFrom. When the diff engine produces hunks, their
    // originalFrom will be relative to the current file. If savedHunks keys use
    // the old positions, findOverlappingSavedHunk won't match and auto-save
    // creates duplicates.
    for (const d of r.docs) {
      const posFrom = d.position?.from;
      const posTo = d.position?.to ?? posFrom;
      if (posFrom == null) continue;
      const expectedKey = posFrom + ':' + posTo;
      const actualEntry = keyCheck.savedKeys.find(s => s.id === d.id.slice(0, 8));
      if (actualEntry) {
        console.log('S6 key check:', d.id.slice(0, 8), 'expected=' + expectedKey, 'actual=' + actualEntry.key,
          actualEntry.key === expectedKey ? 'OK' : 'MISMATCH');
        expect(actualEntry.key).toBe(expectedKey);
      }
    }

    // CORE ASSERTION: Firestore must still have exactly 2 pending suggestions
    r = await countFirestoreSuggestions();
    console.log('S6 after page load:', r.count, r.docs.map(d =>
      d.id.slice(0, 8) + ' ' + d.type + ' @' + d.originalFrom));
    expect(r.count).toBe(2);

    // Card count must match Firestore count (no draft-leak duplicates)
    const cardCount = await page.locator('.margin-card--suggestion:not(.margin-card--stale)').count();
    console.log('S6 cards:', cardCount);
    expect(cardCount).toBe(2);

  } finally {
    await clearAll();
    await restoreCleanFile();
  }
});
