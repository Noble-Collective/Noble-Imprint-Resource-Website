// Reproduce duplicate suggestions across various sequences.
const { test, expect } = require('@playwright/test');

const BASE_URL = 'http://localhost:8080';
const TEST_SESSION_PATH = '/narrative-journey-series/foundations/test-book/1-session1-thegospel';

async function login(page) {
  await page.request.post(`${BASE_URL}/api/auth/test-login`, { data: { email: 'steve@noblecollective.org' } });
  await page.goto(BASE_URL + TEST_SESSION_PATH, { timeout: 15000 });
}

async function clearAll() {
  const admin = require('firebase-admin');
  if (!admin.apps.length) admin.initializeApp();
  const db = admin.firestore();
  for (const col of ['suggestions', 'comments']) {
    const snap = await db.collection(col).get();
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
