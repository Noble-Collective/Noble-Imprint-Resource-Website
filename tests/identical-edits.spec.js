// Test: Making identical edits (e.g., adding "s") at different positions
// should each create their own margin card.
const { test, expect } = require('@playwright/test');

const BASE_URL = 'http://localhost:8080';
const TEST_SESSION_PATH = '/narrative-journey-series/foundations/test-book/1-session1-thegospel';

async function login(page) {
  await page.request.post(`${BASE_URL}/api/auth/test-login`, { data: { email: 'steve@noblecollective.org' } });
  await page.goto(BASE_URL + TEST_SESSION_PATH, { timeout: 15000 });
}

async function clearAllSuggestions() {
  const admin = require('firebase-admin');
  if (!admin.apps.length) admin.initializeApp();
  const db = admin.firestore();
  const snap = await db.collection('suggestions').get();
  if (snap.empty) return;
  const batch = db.batch();
  snap.docs.forEach(d => batch.delete(d.ref));
  await batch.commit();
}

test.describe('Identical edits at different positions', () => {
  test.beforeEach(async () => { await clearAllSuggestions(); });
  test.afterEach(async () => { await clearAllSuggestions(); });

  test('adding "s" to 3 different words creates 3 separate cards', async ({ page }) => {
    await page.goto(BASE_URL + TEST_SESSION_PATH);
    await login(page);
    await page.click('#btn-suggest-edit');
    await page.waitForSelector('#codemirror-host .cm-editor');
    await page.waitForTimeout(500);

    // Find 3 unique words in plain text that we can append "s" to
    const words = await page.evaluate(() => {
      const doc = window.__editorView.state.doc.toString();
      const lines = doc.split('\n');
      const found = [];
      for (const line of lines) {
        if (line.startsWith('#') || line.startsWith('>') || line.startsWith('<') || line.startsWith('-') || line.length < 30) continue;
        const ws = line.match(/\b[a-zA-Z]{6,10}\b/g) || [];
        for (const w of ws) {
          if (doc.indexOf(w) === doc.lastIndexOf(w) && !found.includes(w) && !w.endsWith('s')) {
            found.push(w);
            if (found.length >= 3) return found;
          }
        }
      }
      return found;
    });
    console.log('Words:', words);
    expect(words.length).toBe(3);

    // Append "s" to each word ONE AT A TIME, waiting for auto-save between each.
    // This reproduces the real bug: after auto-save promotes the first "s" to the
    // registry, the draft filter would incorrectly filter out subsequent "s" hunks.
    for (let i = 0; i < words.length; i++) {
      await page.evaluate((w) => {
        const view = window.__editorView;
        const doc = view.state.doc.toString();
        const pos = doc.indexOf(w);
        if (pos >= 0) {
          const end = pos + w.length;
          view.dispatch({
            changes: { from: end, to: end, insert: 's' },
            selection: { anchor: end + 1 },
            scrollIntoView: true,
          });
        }
      }, words[i]);

      // Wait for auto-save to complete (1.5s debounce + network + promotion)
      await page.waitForTimeout(4000);

      const cardCount = await page.locator('.margin-card').count();
      console.log(`After edit ${i + 1} ("${words[i]}s"): ${cardCount} cards`);
    }

    // All 3 edits should have their own card
    const finalCards = await page.locator('.margin-card').count();
    const cardTexts = await page.evaluate(() => {
      return [...document.querySelectorAll('.margin-card .margin-card-body')].map(el => el.textContent.trim());
    });
    console.log('Final cards:', finalCards, cardTexts);
    expect(finalCards).toBeGreaterThanOrEqual(3);
  });
});
