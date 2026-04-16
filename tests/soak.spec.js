// Soak test: simulate a real editing session with suggestions, comments, bold/italic,
// discards, accepts, resolves, mode exits/re-entries — verify consistency after each step.
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
  for (const col of ['suggestions', 'comments', 'replies']) {
    const snap = await db.collection(col).get();
    if (!snap.empty) { const b = db.batch(); snap.docs.forEach(d => b.delete(d.ref)); await b.commit(); }
  }
}

async function saveCleanFile() {
  const github = require('../src/server/github');
  const { content } = await github.getFileContent(TEST_FILE);
  return content;
}

async function restoreFile(saved) {
  if (!saved) return;
  const github = require('../src/server/github');
  const { content, sha } = await github.getFileContent(TEST_FILE);
  if (content !== saved) await github.updateFileContent(TEST_FILE, saved, sha, 'Restore after soak test');
}

async function getFirestoreState() {
  const admin = require('firebase-admin');
  if (!admin.apps.length) admin.initializeApp();
  const db = admin.firestore();
  const [suggs, comms] = await Promise.all([
    db.collection('suggestions').where('filePath', '==', TEST_FILE).where('status', '==', 'pending').get(),
    db.collection('comments').where('filePath', '==', TEST_FILE).where('status', '==', 'open').get(),
  ]);
  return {
    suggestions: suggs.docs.map(d => ({ id: d.id, ...d.data() })),
    comments: comms.docs.map(d => ({ id: d.id, ...d.data() })),
  };
}

async function getEditorState(page) {
  return page.evaluate(() => {
    if (!window.__editorView) return null;
    const suggCards = document.querySelectorAll('.margin-card--suggestion');
    const commentCards = document.querySelectorAll('.margin-card--comment');
    return {
      suggestionCards: suggCards.length,
      commentCards: commentCards.length,
      cardPositions: [...suggCards, ...commentCards].map(c => ({
        top: parseFloat(c.style.top) || 0,
        type: c.classList.contains('margin-card--comment') ? 'comment' : 'suggestion',
      })),
    };
  });
}

function findUniqueWords(doc, count, exclude = []) {
  const lines = doc.split('\n');
  const found = [];
  for (const line of lines) {
    if (line.startsWith('#') || line.startsWith('>') || line.startsWith('<') || line.startsWith('-') || line.length < 30) continue;
    const ws = line.match(/\b[a-zA-Z]{6,10}\b/g) || [];
    for (const w of ws) {
      if (doc.indexOf(w) === doc.lastIndexOf(w) && !found.includes(w) && !exclude.includes(w)) {
        found.push(w);
        if (found.length >= count) return found;
      }
    }
  }
  return found;
}

async function enterSuggest(page) {
  await page.click('#btn-suggest-edit');
  await page.waitForSelector('.cm-editor');
  await page.waitForTimeout(800);
}

async function leaveSuggest(page) {
  await page.click('#btn-editor-done');
  await page.waitForTimeout(1500);
}

async function verify(page, step, expectedSuggs, expectedComments) {
  await page.waitForTimeout(500);
  const editor = await getEditorState(page);
  const fs = await getFirestoreState();
  const errors = [];

  const topCards = editor.cardPositions.filter(c => c.top < 10);
  if (topCards.length > 0) {
    const details = await page.evaluate(() => {
      return [...document.querySelectorAll('.margin-card')].filter(c => parseFloat(c.style.top) < 10)
        .map(c => ({ type: c.classList.contains('margin-card--comment') ? 'C' : 'S', body: (c.querySelector('.margin-card-body')?.textContent || '').substring(0, 30) }));
    });
    errors.push(`card(s) stuck at top: ${JSON.stringify(details)}`);
  }

  const suggKeys = fs.suggestions.map(s => s.originalText + '@' + s.originalFrom);
  if (new Set(suggKeys).size < suggKeys.length) errors.push(`Duplicate suggestions in Firestore`);

  if (expectedSuggs !== undefined && fs.suggestions.length !== expectedSuggs)
    errors.push(`Expected ${expectedSuggs} suggestions, got ${fs.suggestions.length}`);
  if (expectedComments !== undefined && fs.comments.length !== expectedComments)
    errors.push(`Expected ${expectedComments} comments, got ${fs.comments.length}`);

  const status = errors.length === 0 ? 'OK' : 'FAIL';
  console.log(`[${step}] ${status} — ${editor.suggestionCards}S ${editor.commentCards}C | FS: ${fs.suggestions.length}S ${fs.comments.length}C` +
    (errors.length > 0 ? ' — ' + errors.join('; ') : ''));
  for (const err of errors) expect.soft(false, `[${step}] ${err}`).toBe(true);
}

test('Soak test: full editing session with suggestions, comments, bold, discard, resolve, accept', async ({ page }) => {
  test.setTimeout(300000);
  let savedContent = null;
  const usedWords = [];

  try {
    await clearAll();
    savedContent = await saveCleanFile();
    await page.goto(BASE_URL + TEST_SESSION_PATH);
    await login(page);
    await enterSuggest(page);

    // === R1: Create 2 suggestions + 1 comment ===
    console.log('\n=== R1: Create 2 suggestions + 1 comment ===');
    let doc = await page.evaluate(() => window.__editorView.state.doc.toString());
    let words = findUniqueWords(doc, 4, usedWords);
    usedWords.push(...words);

    // Suggestion 1: append
    await page.evaluate((w) => {
      const v = window.__editorView, p = v.state.doc.toString().indexOf(w);
      v.dispatch({ selection: { anchor: p, head: p + w.length }, scrollIntoView: true });
      v.dispatch(v.state.replaceSelection(w + 'EDIT'));
    }, words[0]);
    await page.waitForTimeout(300);

    // Suggestion 2: delete
    await page.evaluate((w) => {
      const v = window.__editorView, p = v.state.doc.toString().indexOf(w);
      v.dispatch({ selection: { anchor: p, head: p + w.length }, scrollIntoView: true });
      v.dispatch(v.state.replaceSelection(''));
    }, words[1]);
    await page.waitForTimeout(300);

    // Comment 1
    await page.evaluate((w) => {
      const v = window.__editorView, p = v.state.doc.toString().indexOf(w);
      v.dispatch({ selection: { anchor: p, head: p + w.length }, scrollIntoView: true });
    }, words[2]);
    await page.waitForTimeout(300);
    await page.locator('.comment-tooltip-comment').click();
    await page.waitForTimeout(200);
    await page.fill('#comment-popup-input', 'First comment');
    await page.click('#comment-popup-submit');
    await page.waitForTimeout(4000);
    await verify(page, 'R1: 2 suggs + 1 comment', 2, 1);

    // === R2: Leave and re-enter ===
    console.log('\n=== R2: Leave/re-enter ===');
    await leaveSuggest(page);
    await login(page);
    await enterSuggest(page);
    await page.waitForTimeout(2000);
    await verify(page, 'R2: after re-enter', 2, 1);

    // === R3: Add a comment mid-session ===
    console.log('\n=== R3: Add comment mid-session ===');
    doc = await page.evaluate(() => window.__editorView.state.doc.toString());
    const commentWord2 = findUniqueWords(doc, 1, usedWords)[0];
    usedWords.push(commentWord2);
    await page.evaluate((w) => {
      const v = window.__editorView, p = v.state.doc.toString().indexOf(w);
      v.dispatch({ selection: { anchor: p, head: p + w.length }, scrollIntoView: true });
    }, commentWord2);
    await page.waitForTimeout(300);
    await page.locator('.comment-tooltip-comment').click();
    await page.waitForTimeout(200);
    await page.fill('#comment-popup-input', 'Second comment added mid-session');
    await page.click('#comment-popup-submit');
    await page.waitForTimeout(2000);
    await verify(page, 'R3: after second comment', 2, 2);

    // === R4: Discard a suggestion — comments should survive ===
    console.log('\n=== R4: Discard suggestion ===');
    const rejectBtn = page.locator('.margin-action--reject').first();
    if (await rejectBtn.isVisible()) {
      await rejectBtn.click();
      await page.waitForTimeout(4000);
    }
    await verify(page, 'R4: after discard', 1, 2);

    // === R5: Bold a word ===
    console.log('\n=== R5: Bold a word ===');
    doc = await page.evaluate(() => window.__editorView.state.doc.toString());
    const boldWord = findUniqueWords(doc, 1, usedWords)[0];
    usedWords.push(boldWord);
    if (boldWord) {
      await page.evaluate((w) => {
        const v = window.__editorView, p = v.state.doc.toString().indexOf(w);
        v.dispatch({ selection: { anchor: p, head: p + w.length }, scrollIntoView: true });
      }, boldWord);
      await page.waitForTimeout(300);
      const boldBtn = page.locator('.comment-tooltip-bold');
      if (await boldBtn.isVisible()) { await boldBtn.click(); await page.waitForTimeout(4000); }
    }
    await verify(page, 'R5: after bold');

    // === R6: Leave and re-enter ===
    console.log('\n=== R6: Leave/re-enter ===');
    await leaveSuggest(page);
    await login(page);
    await enterSuggest(page);
    await page.waitForTimeout(2000);
    await verify(page, 'R6: after re-enter');

    // === R7: Resolve a comment ===
    console.log('\n=== R7: Resolve a comment ===');
    const resolveBtn = page.locator('.margin-action--resolve').first();
    if (await resolveBtn.isVisible()) {
      await resolveBtn.click();
      await page.waitForTimeout(2000);
    }
    await verify(page, 'R7: after resolve comment', undefined, 1);

    // === R8: Add another suggestion + another comment ===
    console.log('\n=== R8: New suggestion + new comment ===');
    doc = await page.evaluate(() => window.__editorView.state.doc.toString());
    const newWords = findUniqueWords(doc, 2, usedWords);
    usedWords.push(...newWords);
    if (newWords[0]) {
      await page.evaluate((w) => {
        const v = window.__editorView, p = v.state.doc.toString().indexOf(w);
        v.dispatch({ selection: { anchor: p, head: p + w.length }, scrollIntoView: true });
        v.dispatch(v.state.replaceSelection(w + 'NEW'));
      }, newWords[0]);
      await page.waitForTimeout(300);
    }
    if (newWords[1]) {
      await page.evaluate((w) => {
        const v = window.__editorView, p = v.state.doc.toString().indexOf(w);
        v.dispatch({ selection: { anchor: p, head: p + w.length }, scrollIntoView: true });
      }, newWords[1]);
      await page.waitForTimeout(300);
      await page.locator('.comment-tooltip-comment').click();
      await page.waitForTimeout(200);
      await page.fill('#comment-popup-input', 'Third comment');
      await page.click('#comment-popup-submit');
      await page.waitForTimeout(4000);
    }
    await verify(page, 'R8: after new suggestion + comment', undefined, 2);

    // === R9: Leave and re-enter one more time ===
    console.log('\n=== R9: Final leave/re-enter ===');
    await leaveSuggest(page);
    await login(page);
    await enterSuggest(page);
    await page.waitForTimeout(2000);
    await verify(page, 'R9: final re-enter');

    // === R10: Accept a suggestion ===
    console.log('\n=== R10: Accept a suggestion ===');
    const acceptBtn = page.locator('.margin-action--accept').first();
    if (await acceptBtn.isVisible()) {
      await acceptBtn.click();
      await page.waitForTimeout(8000);
    }
    await verify(page, 'R10: after accept');

    // === R11: Discard remaining suggestion if any ===
    console.log('\n=== R11: Discard remaining suggestions ===');
    const rejectBtn2 = page.locator('.margin-action--reject').first();
    if (await rejectBtn2.isVisible()) {
      await rejectBtn2.click();
      await page.waitForTimeout(4000);
    }
    await verify(page, 'R11: after final discard');

    // === R12: Final state ===
    console.log('\n=== R12: Final state ===');
    const finalEditor = await getEditorState(page);
    console.log('Final:', finalEditor.suggestionCards, 'sugg cards,', finalEditor.commentCards, 'comment cards');
    for (const cp of finalEditor.cardPositions) {
      expect(cp.top).toBeGreaterThan(10);
    }

  } finally {
    await clearAll();
    await restoreFile(savedContent);
  }
});
