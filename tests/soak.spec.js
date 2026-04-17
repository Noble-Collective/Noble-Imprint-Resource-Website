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
    const snap = await db.collection(col).where('filePath', '==', TEST_FILE).get();
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

  // 1. No cards stuck at position 0
  const topCards = editor.cardPositions.filter(c => c.top < 10);
  if (topCards.length > 0) {
    const details = await page.evaluate(() => {
      return [...document.querySelectorAll('.margin-card')].filter(c => parseFloat(c.style.top) < 10)
        .map(c => ({ type: c.classList.contains('margin-card--comment') ? 'C' : 'S', body: (c.querySelector('.margin-card-body')?.textContent || '').substring(0, 30) }));
    });
    errors.push(`card(s) stuck at top: ${JSON.stringify(details)}`);
  }

  // 2. No Firestore duplicates
  const suggKeys = fs.suggestions.map(s => s.originalText + '@' + s.originalFrom);
  if (new Set(suggKeys).size < suggKeys.length) errors.push(`Duplicate suggestions in Firestore`);

  // 3. Firestore count checks
  if (expectedSuggs !== undefined && fs.suggestions.length !== expectedSuggs)
    errors.push(`Expected ${expectedSuggs} FS suggestions, got ${fs.suggestions.length}`);
  if (expectedComments !== undefined && fs.comments.length !== expectedComments)
    errors.push(`Expected ${expectedComments} FS comments, got ${fs.comments.length}`);

  // 4. Registry ↔ Firestore consistency: every Firestore entry should be in the registry
  const registryState = await page.evaluate(() => {
    const v = window.__editorView;
    if (!v || !window.__annotationRegistry) return null;
    const reg = v.state.field(window.__annotationRegistry);
    const entries = [];
    for (const [id, a] of reg) {
      entries.push({
        id, kind: a.kind, type: a.type,
        currentFrom: a.currentFrom, currentTo: a.currentTo,
        newText: a.newText || null, originalText: a.originalText || null,
        selectedText: a.selectedText || null,
      });
    }
    return { entries, docLen: v.state.doc.length, doc: v.state.doc.toString() };
  });

  if (!registryState) {
    errors.push('Editor registry not available');
  } else {
    const regById = {};
    for (const e of registryState.entries) regById[e.id] = e;

    // 4a. Every Firestore suggestion has a registry entry
    for (const s of fs.suggestions) {
      if (!regById[s.id]) {
        errors.push(`FS suggestion "${(s.newText || s.originalText || '').substring(0, 15)}" (${s.id}) missing from registry`);
      }
    }
    for (const c of fs.comments) {
      if (!regById[c.id]) {
        errors.push(`FS comment "${(c.selectedText || '').substring(0, 15)}" (${c.id}) missing from registry`);
      }
    }

    // 5. Exact highlight text verification via registry positions
    // For each registry entry, check the doc text at currentFrom..currentTo matches expected text,
    // then scroll there and verify the DOM decoration covers exactly those characters.
    for (const entry of registryState.entries) {
      if (entry.currentFrom == null || entry.currentTo == null) continue;
      if (entry.currentFrom < 0 || entry.currentTo > registryState.docLen) continue;

      if (entry.kind === 'suggestion' && (entry.type === 'insertion' || entry.type === 'replacement')) {
        // Check: doc text at registry position matches newText
        const docSlice = registryState.doc.slice(entry.currentFrom, entry.currentTo);
        if (entry.newText && docSlice !== entry.newText) {
          errors.push(`Suggestion "${entry.newText.substring(0, 15)}": doc[${entry.currentFrom}..${entry.currentTo}]="${docSlice.substring(0, 15)}" !== newText`);
        }

        // Scroll to position and verify DOM decoration has exact text
        await page.evaluate(({ pos }) => {
          if (window.__editorView) window.__editorView.dispatch({ selection: { anchor: pos }, scrollIntoView: true });
        }, { pos: entry.currentFrom });
        await page.waitForTimeout(200);

        const decoCheck = await page.evaluate(({ id, expectedText }) => {
          const el = document.querySelector(`.cm-suggestion-insert[data-hunk-id="${id}"]`);
          if (!el) return { found: false };
          return { found: true, text: el.textContent };
        }, { id: entry.id, expectedText: entry.newText });

        if (!decoCheck.found) {
          errors.push(`Insert decoration missing for hunk ${entry.id} "${(entry.newText || '').substring(0, 15)}"`);
        } else if (entry.newText && decoCheck.text !== entry.newText) {
          errors.push(`Insert decoration text mismatch for "${entry.newText.substring(0, 15)}": DOM="${decoCheck.text.substring(0, 15)}" !== expected`);
        }
      }

      if (entry.kind === 'suggestion' && (entry.type === 'deletion' || entry.type === 'replacement')) {
        // Deletion widget: check DOM has the widget with correct data-hunk-id
        await page.evaluate(({ pos }) => {
          if (window.__editorView) window.__editorView.dispatch({ selection: { anchor: pos }, scrollIntoView: true });
        }, { pos: entry.currentFrom });
        await page.waitForTimeout(200);

        const delCheck = await page.evaluate(({ id, expectedOriginal }) => {
          const el = document.querySelector(`.cm-suggestion-delete[data-hunk-id="${id}"]`);
          if (!el) return { found: false };
          return { found: true, text: el.textContent };
        }, { id: entry.id, expectedOriginal: entry.originalText });

        if (!delCheck.found) {
          errors.push(`Delete widget missing for hunk ${entry.id} "${(entry.originalText || '').substring(0, 15)}"`);
        } else if (entry.originalText && delCheck.text !== entry.originalText) {
          errors.push(`Delete widget text mismatch for "${entry.originalText.substring(0, 15)}": DOM="${delCheck.text.substring(0, 15)}" !== expected`);
        }
      }

      if (entry.kind === 'comment') {
        // Check: doc text at registry position matches selectedText
        const docSlice = registryState.doc.slice(entry.currentFrom, entry.currentTo);
        if (entry.selectedText && docSlice !== entry.selectedText) {
          errors.push(`Comment highlight range wrong: doc[${entry.currentFrom}..${entry.currentTo}]="${docSlice.substring(0, 15)}" !== "${entry.selectedText.substring(0, 15)}"`);
        }

        await page.evaluate(({ pos }) => {
          if (window.__editorView) window.__editorView.dispatch({ selection: { anchor: pos }, scrollIntoView: true });
        }, { pos: entry.currentFrom });
        await page.waitForTimeout(200);

        const commentCheck = await page.evaluate(({ id, expectedText }) => {
          const el = document.querySelector(`.cm-comment-highlight[data-comment-id="${id}"]`);
          if (!el) return { found: false };
          return { found: true, text: el.textContent };
        }, { id: entry.id, expectedText: entry.selectedText });

        if (!commentCheck.found) {
          errors.push(`Comment highlight missing for ${entry.id} "${(entry.selectedText || '').substring(0, 15)}"`);
        } else if (entry.selectedText && commentCheck.text !== entry.selectedText) {
          errors.push(`Comment highlight text mismatch: DOM="${commentCheck.text.substring(0, 15)}" !== "${entry.selectedText.substring(0, 15)}"`);
        }
      }
    }

    // 6. Every inline decoration has a matching margin card (and vice versa)
    const cardVsDecoCheck = await page.evaluate(() => {
      const errors = [];
      // Suggestion cards → inline decorations
      const suggCards = document.querySelectorAll('.margin-card--suggestion:not(.margin-card--stale)');
      for (const card of suggCards) {
        const hunkId = card.dataset.hunkId;
        if (!hunkId) continue;
        // Check for linked IDs (bold groups)
        const linkedIds = card.dataset.linkedIds ? card.dataset.linkedIds.split(',') : [hunkId];
        for (const id of linkedIds) {
          const deco = document.querySelector(`.cm-suggestion-insert[data-hunk-id="${id}"], .cm-suggestion-delete[data-hunk-id="${id}"]`);
          if (!deco) errors.push(`Card ${id} has no inline decoration`);
        }
      }
      // Comment cards → inline highlights
      const commentCards = document.querySelectorAll('.margin-card--comment');
      for (const card of commentCards) {
        const commentId = card.dataset.commentId;
        if (!commentId) continue;
        const deco = document.querySelector(`.cm-comment-highlight[data-comment-id="${commentId}"]`);
        if (!deco) errors.push(`Comment card ${commentId} has no inline highlight`);
      }
      // Inline decorations → margin cards (orphan check)
      const insertDecos = document.querySelectorAll('.cm-suggestion-insert[data-hunk-id]');
      for (const deco of insertDecos) {
        const id = deco.dataset.hunkId;
        const card = document.querySelector(`.margin-card[data-hunk-id="${id}"]`)
          || document.querySelector(`.margin-card[data-linked-ids*="${id}"]`);
        if (!card) errors.push(`Orphan insert decoration ${id} (no card)`);
      }
      const commentDecos = document.querySelectorAll('.cm-comment-highlight[data-comment-id]');
      for (const deco of commentDecos) {
        const id = deco.dataset.commentId;
        const card = document.querySelector(`.margin-card[data-comment-id="${id}"]`);
        if (!card) errors.push(`Orphan comment highlight ${id} (no card)`);
      }
      return errors;
    });
    errors.push(...cardVsDecoCheck);
  }

  // 7. Card order matches document order
  const cardOrder = await page.evaluate(() => {
    const cards = [...document.querySelectorAll('.margin-card')];
    return cards.map(c => ({
      top: parseFloat(c.style.top) || 0,
      hunkId: c.dataset.hunkId || null,
      commentId: c.dataset.commentId || null,
    })).sort((a, b) => a.top - b.top);
  });
  const allAnnotations = [
    ...fs.suggestions.map(s => ({ id: s.id, pos: s.resolvedFrom || s.originalFrom || 0, type: 'S' })),
    ...fs.comments.map(c => ({ id: c.id, pos: c.resolvedFrom || c.from || 0, type: 'C' })),
  ].sort((a, b) => a.pos - b.pos);
  const cardIds = cardOrder.map(c => c.hunkId || c.commentId).filter(Boolean);
  const expectedIds = allAnnotations.map(a => a.id);
  let lastExpectedIdx = -1;
  let orderOk = true;
  for (const cid of cardIds) {
    const idx = expectedIds.indexOf(cid);
    if (idx >= 0 && idx < lastExpectedIdx) { orderOk = false; break; }
    if (idx >= 0) lastExpectedIdx = idx;
  }
  if (!orderOk) errors.push(`Cards not in document order`);

  // 8. DOM card count matches Firestore (accounting for linked bold groups)
  const linkedGroupCount = await page.evaluate(() => {
    return document.querySelectorAll('.margin-card--suggestion:not(.margin-card--stale)').length;
  });
  const commentCardCount = await page.evaluate(() => {
    return document.querySelectorAll('.margin-card--comment').length;
  });
  // Bold groups: N Firestore suggestions may map to fewer cards.
  // But card count should never EXCEED Firestore count.
  if (linkedGroupCount > fs.suggestions.length) {
    errors.push(`More suggestion cards (${linkedGroupCount}) than Firestore suggestions (${fs.suggestions.length})`);
  }
  if (commentCardCount !== fs.comments.length) {
    errors.push(`Comment card count ${commentCardCount} !== Firestore ${fs.comments.length}`);
  }

  const status = errors.length === 0 ? 'OK' : 'FAIL';
  console.log(`[${step}] ${status} — ${linkedGroupCount}S ${commentCardCount}C cards | FS: ${fs.suggestions.length}S ${fs.comments.length}C` +
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
