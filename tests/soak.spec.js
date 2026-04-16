// Soak test: simulate a real editing session with random suggestions, comments,
// bold/italic, discards, accepts, mode exits/re-entries — verify consistency after each step.
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
    const insertDecos = document.querySelectorAll('.cm-suggestion-insert');
    const deleteDecos = document.querySelectorAll('.cm-suggestion-delete');
    const commentHighlights = document.querySelectorAll('.cm-comment-highlight');
    return {
      suggestionCards: suggCards.length,
      commentCards: commentCards.length,
      insertDecos: insertDecos.length,
      deleteDecos: deleteDecos.length,
      commentHighlights: commentHighlights.length,
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

// Verify consistency: no cards at top=0, card count matches firestore, no duplicates
async function verify(page, step, expectedSuggs, expectedComments) {
  await page.waitForTimeout(500);
  const editor = await getEditorState(page);
  const fs = await getFirestoreState();
  const errors = [];

  // Check for cards stuck at top (position 0-10)
  const topCards = editor.cardPositions.filter(c => c.top < 10);
  if (topCards.length > 0) {
    errors.push(`${topCards.length} card(s) stuck at top (pos < 10px): ${topCards.map(c => c.type + '@' + c.top).join(', ')}`);
  }

  // Check Firestore for duplicate suggestions (same originalText+originalFrom)
  const suggKeys = fs.suggestions.map(s => s.originalText + '@' + s.originalFrom);
  const uniqueSuggs = new Set(suggKeys);
  if (uniqueSuggs.size < suggKeys.length) {
    errors.push(`Duplicate suggestions in Firestore: ${suggKeys.length} total, ${uniqueSuggs.size} unique`);
  }

  // Check expected counts if provided
  if (expectedSuggs !== undefined && fs.suggestions.length !== expectedSuggs) {
    errors.push(`Expected ${expectedSuggs} Firestore suggestions, got ${fs.suggestions.length}`);
  }
  if (expectedComments !== undefined && fs.comments.length !== expectedComments) {
    errors.push(`Expected ${expectedComments} Firestore comments, got ${fs.comments.length}`);
  }

  // Check suggestion card count vs Firestore (allow for draft hunks that haven't saved yet)
  // Cards can be more than Firestore (drafts) but shouldn't be way more
  if (editor.suggestionCards > fs.suggestions.length + 3) {
    errors.push(`Too many suggestion cards: ${editor.suggestionCards} cards vs ${fs.suggestions.length} in Firestore`);
  }

  const status = errors.length === 0 ? 'OK' : 'FAIL';
  console.log(`[${step}] ${status} — ${editor.suggestionCards} sugg cards, ${editor.commentCards} comment cards, ` +
    `${fs.suggestions.length} FS suggs, ${fs.comments.length} FS comments` +
    (errors.length > 0 ? ' — ' + errors.join('; ') : ''));

  for (const err of errors) {
    expect.soft(false, `[${step}] ${err}`).toBe(true);
  }
}

test('Soak test: full editing session with random operations', async ({ page }) => {
  test.setTimeout(300000); // 5 minutes
  let savedContent = null;
  const usedWords = [];

  try {
    await clearAll();
    savedContent = await saveCleanFile();

    // === ROUND 1: Create some suggestions and comments ===
    await page.goto(BASE_URL + TEST_SESSION_PATH);
    await login(page);
    await enterSuggest(page);

    let doc = await page.evaluate(() => window.__editorView.state.doc.toString());
    let words = findUniqueWords(doc, 5, usedWords);
    usedWords.push(...words);
    console.log('\n=== ROUND 1: Create 3 suggestions + 2 comments ===');

    // Suggestion 1: replace word
    await page.evaluate((w) => {
      const view = window.__editorView;
      const pos = view.state.doc.toString().indexOf(w);
      view.dispatch({ selection: { anchor: pos, head: pos + w.length }, scrollIntoView: true });
      view.dispatch(view.state.replaceSelection(w + 'EDIT'));
    }, words[0]);
    await page.waitForTimeout(300);

    // Suggestion 2: replace another word
    await page.evaluate((w) => {
      const view = window.__editorView;
      const pos = view.state.doc.toString().indexOf(w);
      view.dispatch({ selection: { anchor: pos, head: pos + w.length }, scrollIntoView: true });
      view.dispatch(view.state.replaceSelection('NEW' + w));
    }, words[1]);
    await page.waitForTimeout(300);

    // Suggestion 3: delete a word
    await page.evaluate((w) => {
      const view = window.__editorView;
      const pos = view.state.doc.toString().indexOf(w);
      view.dispatch({ selection: { anchor: pos, head: pos + w.length }, scrollIntoView: true });
      view.dispatch(view.state.replaceSelection(''));
    }, words[2]);
    await page.waitForTimeout(300);

    // Comment 1
    await page.evaluate((w) => {
      const view = window.__editorView;
      const pos = view.state.doc.toString().indexOf(w);
      view.dispatch({ selection: { anchor: pos, head: pos + w.length }, scrollIntoView: true });
    }, words[3]);
    await page.waitForTimeout(300);
    await page.locator('.comment-tooltip-comment').click();
    await page.waitForTimeout(200);
    await page.fill('#comment-popup-input', 'First comment');
    await page.click('#comment-popup-submit');
    await page.waitForTimeout(1500);

    // Comment 2
    await page.evaluate((w) => {
      const view = window.__editorView;
      const pos = view.state.doc.toString().indexOf(w);
      view.dispatch({ selection: { anchor: pos, head: pos + w.length }, scrollIntoView: true });
    }, words[4]);
    await page.waitForTimeout(300);
    await page.locator('.comment-tooltip-comment').click();
    await page.waitForTimeout(200);
    await page.fill('#comment-popup-input', 'Second comment');
    await page.click('#comment-popup-submit');
    await page.waitForTimeout(1500);

    // Wait for auto-save
    await page.waitForTimeout(4000);
    await verify(page, 'R1: after creating 3 suggs + 2 comments', 3, 2);

    // === ROUND 2: Leave and re-enter suggest mode ===
    console.log('\n=== ROUND 2: Leave and re-enter ===');
    await leaveSuggest(page);
    await login(page);
    await enterSuggest(page);
    await page.waitForTimeout(2000);
    await verify(page, 'R2: after re-enter', 3, 2);

    // === ROUND 3: Discard the first suggestion ===
    console.log('\n=== ROUND 3: Discard first suggestion ===');
    const rejectBtn = page.locator('.margin-action--reject').first();
    if (await rejectBtn.isVisible()) {
      await rejectBtn.click();
      await page.waitForTimeout(4000);
    }
    await verify(page, 'R3: after discard', 2, 2);

    // === ROUND 4: Bold a word ===
    console.log('\n=== ROUND 4: Bold a word ===');
    doc = await page.evaluate(() => window.__editorView.state.doc.toString());
    const boldWord = findUniqueWords(doc, 1, usedWords)[0];
    usedWords.push(boldWord);
    if (boldWord) {
      await page.evaluate((w) => {
        const view = window.__editorView;
        const pos = view.state.doc.toString().indexOf(w);
        view.dispatch({ selection: { anchor: pos, head: pos + w.length }, scrollIntoView: true });
      }, boldWord);
      await page.waitForTimeout(300);
      const boldBtn = page.locator('.comment-tooltip-bold');
      if (await boldBtn.isVisible()) {
        await boldBtn.click();
        await page.waitForTimeout(4000);
      }
    }
    await verify(page, 'R4: after bold');

    // === ROUND 5: Leave and re-enter again ===
    console.log('\n=== ROUND 5: Leave and re-enter again ===');
    await leaveSuggest(page);
    await login(page);
    await enterSuggest(page);
    await page.waitForTimeout(2000);
    await verify(page, 'R5: after second re-enter');

    // === ROUND 6: Discard another suggestion ===
    console.log('\n=== ROUND 6: Discard another suggestion ===');
    const rejectBtn2 = page.locator('.margin-action--reject').first();
    if (await rejectBtn2.isVisible()) {
      await rejectBtn2.click();
      await page.waitForTimeout(4000);
    }
    await verify(page, 'R6: after second discard');

    // === ROUND 7: Add another suggestion ===
    console.log('\n=== ROUND 7: Add another suggestion ===');
    doc = await page.evaluate(() => window.__editorView.state.doc.toString());
    const newWord = findUniqueWords(doc, 1, usedWords)[0];
    usedWords.push(newWord);
    if (newWord) {
      await page.evaluate((w) => {
        const view = window.__editorView;
        const pos = view.state.doc.toString().indexOf(w);
        view.dispatch({ selection: { anchor: pos, head: pos + w.length }, scrollIntoView: true });
        view.dispatch(view.state.replaceSelection(w + 'NEW'));
      }, newWord);
      await page.waitForTimeout(4000);
    }
    await verify(page, 'R7: after new suggestion');

    // === ROUND 8: Leave and re-enter one more time ===
    console.log('\n=== ROUND 8: Final leave/re-enter ===');
    await leaveSuggest(page);
    await login(page);
    await enterSuggest(page);
    await page.waitForTimeout(2000);
    await verify(page, 'R8: final re-enter');

    // === ROUND 9: Accept a suggestion ===
    console.log('\n=== ROUND 9: Accept a suggestion ===');
    const acceptBtn = page.locator('.margin-action--accept').first();
    if (await acceptBtn.isVisible()) {
      await acceptBtn.click();
      await page.waitForTimeout(8000);
    }
    await verify(page, 'R9: after accept');

    // === ROUND 10: Final state check ===
    console.log('\n=== ROUND 10: Final state ===');
    const finalFs = await getFirestoreState();
    const finalEditor = await getEditorState(page);
    console.log('Final Firestore:', finalFs.suggestions.length, 'suggestions,', finalFs.comments.length, 'comments');
    console.log('Final Editor:', finalEditor.suggestionCards, 'sugg cards,', finalEditor.commentCards, 'comment cards');
    console.log('Final card positions:', finalEditor.cardPositions.map(c => c.type + '@' + Math.round(c.top)));

    // No cards should be at position 0
    for (const cp of finalEditor.cardPositions) {
      expect(cp.top).toBeGreaterThan(10);
    }

  } finally {
    await clearAll();
    await restoreFile(savedContent);
  }
});
