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

    // === R8: Inject suggestion + comment via Claude API (bot user) ===
    console.log('\n=== R8: Claude API suggestion + comment ===');
    // Leave suggest mode so we can re-enter and pick up API-injected annotations
    await leaveSuggest(page);

    // Read file content to get positions for API calls
    const github = require('../src/server/github');
    const { content: fileContent, sha: fileSha } = await github.getFileContent(TEST_FILE);
    const apiWords = findUniqueWords(fileContent, 2, usedWords);
    usedWords.push(...apiWords);
    const apiSuggWord = apiWords[0];
    const apiCommentWord = apiWords[1];
    const apiSuggPos = fileContent.indexOf(apiSuggWord);
    const apiCommentPos = fileContent.indexOf(apiCommentWord);
    const apiNewText = apiSuggWord + 'API';
    console.log('API suggestion:', apiSuggWord, '→', apiNewText, 'at', apiSuggPos);
    console.log('API comment on:', apiCommentWord, 'at', apiCommentPos);

    // Submit suggestion with reason via API
    const apiKey = process.env.CLAUDE_API_KEY || '';
    // Use a standalone request context (no browser cookies) so the API key auth
    // identifies us as the Claude bot, not the logged-in test user
    const botContext = await require('playwright').request.newContext();
    const suggRes = await (await botContext.post(`${BASE_URL}/api/suggestions/hunk`, {
      headers: { 'x-api-key': apiKey, 'Content-Type': 'application/json' },
      data: {
        filePath: TEST_FILE,
        bookPath: 'series/Narrative Journey Series/Foundations/Test Book',
        baseCommitSha: fileSha,
        type: 'replacement',
        originalFrom: apiSuggPos,
        originalTo: apiSuggPos + apiSuggWord.length,
        originalText: apiSuggWord,
        newText: apiNewText,
        contextBefore: fileContent.substring(Math.max(0, apiSuggPos - 50), apiSuggPos),
        contextAfter: fileContent.substring(apiSuggPos + apiSuggWord.length, apiSuggPos + apiSuggWord.length + 50),
        reason: 'Test reason from Claude API',
      },
    })).json();
    console.log('API suggestion created:', suggRes.id, 'replyId:', suggRes.replyId);
    expect(suggRes.status).toBe('ok');
    expect(suggRes.replyId).toBeTruthy();

    // Submit comment via API
    const commentRes = await (await botContext.post(`${BASE_URL}/api/suggestions/comments`, {
      headers: { 'x-api-key': apiKey, 'Content-Type': 'application/json' },
      data: {
        filePath: TEST_FILE,
        bookPath: 'series/Narrative Journey Series/Foundations/Test Book',
        baseCommitSha: fileSha,
        from: apiCommentPos,
        to: apiCommentPos + apiCommentWord.length,
        selectedText: apiCommentWord,
        commentText: 'Test comment from Claude API',
      },
    })).json();
    console.log('API comment created:', commentRes.id);
    expect(commentRes.status).toBe('ok');
    await botContext.dispose();

    // Re-enter suggest mode to pick up API-injected annotations
    await login(page);
    await enterSuggest(page);
    await page.waitForTimeout(2000);

    // Verify API suggestion shows as Claude AI with reply, and no duplicate Steve card
    const apiCheck = await page.evaluate(({ suggId, replyId, newText, commentId, commentWord }) => {
      const errors = [];
      // Check suggestion card exists and is from Claude AI
      const suggCard = document.querySelector(`.margin-card[data-hunk-id="${suggId}"]`);
      if (!suggCard) { errors.push('API suggestion card not found'); }
      else {
        const name = suggCard.querySelector('.margin-card-name')?.textContent || '';
        if (!name.includes('Claude')) errors.push(`API suggestion author is "${name}", expected Claude`);
        // Check reply thread exists
        const reply = suggCard.querySelector('.margin-card-reply-text');
        if (!reply) errors.push('API suggestion has no reply thread');
        else if (!reply.textContent.includes('Test reason')) errors.push(`Reply text: "${reply.textContent}"`);
      }
      // Check no duplicate card for same text from Steve
      const allCards = document.querySelectorAll('.margin-card--suggestion');
      let dupeCount = 0;
      for (const c of allCards) {
        const body = c.querySelector('.margin-card-body')?.textContent || '';
        if (body.includes(newText.slice(-5))) dupeCount++;
      }
      if (dupeCount > 1) errors.push(`${dupeCount} cards contain "${newText}" — duplicate detected`);
      // Check comment card
      const commentCard = document.querySelector(`.margin-card[data-comment-id="${commentId}"]`);
      if (!commentCard) errors.push('API comment card not found');
      return errors;
    }, { suggId: suggRes.id, replyId: suggRes.replyId, newText: apiNewText, commentId: commentRes.id, commentWord: apiCommentWord });

    for (const err of apiCheck) {
      console.log('[R8 API check] FAIL:', err);
      expect.soft(false, `[R8] ${err}`).toBe(true);
    }
    if (apiCheck.length === 0) console.log('[R8 API check] OK');
    await verify(page, 'R8: after API injection');

    // === R9: Add another UI suggestion + comment ===
    console.log('\n=== R9: New UI suggestion + new comment ===');
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
    await verify(page, 'R9: after new UI suggestion + comment');

    // === R10: Leave and re-enter one more time ===
    console.log('\n=== R10: Final leave/re-enter ===');
    await leaveSuggest(page);
    await login(page);
    await enterSuggest(page);
    await page.waitForTimeout(2000);
    await verify(page, 'R10: final re-enter');

    // === R11: Accept the API suggestion + verify accepted text in editor ===
    console.log('\n=== R11: Accept API suggestion ===');
    // Find and click accept on the Claude API suggestion card specifically
    const apiAcceptBtn = page.locator(`.margin-card[data-hunk-id="${suggRes.id}"] .margin-action--accept`);
    if (await apiAcceptBtn.isVisible()) {
      await apiAcceptBtn.click();
      // Wait for the accept + GitHub commit + refresh cycle to complete
      // Poll until the suggestion card disappears (more reliable than a fixed timeout)
      await page.waitForFunction(
        (id) => !document.querySelector(`.margin-card[data-hunk-id="${id}"]`)
          || document.querySelector(`.margin-card[data-hunk-id="${id}"]`).classList.contains('margin-card--removing'),
        suggRes.id,
        { timeout: 15000 }
      ).catch(() => {});
      await page.waitForTimeout(2000); // extra settle time after refresh

      // Verify accepted text is now in the base document (not as a decoration, but as real text)
      const docAfterAccept = await page.evaluate(() => window.__editorView.state.doc.toString());
      const acceptedTextPresent = docAfterAccept.includes(apiNewText);
      if (!acceptedTextPresent) {
        console.log('[R11] FAIL: accepted text "' + apiNewText + '" not found in editor after refresh');
        expect.soft(false, `[R11] Accepted text "${apiNewText}" not in editor`).toBe(true);
      } else {
        console.log('[R11] OK: accepted text "' + apiNewText + '" found in editor');
      }

      // Verify the accepted suggestion's card is gone (no longer pending)
      const acceptedCardGone = await page.evaluate(({ id }) => {
        const card = document.querySelector(`.margin-card[data-hunk-id="${id}"]`);
        return !card || card.classList.contains('margin-card--removing');
      }, { id: suggRes.id });
      if (!acceptedCardGone) {
        expect.soft(false, '[R11] Accepted suggestion card still visible').toBe(true);
      }

      // Verify no insert decoration for the accepted text (it's now base content)
      const noDecoForAccepted = await page.evaluate(({ id }) => {
        return !document.querySelector(`.cm-suggestion-insert[data-hunk-id="${id}"]`);
      }, { id: suggRes.id });
      if (!noDecoForAccepted) {
        expect.soft(false, '[R11] Insert decoration still present after accept').toBe(true);
      }
    } else {
      console.log('[R11] WARN: API suggestion accept button not visible');
    }
    await verify(page, 'R11: after accept API suggestion');

    // === R12: Discard remaining suggestions ===
    console.log('\n=== R12: Discard remaining suggestions ===');
    let remainingRejects = await page.locator('.margin-action--reject').count();
    while (remainingRejects > 0) {
      await page.locator('.margin-action--reject').first().click();
      await page.waitForTimeout(4000);
      remainingRejects = await page.locator('.margin-action--reject').count();
    }
    await verify(page, 'R12: after final discard');

    // === R13: Final state ===
    console.log('\n=== R13: Final state ===');
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
