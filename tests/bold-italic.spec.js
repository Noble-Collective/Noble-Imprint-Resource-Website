// Test: Bold formatting should create ONE margin card, not two.
const { test, expect } = require('@playwright/test');

const BASE_URL = 'http://localhost:8080';
const TEST_SESSION_PATH = '/narrative-journey-series/foundations/test-book/1-session1-thegospel';
const TEST_FILE = 'series/Narrative Journey Series/Foundations/Test Book/sessions/1-Session1-TheGospel.md';

async function login(page) {
  await page.request.post(`${BASE_URL}/api/auth/test-login`, { data: { email: 'steve@noblecollective.org' } });
  await page.goto(BASE_URL + TEST_SESSION_PATH, { timeout: 15000 });
}

async function clearAllSuggestions() {
  const admin = require('firebase-admin');
  if (!admin.apps.length) admin.initializeApp();
  const db = admin.firestore();
  for (const col of ['suggestions', 'comments']) {
    const snap = await db.collection(col).where('filePath', '==', TEST_FILE).get();
    if (snap.empty) continue;
    const batch = db.batch();
    snap.docs.forEach(d => batch.delete(d.ref));
    await batch.commit();
  }
}

test.describe('Bold/Italic creates single card', () => {
  test.beforeEach(async ({ page }) => {
    await clearAllSuggestions();
  });
  test.afterEach(async () => {
    await clearAllSuggestions();
  });

  test('bold shows 1 card immediately (no flash of 2)', async ({ page }) => {
    await page.goto(BASE_URL + TEST_SESSION_PATH);
    await login(page);
    await page.click('#btn-suggest-edit');
    await page.waitForSelector('#codemirror-host .cm-editor');
    await page.waitForTimeout(500);

    const word = await page.evaluate(() => {
      const doc = window.__editorView.state.doc.toString();
      const lines = doc.split('\n');
      for (const line of lines) {
        if (line.startsWith('#') || line.startsWith('>') || line.startsWith('<') || line.startsWith('-') || line.length < 30) continue;
        const ws = line.match(/\b[a-zA-Z]{6,10}\b/g) || [];
        for (const w of ws) { if (doc.indexOf(w) === doc.lastIndexOf(w)) return w; }
      }
      return null;
    });
    expect(word).toBeTruthy();

    await page.evaluate((w) => {
      const view = window.__editorView;
      const pos = view.state.doc.toString().indexOf(w);
      view.dispatch({ selection: { anchor: pos, head: pos + w.length }, scrollIntoView: true });
    }, word);
    await page.waitForTimeout(300);

    await page.locator('.comment-tooltip-bold').click();
    // Check IMMEDIATELY — before auto-save (500ms, not 4000ms)
    await page.waitForTimeout(500);

    const cardCount = await page.locator('.margin-card--suggestion').count();
    console.log('Suggestion cards immediately after bold:', cardCount);
    expect(cardCount).toBe(1);
  });

  test('bolding 3 different words creates 3 cards with correct labels', async ({ page }) => {
    await page.goto(BASE_URL + TEST_SESSION_PATH);
    await login(page);
    await page.click('#btn-suggest-edit');
    await page.waitForSelector('#codemirror-host .cm-editor');
    await page.waitForTimeout(500);

    // Find 3 unique words in plain text
    const words = await page.evaluate(() => {
      const doc = window.__editorView.state.doc.toString();
      const lines = doc.split('\n');
      const found = [];
      for (const line of lines) {
        if (line.startsWith('#') || line.startsWith('>') || line.startsWith('<') || line.startsWith('-') || line.length < 30) continue;
        const ws = line.match(/\b[a-zA-Z]{6,10}\b/g) || [];
        for (const w of ws) {
          if (doc.indexOf(w) === doc.lastIndexOf(w) && !found.includes(w)) {
            found.push(w);
            if (found.length >= 3) return found;
          }
        }
      }
      return found;
    });
    console.log('Words to bold:', words);
    expect(words.length).toBe(3);

    // Bold each word one at a time
    for (const word of words) {
      await page.evaluate((w) => {
        const view = window.__editorView;
        const doc = view.state.doc.toString();
        const pos = doc.indexOf(w);
        if (pos >= 0) view.dispatch({ selection: { anchor: pos, head: pos + w.length }, scrollIntoView: true });
      }, word);
      await page.waitForTimeout(300);
      const boldBtn = page.locator('.comment-tooltip-bold');
      await expect(boldBtn).toBeVisible({ timeout: 3000 });
      await boldBtn.click();
      await page.waitForTimeout(500);
    }

    // Wait for auto-save
    await page.waitForTimeout(4000);

    const cardTexts = await page.evaluate(() => {
      return [...document.querySelectorAll('.margin-card--suggestion .margin-card-body')].map(el => el.textContent.trim());
    });
    console.log('Suggestion card texts:', JSON.stringify(cardTexts));

    // Each card should contain the correct word
    expect(cardTexts.length).toBe(3);
    for (let i = 0; i < words.length; i++) {
      expect(cardTexts[i]).toContain(words[i]);
    }
  });

  test('bolding a word creates exactly 1 margin card', async ({ page }) => {
    await page.goto(BASE_URL + TEST_SESSION_PATH);
    await login(page);
    await page.click('#btn-suggest-edit');
    await page.waitForSelector('#codemirror-host .cm-editor');
    await page.waitForTimeout(500);

    // Find a unique word in plain text (not in a heading, blockquote, or tag)
    const word = await page.evaluate(() => {
      const doc = window.__editorView.state.doc.toString();
      const lines = doc.split('\n');
      for (const line of lines) {
        // Skip headings, blockquotes, tags, short lines
        if (line.startsWith('#') || line.startsWith('>') || line.startsWith('<') || line.startsWith('-') || line.length < 30) continue;
        const words = line.match(/\b[a-zA-Z]{6,10}\b/g) || [];
        for (const w of words) {
          if (doc.indexOf(w) === doc.lastIndexOf(w)) return w;
        }
      }
      return null;
    });
    console.log('Selected word for bolding:', word);
    expect(word).toBeTruthy();

    // Select the word and scroll to it
    await page.evaluate((w) => {
      const view = window.__editorView;
      const doc = view.state.doc.toString();
      const pos = doc.indexOf(w);
      view.dispatch({ selection: { anchor: pos, head: pos + w.length }, scrollIntoView: true });
    }, word);
    await page.waitForTimeout(500);

    // Verify tooltip appeared
    const tooltipVisible = await page.locator('.comment-tooltip').isVisible().catch(() => false);
    console.log('Tooltip visible:', tooltipVisible);

    // Click the Bold button
    const boldBtn = page.locator('.comment-tooltip-bold');
    await expect(boldBtn).toBeVisible({ timeout: 3000 });
    await boldBtn.click();
    await page.waitForTimeout(500);

    // Check if the text was actually bolded in the editor
    const docAfter = await page.evaluate((w) => {
      const doc = window.__editorView.state.doc.toString();
      return {
        containsBolded: doc.includes('**' + w + '**'),
        snippet: doc.substring(doc.indexOf(w) - 5, doc.indexOf(w) + w.length + 5),
      };
    }, word);
    console.log('Doc after bold:', JSON.stringify(docAfter));

    // Wait for auto-save (1.5s debounce + network)
    await page.waitForTimeout(4000);

    // Count ALL margin cards (suggestion + draft)
    const allCards = await page.locator('.margin-card').count();
    const suggCards = await page.locator('.margin-card--suggestion').count();
    console.log('All cards:', allCards, 'Suggestion cards:', suggCards);

    // Get card text to see what's shown
    const cardTexts = await page.evaluate(() => {
      return [...document.querySelectorAll('.margin-card .margin-card-body')].map(el => el.textContent.trim());
    });
    console.log('Card texts:', JSON.stringify(cardTexts));

    // The bold formatting should produce exactly 1 suggestion card
    expect(suggCards).toBe(1);
  });
});
