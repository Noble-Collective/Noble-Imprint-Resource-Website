// Reproduce: 2 suggestions + 1 comment, accept or reject a suggestion, comment jumps to top.
// Test both accept and reject, with words on successive lines and within same paragraph.
const { test, expect } = require('@playwright/test');

const BASE_URL = 'http://localhost:8080';
const TEST_SESSION_PATH = '/narrative-journey-series/foundations/test-book/1-session1-thegospel';
const TEST_FILE = 'series/Narrative Journey Series/Foundations/Test Book/sessions/1-Session1-TheGospel.md';

async function login(page) {
  await page.request.post(`${BASE_URL}/api/auth/test-login`, { data: { email: 'steve@noblecollective.org' } });
  await page.goto(BASE_URL + TEST_SESSION_PATH, { timeout: 15000 });
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

async function saveCleanFile() {
  const github = require('../src/server/github');
  const fp = 'series/Narrative Journey Series/Foundations/Test Book/sessions/1-Session1-TheGospel.md';
  const { content } = await github.getFileContent(fp);
  return content;
}

async function restoreFile(saved) {
  if (!saved) return;
  const github = require('../src/server/github');
  const fp = 'series/Narrative Journey Series/Foundations/Test Book/sessions/1-Session1-TheGospel.md';
  const { content, sha } = await github.getFileContent(fp);
  if (content !== saved) await github.updateFileContent(fp, saved, sha, 'Restore after test');
}

// Helper: make a suggestion by selecting a word and typing replacement
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

// Helper: add a comment on a word
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
  await page.fill('#comment-popup-input', 'Test comment on ' + word);
  await page.click('#comment-popup-submit');
  await page.waitForTimeout(2000);
}

// Helper: get comment card position
async function getCommentPos(page) {
  return page.evaluate(() => {
    const card = document.querySelector('.margin-card--comment');
    if (!card) return { exists: false, top: -1 };
    return { exists: true, top: parseFloat(card.style.top) || 0 };
  });
}

// ============================================================
// Scenario 1: Words in same paragraph, ACCEPT first suggestion
// ============================================================
test('same paragraph — accept suggestion — comment should not jump', async ({ page }) => {
  test.setTimeout(90000);
  let saved = null;
  try {
    await clearAll();
    saved = await saveCleanFile();
    await page.goto(BASE_URL + TEST_SESSION_PATH);
    await login(page);
    await page.click('#btn-suggest-edit');
    await page.waitForSelector('.cm-editor');
    await page.waitForTimeout(500);

    // Find 3 unique words in the SAME long paragraph
    const words = await page.evaluate(() => {
      const doc = window.__editorView.state.doc.toString();
      const lines = doc.split('\n');
      for (const line of lines) {
        if (line.length < 80 || line.startsWith('#') || line.startsWith('>') || line.startsWith('<')) continue;
        const ws = line.match(/\b[a-zA-Z]{6,10}\b/g) || [];
        const unique = ws.filter(w => doc.indexOf(w) === doc.lastIndexOf(w));
        if (unique.length >= 3) return unique.slice(0, 3);
      }
      return [];
    });
    console.log('[same-para accept] Words:', words);
    if (words.length < 3) { console.log('SKIP: not enough unique words in one paragraph'); return; }

    await makeSuggestion(page, words[0]);
    await makeSuggestion(page, words[1]);
    await addComment(page, words[2]);
    await page.waitForTimeout(3000); // auto-save

    const before = await getCommentPos(page);
    console.log('[same-para accept] Comment BEFORE:', before);

    // Accept first suggestion
    const btn = page.locator('.margin-action--accept').first();
    await expect(btn).toBeVisible({ timeout: 5000 });
    await btn.click();
    await page.waitForTimeout(10000);
    // Wait for comment card to re-render after accept+refresh cycle
    await page.waitForSelector('.margin-card--comment', { timeout: 10000 });

    const after = await getCommentPos(page);
    console.log('[same-para accept] Comment AFTER:', after);
    expect(after.exists).toBe(true);
    expect(after.top).toBeGreaterThan(50);
  } finally {
    await clearAll();
    await restoreFile(saved);
  }
});

// ============================================================
// Scenario 2: Words in same paragraph, REJECT first suggestion
// ============================================================
test('same paragraph — reject suggestion — comment should not jump', async ({ page }) => {
  test.setTimeout(90000);
  try {
    await clearAll();
    await page.goto(BASE_URL + TEST_SESSION_PATH);
    await login(page);
    await page.click('#btn-suggest-edit');
    await page.waitForSelector('.cm-editor');
    await page.waitForTimeout(500);

    const words = await page.evaluate(() => {
      const doc = window.__editorView.state.doc.toString();
      const lines = doc.split('\n');
      for (const line of lines) {
        if (line.length < 80 || line.startsWith('#') || line.startsWith('>') || line.startsWith('<')) continue;
        const ws = line.match(/\b[a-zA-Z]{6,10}\b/g) || [];
        const unique = ws.filter(w => doc.indexOf(w) === doc.lastIndexOf(w));
        if (unique.length >= 3) return unique.slice(0, 3);
      }
      return [];
    });
    console.log('[same-para reject] Words:', words);
    if (words.length < 3) { console.log('SKIP'); return; }

    await makeSuggestion(page, words[0]);
    await makeSuggestion(page, words[1]);
    await addComment(page, words[2]);
    await page.waitForTimeout(3000);

    const before = await getCommentPos(page);
    console.log('[same-para reject] Comment BEFORE:', before);

    // Reject (discard) first suggestion
    const btn = page.locator('.margin-action--reject').first();
    await expect(btn).toBeVisible({ timeout: 5000 });
    await btn.click();
    await page.waitForTimeout(2000);

    const after = await getCommentPos(page);
    console.log('[same-para reject] Comment AFTER:', after);
    expect(after.exists).toBe(true);
    expect(after.top).toBeGreaterThan(50);
  } finally {
    await clearAll();
  }
});

// ============================================================
// Scenario 3: Words on successive lines, ACCEPT first suggestion
// ============================================================
test('successive lines — accept suggestion — comment should not jump', async ({ page }) => {
  test.setTimeout(90000);
  let saved = null;
  try {
    await clearAll();
    saved = await saveCleanFile();
    await page.goto(BASE_URL + TEST_SESSION_PATH);
    await login(page);
    await page.click('#btn-suggest-edit');
    await page.waitForSelector('.cm-editor');
    await page.waitForTimeout(500);

    // Find 3 unique words on 3 different successive lines
    const words = await page.evaluate(() => {
      const doc = window.__editorView.state.doc.toString();
      const lines = doc.split('\n');
      const found = [];
      for (let i = 0; i < lines.length && found.length < 3; i++) {
        const line = lines[i];
        if (line.startsWith('#') || line.startsWith('>') || line.startsWith('<') || line.startsWith('-') || line.length < 20) continue;
        const ws = line.match(/\b[a-zA-Z]{6,10}\b/g) || [];
        for (const w of ws) {
          if (doc.indexOf(w) === doc.lastIndexOf(w) && !found.some(f => f.word === w)) {
            found.push({ word: w, lineIdx: i });
            break; // one word per line
          }
        }
      }
      return found.map(f => f.word);
    });
    console.log('[successive accept] Words:', words);
    if (words.length < 3) { console.log('SKIP'); return; }

    await makeSuggestion(page, words[0]);
    await makeSuggestion(page, words[1]);
    await addComment(page, words[2]);
    await page.waitForTimeout(3000);

    const before = await getCommentPos(page);
    console.log('[successive accept] Comment BEFORE:', before);

    const btn = page.locator('.margin-action--accept').first();
    await expect(btn).toBeVisible({ timeout: 5000 });
    await btn.click();
    await page.waitForTimeout(8000);

    const after = await getCommentPos(page);
    console.log('[successive accept] Comment AFTER:', after);
    expect(after.exists).toBe(true);
    expect(after.top).toBeGreaterThan(50);
  } finally {
    await clearAll();
    await restoreFile(saved);
  }
});

// ============================================================
// Scenario 4: Words on successive lines, REJECT first suggestion
// ============================================================
test('successive lines — reject suggestion — comment should not jump', async ({ page }) => {
  test.setTimeout(90000);
  try {
    await clearAll();
    await page.goto(BASE_URL + TEST_SESSION_PATH);
    await login(page);
    await page.click('#btn-suggest-edit');
    await page.waitForSelector('.cm-editor');
    await page.waitForTimeout(500);

    const words = await page.evaluate(() => {
      const doc = window.__editorView.state.doc.toString();
      const lines = doc.split('\n');
      const found = [];
      for (let i = 0; i < lines.length && found.length < 3; i++) {
        const line = lines[i];
        if (line.startsWith('#') || line.startsWith('>') || line.startsWith('<') || line.startsWith('-') || line.length < 20) continue;
        const ws = line.match(/\b[a-zA-Z]{6,10}\b/g) || [];
        for (const w of ws) {
          if (doc.indexOf(w) === doc.lastIndexOf(w) && !found.some(f => f.word === w)) {
            found.push({ word: w, lineIdx: i });
            break;
          }
        }
      }
      return found.map(f => f.word);
    });
    console.log('[successive reject] Words:', words);
    if (words.length < 3) { console.log('SKIP'); return; }

    await makeSuggestion(page, words[0]);
    await makeSuggestion(page, words[1]);
    await addComment(page, words[2]);
    await page.waitForTimeout(3000);

    const before = await getCommentPos(page);
    console.log('[successive reject] Comment BEFORE:', before);

    const btn = page.locator('.margin-action--reject').first();
    await expect(btn).toBeVisible({ timeout: 5000 });
    await btn.click();
    await page.waitForTimeout(2000);

    const after = await getCommentPos(page);
    console.log('[successive reject] Comment AFTER:', after);
    expect(after.exists).toBe(true);
    expect(after.top).toBeGreaterThan(50);
  } finally {
    await clearAll();
  }
});
