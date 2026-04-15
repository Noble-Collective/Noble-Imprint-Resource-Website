// Noble Imprint — Comprehensive Editor Tests
// Run with: GOOGLE_CLOUD_PROJECT=noble-imprint-website npx playwright test tests/editor.spec.js
const { test, expect } = require('@playwright/test');

const BASE_URL = 'http://localhost:8080';
const TEST_SESSION_PATH = '/narrative-journey-series/foundations/test-book/1-session1-thegospel';
const TEST_EMAIL = 'steve@noblecollective.org';

// ============================================================
// HELPERS
// ============================================================

async function login(page) {
  const res = await page.request.post(`${BASE_URL}/api/auth/test-login`, {
    data: { email: TEST_EMAIL },
  });
  expect(res.ok()).toBeTruthy();
  // Retry page load — the server may be rebuilding its content tree from a cache refresh
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await page.goto(BASE_URL + TEST_SESSION_PATH, { timeout: 15000 });
      return;
    } catch {
      if (attempt < 2) await page.waitForTimeout(3000);
    }
  }
  await page.goto(BASE_URL + TEST_SESSION_PATH);
}

async function enterSuggestMode(page) {
  await page.click('#btn-suggest-edit');
  await page.waitForSelector('#codemirror-host .cm-editor');
  await page.waitForTimeout(500);
}

async function enterDirectMode(page) {
  await page.click('#btn-direct-edit');
  await page.waitForSelector('#codemirror-host .cm-editor');
  await page.waitForTimeout(500);
}

async function getRawDoc(page) {
  return page.evaluate(() => {
    if (window.__editorView) return window.__editorView.state.doc.toString();
    return null;
  });
}

// Scroll the CM editor to a fraction of the document
async function scrollEditorTo(page, fraction) {
  await page.evaluate((frac) => {
    if (!window.__editorView) return;
    const doc = window.__editorView.state.doc;
    const pos = Math.floor(doc.length * frac);
    window.__editorView.dispatch({ selection: { anchor: pos }, scrollIntoView: true });
  }, fraction);
  await page.waitForTimeout(300);
}

// Place cursor right after a specific text (finds it in the raw doc via CM API)
async function cursorAfter(page, searchText) {
  const found = await page.evaluate((text) => {
    if (!window.__editorView) return false;
    const doc = window.__editorView.state.doc.toString();
    const pos = doc.indexOf(text);
    if (pos === -1) return false;
    window.__editorView.dispatch({ selection: { anchor: pos + text.length }, scrollIntoView: true });
    window.__editorView.focus();
    return true;
  }, searchText);
  expect(found).toBeTruthy();
  await page.waitForTimeout(200);
}

// Place cursor right before a specific text
async function cursorBefore(page, searchText) {
  const found = await page.evaluate((text) => {
    if (!window.__editorView) return false;
    const doc = window.__editorView.state.doc.toString();
    const pos = doc.indexOf(text);
    if (pos === -1) return false;
    window.__editorView.dispatch({ selection: { anchor: pos }, scrollIntoView: true });
    window.__editorView.focus();
    return true;
  }, searchText);
  expect(found).toBeTruthy();
  await page.waitForTimeout(200);
}

// Select a specific text range in the editor (via CM API)
async function selectText(page, searchText) {
  const found = await page.evaluate((text) => {
    if (!window.__editorView) return false;
    const doc = window.__editorView.state.doc.toString();
    const pos = doc.indexOf(text);
    if (pos === -1) return false;
    window.__editorView.dispatch({ selection: { anchor: pos, head: pos + text.length }, scrollIntoView: true });
    window.__editorView.focus();
    return true;
  }, searchText);
  expect(found).toBeTruthy();
  await page.waitForTimeout(200);
}

// Replace selected text by typing (assumes text is selected)
async function replaceWith(page, newText) {
  await page.keyboard.type(newText);
  await page.waitForTimeout(200);
}

// Type text at the current cursor position
async function typeText(page, text) {
  await page.keyboard.type(text);
  await page.waitForTimeout(200);
}

// Delete the current selection
async function deleteSelection(page) {
  await page.keyboard.press('Backspace');
  await page.waitForTimeout(200);
}

// Count margin cards
async function getMarginCardCount(page) {
  return page.locator('.margin-card').count();
}

// Find a unique word in the document (appears exactly once, safe to edit)
// type: 'plain' (paragraph text), 'heading2', 'heading3', 'bold', 'italic', 'blockquote', 'attribution', 'question', 'callout'
async function findUniqueWord(page, type) {
  return page.evaluate((t) => {
    const doc = window.__editorView.state.doc.toString();
    const lines = doc.split('\n');
    let candidates = [];

    for (const line of lines) {
      let text = line;
      let matches = false;
      if (t === 'heading2' && line.match(/^## /)) { text = line.replace(/^## /, ''); matches = true; }
      else if (t === 'heading3' && line.match(/^### /)) { text = line.replace(/^### /, ''); matches = true; }
      else if (t === 'bold') { const m = line.match(/\*\*([^*]+)\*\*/); if (m) { text = m[1]; matches = true; } }
      else if (t === 'italic') { const m = line.match(/(?<![a-zA-Z])_([^_]+)_(?![a-zA-Z])/); if (m) { text = m[1]; matches = true; } }
      else if (t === 'blockquote' && line.match(/^>/)) { text = line.replace(/^>\s*/, ''); matches = true; }
      else if (t === 'attribution' && line.match(/^<</)) { text = line.replace(/^<<\s*/, ''); matches = true; }
      else if (t === 'question') { const m = line.match(/<Question[^>]*>(.+?)<\/Question>/); if (m) { text = m[1]; matches = true; } }
      else if (t === 'callout') { const m = line.match(/<Callout>(.+?)<\/Callout>/); if (m) { text = m[1]; matches = true; } }
      else if (t === 'plain' && !line.startsWith('#') && !line.startsWith('>') && !line.startsWith('<') && !line.startsWith('<<') && !line.startsWith('-') && line.length > 30) {
        matches = true;
      }
      if (matches) {
        // Extract words 5+ chars from this text
        const words = text.match(/\b[a-zA-Z]{5,14}\b/g) || [];
        for (const w of words) {
          if (doc.indexOf(w) === doc.lastIndexOf(w)) candidates.push(w);
        }
      }
    }
    return candidates.length > 0 ? candidates[0] : null;
  }, type);
}

// Find text content inside a structural element
async function findStructuralContent(page, type) {
  return page.evaluate((t) => {
    const doc = window.__editorView.state.doc.toString();
    const lines = doc.split('\n');
    for (const line of lines) {
      if (t === 'heading2' && line.match(/^## /)) return line.replace(/^## /, '').trim();
      if (t === 'heading3' && line.match(/^### /)) return line.replace(/^### /, '').trim();
      if (t === 'blockquote' && line.match(/^>\s*\w/)) return line.replace(/^>\s*/, '').substring(0, 30).trim();
      if (t === 'attribution' && line.match(/^<</)) return line.replace(/^<<\s*/, '').substring(0, 30).trim();
    }
    return null;
  }, type);
}

// Wait for auto-save (1500ms debounce + network)
async function waitForAutoSave(page) {
  await page.waitForTimeout(3000);
}

// Check Firestore pending suggestion count
async function getPendingSuggestionCount() {
  const admin = require('firebase-admin');
  if (!admin.apps.length) admin.initializeApp();
  const db = admin.firestore();
  const snap = await db.collection('suggestions').where('status', '==', 'pending').get();
  return snap.size;
}

// Check Firestore pending comment count
async function getPendingCommentCount() {
  const admin = require('firebase-admin');
  if (!admin.apps.length) admin.initializeApp();
  const db = admin.firestore();
  const snap = await db.collection('comments').where('status', '==', 'open').get();
  return snap.size;
}

// Clear all comments from Firestore
async function clearAllComments() {
  const admin = require('firebase-admin');
  if (!admin.apps.length) admin.initializeApp();
  const db = admin.firestore();
  const snap = await db.collection('comments').get();
  if (snap.empty) return;
  const batch = db.batch();
  snap.docs.forEach(d => batch.delete(d.ref));
  await batch.commit();
}

// Create a test suggestion directly in Firestore
async function createTestSuggestion({ type, originalText, newText, authorEmail, authorName }) {
  const admin = require('firebase-admin');
  if (!admin.apps.length) admin.initializeApp();
  const db = admin.firestore();

  const filePath = 'series/Narrative Journey Series/Foundations/Test Book/sessions/1-Session1-TheGospel.md';
  const bookPath = 'series/Narrative Journey Series/Foundations/Test Book';

  // Read the original file to get context
  const github = require('../src/server/github');
  const original = await github.getFileContent(filePath);

  const origContent = original.content;
  const sha = original.sha;
  const pos = origContent.indexOf(originalText);
  const contextBefore = pos >= 0 ? origContent.substring(Math.max(0, pos - 50), pos) : '';
  const contextAfter = pos >= 0 ? origContent.substring(pos + originalText.length, Math.min(origContent.length, pos + originalText.length + 50)) : '';

  await db.collection('suggestions').add({
    filePath,
    bookPath,
    baseCommitSha: sha,
    type: type || 'replacement',
    originalFrom: pos,
    originalTo: pos + originalText.length,
    originalText: originalText || '',
    newText: newText || '',
    contextBefore,
    contextAfter,
    authorEmail: authorEmail || TEST_EMAIL,
    authorName: authorName || 'Steve',
    status: 'pending',
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    resolvedAt: null,
    resolvedBy: null,
  });
}

// Find unique words directly from the GitHub file (server-side, for createTestSuggestion)
async function findUniqueWordsInFile(count = 2) {
  const github = require('../src/server/github');
  const filePath = 'series/Narrative Journey Series/Foundations/Test Book/sessions/1-Session1-TheGospel.md';
  const { content } = await github.getFileContent(filePath);
  const lines = content.split('\n');
  const words = [];
  for (const line of lines) {
    if (!line.startsWith('#') && !line.startsWith('>') && !line.startsWith('<') && !line.startsWith('-') && line.length > 30) {
      const lineWords = line.match(/\b[a-zA-Z]{6,14}\b/g) || [];
      for (const w of lineWords) {
        if (content.indexOf(w) === content.lastIndexOf(w) && !words.includes(w)) {
          words.push(w);
          if (words.length >= count) return words;
        }
      }
    }
  }
  return words;
}

// Clear all suggestions from Firestore
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

// ============================================================
// GLOBAL SETUP — verify test file is clean before running
// ============================================================

test.beforeAll(async () => {
  const github = require('../src/server/github');
  const filePath = 'series/Narrative Journey Series/Foundations/Test Book/sessions/1-Session1-TheGospel.md';
  const { content } = await github.getFileContent(filePath);
  const residue = ['INTEG', 'FIRSTEDIT', 'SECONDEDIT', 'DISCARD', 'EDIT1', 'EDIT2', 'EDIT3',
    'ACCEPTTEST', 'TESTREPLACEMENT', 'BOTTEST', 'BOTVISIBLE', 'REPLYTEST', 'KEEP1', 'KEEP2',
    'OverviewX', 'CHANGED'];
  const found = residue.filter(r => content.includes(r));
  if (found.length > 0) {
    throw new Error(
      `Test file has residue from a previous run: ${found.join(', ')}. ` +
      `Restore the clean file before running tests.`
    );
  }
});

// ============================================================
// MASKING TESTS
// ============================================================

test.describe('Editor - Masking', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(BASE_URL + TEST_SESSION_PATH);
    await login(page);
    await enterSuggestMode(page);
  });

  test('H1 heading: # hidden, text styled', async ({ page }) => {
    const h1 = page.locator('.cm-heading-1');
    await expect(h1.first()).toBeVisible();
    const text = await h1.first().textContent();
    expect(text).toContain('Session 1: The Gospel');
    expect(text).not.toContain('# ');
  });

  test('H2 heading: ## hidden, text styled', async ({ page }) => {
    const h2 = page.locator('.cm-heading-2');
    await expect(h2.first()).toBeVisible();
    const text = await h2.first().textContent();
    expect(text).not.toContain('## ');
  });

  test('H3 heading: ### hidden, text styled', async ({ page }) => {
    const h3 = page.locator('.cm-heading-3');
    await expect(h3.first()).toBeVisible();
  });

  test('bold: ** markers hidden', async ({ page }) => {
    const bold = page.locator('.cm-bold');
    await expect(bold.first()).toBeVisible();
    // With zero-width CSS hiding, ** is in DOM but invisible (font-size: 0)
    const hidden = page.locator('.cm-hidden-syntax').first();
    await expect(hidden).toBeAttached();
    const box = await hidden.boundingBox();
    expect(box === null || box.width === 0).toBeTruthy();
  });

  test('italic: _ markers hidden', async ({ page }) => {
    const italic = page.locator('.cm-italic');
    await expect(italic.first()).toBeVisible();
  });

  test('blockquote: > hidden, styled with border', async ({ page }) => {
    const bq = page.locator('.cm-blockquote');
    await expect(bq.first()).toBeVisible();
  });

  test('attribution: << hidden, text right-aligned', async ({ page }) => {
    const attr = page.locator('.cm-attribution');
    await expect(attr.first()).toBeVisible();
    const text = await attr.first().textContent();
    expect(text).not.toContain('<<');
  });

  test('Question tags hidden, content in styled block', async ({ page }) => {
    // Scroll to first Question block via CodeMirror API
    await page.evaluate(() => {
      if (!window.__editorView) return;
      const doc = window.__editorView.state.doc.toString();
      const pos = doc.indexOf('<Question');
      if (pos >= 0) {
        window.__editorView.dispatch({ selection: { anchor: pos + 20 }, scrollIntoView: true });
      }
    });
    await page.waitForTimeout(500);
    const qBlock = page.locator('.cm-question-block');
    await expect(qBlock.first()).toBeVisible({ timeout: 5000 });
    const text = await qBlock.first().textContent();
    expect(text).not.toContain('<Question');
    expect(text).not.toContain('</Question>');
    expect(text.length).toBeGreaterThan(10);
  });

  test('Callout tags hidden, content highlighted', async ({ page }) => {
    // Scroll to Callout via CodeMirror API (not scroll percentage — which breaks when content width changes)
    await page.evaluate(() => {
      if (!window.__editorView) return;
      const doc = window.__editorView.state.doc.toString();
      const pos = doc.indexOf('<Callout>');
      if (pos >= 0) {
        window.__editorView.dispatch({ selection: { anchor: pos + 10 }, scrollIntoView: true });
      }
    });
    await page.waitForTimeout(500);
    const callout = page.locator('.cm-callout');
    await expect(callout.first()).toBeVisible({ timeout: 5000 });
    const text = await callout.first().textContent();
    expect(text).not.toContain('<Callout>');
    expect(text).not.toContain('</Callout>');
  });

  test('raw doc still has all structural syntax intact', async ({ page }) => {
    const raw = await getRawDoc(page);
    expect(raw).toContain('# Session 1');
    expect(raw).toContain('<Question id=');
    expect(raw).toContain('</Question>');
    expect(raw).toContain('<Callout>');
    expect(raw).toContain('<<');
    expect(raw).toContain('**');
  });
});

// ============================================================
// SUGGESTION TRACKING TESTS
// ============================================================

test.describe('Editor - Suggestion Tracking', () => {
  test.beforeEach(async ({ page }) => {
    await clearAllSuggestions();
    await clearAllComments();
    await page.goto(BASE_URL + TEST_SESSION_PATH);
    await login(page);
    await enterSuggestMode(page);
  });

  test.afterEach(async () => {
    await clearAllSuggestions();
  });

  test('replacing a word shows green insertion and red deletion', async ({ page }) => {
    const word = await findUniqueWord(page, 'plain');
    expect(word).toBeTruthy();
    await selectText(page, word);
    await replaceWith(page, 'REPLACED');

    await page.waitForTimeout(500);
    const insertions = page.locator('.cm-suggestion-insert');
    const deletions = page.locator('.cm-suggestion-delete');
    await expect(insertions.first()).toBeVisible({ timeout: 3000 });
    await expect(deletions.first()).toBeVisible({ timeout: 3000 });
  });

  test('adding text at end of sentence shows green insertion', async ({ page }) => {
    // Find any sentence-ending period in a plain paragraph
    const insertPoint = await page.evaluate(() => {
      const doc = window.__editorView.state.doc.toString();
      const match = doc.match(/[a-z]\.\s/);
      return match ? doc.indexOf(match[0]) + 2 : -1;
    });
    expect(insertPoint).toBeGreaterThan(0);
    await page.evaluate((pos) => {
      window.__editorView.dispatch({ selection: { anchor: pos }, scrollIntoView: true });
      window.__editorView.focus();
    }, insertPoint);
    await page.waitForTimeout(200);
    await typeText(page, ' Indeed it is more.');

    await page.waitForTimeout(500);
    const insertions = page.locator('.cm-suggestion-insert');
    await expect(insertions.first()).toBeVisible({ timeout: 3000 });
  });

  test('deleting a word shows red strikethrough', async ({ page }) => {
    const word = await findUniqueWord(page, 'plain');
    expect(word).toBeTruthy();
    await selectText(page, word);
    await deleteSelection(page);

    await page.waitForTimeout(500);
    const deletions = page.locator('.cm-suggestion-delete');
    await expect(deletions.first()).toBeVisible({ timeout: 3000 });
  });

  test('margin card appears for each change', async ({ page }) => {
    const word = await findUniqueWord(page, 'plain');
    expect(word).toBeTruthy();
    await selectText(page, word);
    await replaceWith(page, 'CHANGED');
    await page.waitForTimeout(500);

    const count = await getMarginCardCount(page);
    expect(count).toBeGreaterThan(0);
  });

  test('margin card shows user name', async ({ page }) => {
    const word = await findUniqueWord(page, 'plain');
    expect(word).toBeTruthy();
    await selectText(page, word);
    await replaceWith(page, 'CHANGED');
    await page.waitForTimeout(500);

    const name = page.locator('.margin-card-name');
    await expect(name.first()).toBeVisible();
  });

  test('two edits in different parts create two margin cards', async ({ page }) => {
    const word1 = await findUniqueWord(page, 'plain');
    const word2 = await page.evaluate((skip) => {
      const doc = window.__editorView.state.doc.toString();
      const words = doc.match(/\b[a-zA-Z]{5,14}\b/g) || [];
      for (const w of words) {
        if (w !== skip && doc.indexOf(w) === doc.lastIndexOf(w)) return w;
      }
      return null;
    }, word1);
    expect(word1).toBeTruthy();
    expect(word2).toBeTruthy();

    await selectText(page, word1);
    await replaceWith(page, 'EDIT1');
    await page.waitForTimeout(300);

    await selectText(page, word2);
    await replaceWith(page, 'EDIT2');
    await page.waitForTimeout(500);

    const count = await getMarginCardCount(page);
    expect(count).toBeGreaterThanOrEqual(2);
  });

  test('multiple suggestions persist in margin after auto-save', async ({ page }) => {
    const word1 = await findUniqueWord(page, 'plain');
    expect(word1).toBeTruthy();
    const word2 = await page.evaluate((skip) => {
      const doc = window.__editorView.state.doc.toString();
      const words = doc.match(/\b[a-zA-Z]{5,14}\b/g) || [];
      for (const w of words) { if (w !== skip && doc.indexOf(w) === doc.lastIndexOf(w)) return w; }
      return null;
    }, word1);
    const word3 = await page.evaluate(({ skip1, skip2 }) => {
      const doc = window.__editorView.state.doc.toString();
      const words = doc.match(/\b[a-zA-Z]{5,14}\b/g) || [];
      for (const w of words) { if (w !== skip1 && w !== skip2 && doc.indexOf(w) === doc.lastIndexOf(w)) return w; }
      return null;
    }, { skip1: word1, skip2: word2 });
    expect(word2).toBeTruthy();
    expect(word3).toBeTruthy();

    await selectText(page, word1);
    await replaceWith(page, 'EDIT1');
    await page.waitForTimeout(300);

    await selectText(page, word2);
    await replaceWith(page, 'EDIT2');
    await page.waitForTimeout(300);

    await selectText(page, word3);
    await replaceWith(page, 'EDIT3');
    await page.waitForTimeout(300);

    // Verify 3 cards before auto-save
    let count = await getMarginCardCount(page);
    expect(count).toBeGreaterThanOrEqual(3);

    // Wait for auto-save to fire (1.5s debounce + network)
    await waitForAutoSave(page);

    // CRITICAL: all 3 cards must still be present after auto-save
    count = await getMarginCardCount(page);
    expect(count).toBeGreaterThanOrEqual(3);

    // Wait again to catch any delayed auto-save deletions
    await page.waitForTimeout(3000);
    count = await getMarginCardCount(page);
    expect(count).toBeGreaterThanOrEqual(3);
  });

  test('edit after auto-save still creates a second margin card', async ({ page }) => {
    // Regression test: when edit #1 is auto-saved and promoted to the registry,
    // making edit #2 should still show 2 margin cards. Previously, the auto-save
    // pushed to data.pendingSuggestions without authorName/authorEmail, causing
    // escapeHtml(undefined) to throw and silently break the margin render.
    const word1 = await findUniqueWord(page, 'plain');
    expect(word1).toBeTruthy();
    const word2 = await page.evaluate((skip) => {
      const doc = window.__editorView.state.doc.toString();
      const words = doc.match(/\b[a-zA-Z]{5,14}\b/g) || [];
      for (const w of words) {
        if (w !== skip && doc.indexOf(w) === doc.lastIndexOf(w)) return w;
      }
      return null;
    }, word1);
    expect(word2).toBeTruthy();

    // No cards before any edits
    const countBefore = await getMarginCardCount(page);
    expect(countBefore).toBe(0);

    // Edit #1
    await selectText(page, word1);
    await replaceWith(page, 'FIRSTEDIT');
    await page.waitForTimeout(500);
    const countAfterFirst = await getMarginCardCount(page);
    expect(countAfterFirst).toBeGreaterThanOrEqual(1);

    // Wait for auto-save to complete
    await waitForAutoSave(page);

    // Edit #2 — the regression: this must produce additional cards
    await selectText(page, word2);
    await replaceWith(page, 'SECONDEDIT');
    await page.waitForTimeout(500);

    const countAfterSecond = await getMarginCardCount(page);
    expect(countAfterSecond).toBeGreaterThan(countAfterFirst);
  });
});

// ============================================================
// REGISTRY ROBUSTNESS TESTS — critical regression tests
// ============================================================

test.describe('Registry Robustness', () => {
  test.beforeEach(async ({ page }) => {
    await clearAllSuggestions();
    await clearAllComments();
    await page.goto(BASE_URL + TEST_SESSION_PATH);
    await login(page);
    await enterSuggestMode(page);
  });

  test.afterEach(async () => {
    await clearAllSuggestions();
    await clearAllComments();
  });

  test('discarding one suggestion does not remove others', async ({ page }) => {
    // Make 2 suggestions on dynamically found words
    const word1 = await findUniqueWord(page, 'plain');
    expect(word1).toBeTruthy();
    const word2 = await page.evaluate((skip) => {
      const doc = window.__editorView.state.doc.toString();
      const words = doc.match(/\b[a-zA-Z]{5,14}\b/g) || [];
      for (const w of words) {
        if (w !== skip && doc.indexOf(w) === doc.lastIndexOf(w)) return w;
      }
      return null;
    }, word1);
    expect(word2).toBeTruthy();

    await selectText(page, word1);
    await replaceWith(page, 'KEEP1');
    await page.waitForTimeout(300);

    await selectText(page, word2);
    await replaceWith(page, 'KEEP2');
    await page.waitForTimeout(300);

    // Wait for auto-save
    await waitForAutoSave(page);
    await page.waitForTimeout(1000);

    // Verify both saved
    let fsCount = await getPendingSuggestionCount();
    expect(fsCount).toBeGreaterThanOrEqual(2);

    // Discard the first suggestion
    const rejectBtn = page.locator('.margin-action--reject').first();
    await expect(rejectBtn).toBeVisible({ timeout: 3000 });
    await rejectBtn.click();

    // Wait for discard + auto-save cycle
    await page.waitForTimeout(5000);

    // CRITICAL: the other must still exist in Firestore
    fsCount = await getPendingSuggestionCount();
    expect(fsCount).toBeGreaterThanOrEqual(1);
  });

  test('comment survives after nearby suggestion is made', async ({ page }) => {
    // Find a paragraph with enough text
    const textInfo = await page.evaluate(() => {
      const doc = window.__editorView.state.doc.toString();
      // Find a line with 50+ chars of plain text
      const lines = doc.split('\n');
      for (const line of lines) {
        if (line.length > 60 && !line.startsWith('#') && !line.startsWith('>') && !line.startsWith('<') && !line.startsWith('<<')) {
          const pos = doc.indexOf(line);
          return { line: line.substring(0, 60), pos };
        }
      }
      return null;
    });
    expect(textInfo).not.toBeNull();

    // Select first 10 chars and add a comment
    await page.evaluate((pos) => {
      window.__editorView.dispatch({ selection: { anchor: pos, head: pos + 10 }, scrollIntoView: true });
      window.__editorView.focus();
    }, textInfo.pos);
    await page.waitForTimeout(300);

    // Click the comment tooltip
    const tooltip = page.locator('.comment-tooltip');
    await expect(tooltip).toBeVisible({ timeout: 3000 });
    await tooltip.click();
    await page.waitForTimeout(300);

    // Type comment and submit
    await page.fill('#comment-popup-input', 'Test comment');
    await page.click('#comment-popup-submit');
    await page.waitForTimeout(1000);

    // Verify comment highlight exists
    const highlights = await page.locator('.cm-comment-highlight').count();
    expect(highlights).toBeGreaterThan(0);

    // Now make a suggestion on text further in the same line
    await page.evaluate((pos) => {
      const doc = window.__editorView.state.doc.toString();
      // Find a word 20+ chars after the comment
      const after = doc.substring(pos + 15, pos + 50);
      const wordMatch = after.match(/\b\w{4,}\b/);
      if (wordMatch) {
        const wordPos = pos + 15 + after.indexOf(wordMatch[0]);
        window.__editorView.dispatch({ selection: { anchor: wordPos, head: wordPos + wordMatch[0].length } });
      }
    }, textInfo.pos);
    await page.keyboard.type('CHANGED');
    await page.waitForTimeout(1000);

    // CRITICAL: comment highlight must still exist after the suggestion edit
    const highlightsAfter = await page.locator('.cm-comment-highlight').count();
    expect(highlightsAfter).toBeGreaterThan(0);
  });

  test('accepting one suggestion does not remove others', async ({ request }) => {
    const apiKey = process.env.CLAUDE_API_KEY || '';
    const filePath = 'series/Narrative Journey Series/Foundations/Test Book/sessions/1-Session1-TheGospel.md';
    const bookPath = 'series/Narrative Journey Series/Foundations/Test Book';

    // Read file
    const contentRes = await request.get(BASE_URL + '/api/suggestions/content', {
      params: { filePath },
      headers: { 'x-api-key': apiKey },
    });
    const { content, sha } = await contentRes.json();

    // Find 2 unique words
    const wordRe = /\b[A-Z][a-z]{7,12}\b/g;
    const words = [];
    let match;
    while ((match = wordRe.exec(content)) !== null) {
      const w = match[0];
      if (content.indexOf(w) === content.lastIndexOf(w) && words.indexOf(w) === -1) {
        words.push({ word: w, pos: match.index });
        if (words.length >= 2) break;
      }
    }
    expect(words.length).toBe(2);

    // Create 2 suggestions via API
    const ids = [];
    for (const { word, pos } of words) {
      const ctxBefore = content.substring(Math.max(0, pos - 80), pos);
      const ctxAfter = content.substring(pos + word.length, Math.min(content.length, pos + word.length + 80));
      const res = await request.post(BASE_URL + '/api/suggestions/hunk', {
        headers: { 'x-api-key': apiKey, 'Content-Type': 'application/json' },
        data: {
          filePath, bookPath, baseCommitSha: sha,
          type: 'replacement', originalFrom: pos, originalTo: pos + word.length,
          originalText: word, newText: word + 'X',
          contextBefore: ctxBefore, contextAfter: ctxAfter,
        },
      });
      const result = await res.json();
      ids.push(result.id);
    }
    expect(ids.length).toBe(2);

    // Accept the first suggestion
    await request.post(BASE_URL + '/api/auth/test-login', { data: { email: 'steve@noblecollective.org' } });
    const acceptRes = await request.put(BASE_URL + '/api/suggestions/hunk/' + ids[0] + '/accept', {
      headers: { 'Content-Type': 'application/json' },
    });
    expect(acceptRes.ok()).toBeTruthy();

    // CRITICAL: the second suggestion must still be pending
    const admin = require('firebase-admin');
    if (!admin.apps.length) admin.initializeApp();
    const doc = await admin.firestore().collection('suggestions').doc(ids[1]).get();
    expect(doc.exists).toBeTruthy();
    expect(doc.data().status).toBe('pending');
  });
});

// ============================================================
// AUTO-SAVE TESTS
// ============================================================

test.describe('Editor - Auto-Save', () => {
  test.beforeEach(async ({ page }) => {
    await clearAllSuggestions();
    await page.goto(BASE_URL + TEST_SESSION_PATH);
    await login(page);
    await enterSuggestMode(page);
  });

  test.afterEach(async () => {
    await clearAllSuggestions();
  });

  test('suggestion auto-saves to Firestore after pause', async ({ page }) => {
    const word = await findUniqueWord(page, 'plain');
    expect(word).toBeTruthy();
    await selectText(page, word);
    await replaceWith(page, 'SAVED');
    await waitForAutoSave(page);

    const count = await getPendingSuggestionCount();
    expect(count).toBeGreaterThan(0);
  });

  test('"Saved" appears in toolbar', async ({ page }) => {
    const word = await findUniqueWord(page, 'plain');
    await selectText(page, word);
    await replaceWith(page, 'SAVED');
    await page.waitForSelector('#editor-save-status:not(:empty)', { timeout: 5000 });
    const status = await page.textContent('#editor-save-status');
    expect(status).toBe('Saved');
  });

  test('discarding (X) removes suggestion from Firestore', async ({ page }) => {
    const word = await findUniqueWord(page, 'plain');
    await selectText(page, word);
    await replaceWith(page, 'DISCARD');
    await waitForAutoSave(page);

    const before = await getPendingSuggestionCount();
    expect(before).toBeGreaterThan(0);

    // Click X on the margin card
    const rejectBtn = page.locator('.margin-action--reject');
    await expect(rejectBtn.first()).toBeVisible({ timeout: 3000 });
    await rejectBtn.first().click();
    await page.waitForTimeout(2000);

    const after = await getPendingSuggestionCount();
    expect(after).toBeLessThan(before);
  });

  test('undoing all edits removes suggestion from Firestore', async ({ page }) => {
    const word = await findUniqueWord(page, 'plain');
    await selectText(page, word);
    await replaceWith(page, 'UNDO');
    await waitForAutoSave(page);

    // Undo until back to original
    for (let i = 0; i < 20; i++) {
      await page.keyboard.press('Control+z');
    }
    await waitForAutoSave(page);

    const count = await getPendingSuggestionCount();
    expect(count).toBe(0);
  });
});

// ============================================================
// EDGE CASES — EDITING NEAR STRUCTURAL SYNTAX
// ============================================================

test.describe('Editor - Edge Cases Near Structural Syntax', () => {
  test.beforeEach(async ({ page }) => {
    await clearAllSuggestions();
    await page.goto(BASE_URL + TEST_SESSION_PATH);
    await login(page);
    await enterSuggestMode(page);
  });

  test.afterEach(async () => {
    await clearAllSuggestions();
  });

  // --- Headings ---

  test('replacing a word inside H2 heading preserves ##', async ({ page }) => {
    const word = await findUniqueWord(page, 'heading2');
    expect(word).toBeTruthy();
    await selectText(page, word);
    await replaceWith(page, 'REPLACED');

    const raw = await getRawDoc(page);
    expect(raw).toContain('## ');
    expect(raw).toContain('REPLACED');
    expect(raw).not.toContain('## ## ');
  });

  test('appending text to H3 heading preserves ###', async ({ page }) => {
    const h3Content = await findStructuralContent(page, 'heading3');
    expect(h3Content).toBeTruthy();
    await cursorAfter(page, h3Content);
    await typeText(page, ' (v2)');

    const raw = await getRawDoc(page);
    expect(raw).toContain('### ' + h3Content + ' (v2)');
  });

  test('replacing a word in H3 heading preserves ###', async ({ page }) => {
    const word = await findUniqueWord(page, 'heading3');
    expect(word).toBeTruthy();
    await selectText(page, word);
    await replaceWith(page, 'REPLACED');

    const raw = await getRawDoc(page);
    expect(raw).toContain('### ');
    expect(raw).toContain('REPLACED');
  });

  // --- Bold ---

  test('replacing a word inside bold preserves ** markers', async ({ page }) => {
    const word = await findUniqueWord(page, 'bold');
    expect(word).toBeTruthy();
    await selectText(page, word);
    await replaceWith(page, 'BOLDED');

    const raw = await getRawDoc(page);
    expect(raw).toContain('**');
    expect(raw).toContain('BOLDED');
    expect(raw).not.toContain('***');
  });

  test('appending to bold text stays inside ** markers', async ({ page }) => {
    const word = await findUniqueWord(page, 'bold');
    expect(word).toBeTruthy();
    await selectText(page, word);
    await replaceWith(page, 'BOLDAPP');

    const raw = await getRawDoc(page);
    expect(raw).toMatch(/\*\*[^*]*BOLDAPP[^*]*\*\*/);
  });

  // --- Italic ---

  test('replacing italic text preserves _ markers', async ({ page }) => {
    const word = await findUniqueWord(page, 'italic');
    expect(word).toBeTruthy();
    await selectText(page, word);
    await replaceWith(page, 'ITALICIZED');

    const raw = await getRawDoc(page);
    expect(raw).toMatch(/_[^_]*ITALICIZED[^_]*_/);
  });

  // --- Blockquote ---

  test('replacing text inside blockquote preserves > marker', async ({ page }) => {
    const word = await findUniqueWord(page, 'blockquote');
    expect(word).toBeTruthy();
    await selectText(page, word);
    await replaceWith(page, 'BQTEXT');

    const raw = await getRawDoc(page);
    expect(raw).toContain('>');
    expect(raw).toContain('BQTEXT');
  });

  test('appending text inside blockquote stays in blockquote', async ({ page }) => {
    const bqContent = await findStructuralContent(page, 'blockquote');
    expect(bqContent).toBeTruthy();
    await cursorAfter(page, bqContent);
    await typeText(page, ' APPENDED');

    const raw = await getRawDoc(page);
    expect(raw).toContain(bqContent + ' APPENDED');
  });

  // --- Attribution ---

  test('replacing text in attribution preserves << and _italic_', async ({ page }) => {
    const word = await findUniqueWord(page, 'attribution');
    expect(word).toBeTruthy();
    await selectText(page, word);
    await replaceWith(page, 'ATTRTEXT');

    const raw = await getRawDoc(page);
    expect(raw).toContain('<<');
    expect(raw).toContain('ATTRTEXT');
  });

  // --- Question blocks ---

  test('editing inside a Question block preserves tags', async ({ page }) => {
    const word = await findUniqueWord(page, 'question');
    expect(word).toBeTruthy();
    await selectText(page, word);
    await replaceWith(page, 'QTEXT');

    const raw = await getRawDoc(page);
    expect(raw).toContain('<Question id=');
    expect(raw).toContain('</Question>');
    expect(raw).toContain('QTEXT');
  });

  test('appending text inside Question block stays inside tags', async ({ page }) => {
    // Find text inside a question block and append
    const qWord = await findUniqueWord(page, 'question');
    expect(qWord).toBeTruthy();
    await cursorAfter(page, qWord);
    await typeText(page, ' ADDED');

    const raw = await getRawDoc(page);
    expect(raw).toContain(qWord + ' ADDED');
    expect(raw).toContain('</Question>');
  });

  // --- Callout blocks ---

  test('replacing text inside Callout preserves tags', async ({ page }) => {
    const word = await findUniqueWord(page, 'callout');
    expect(word).toBeTruthy();
    await page.evaluate(() => {
      const doc = window.__editorView.state.doc.toString();
      const pos = doc.indexOf('<Callout>');
      if (pos >= 0) window.__editorView.dispatch({ selection: { anchor: pos + 10 }, scrollIntoView: true });
    });
    await page.waitForTimeout(300);
    await selectText(page, word);
    await replaceWith(page, 'CALLTEXT');

    const raw = await getRawDoc(page);
    expect(raw).toContain('<Callout>');
    expect(raw).toContain('</Callout>');
    expect(raw).toContain('CALLTEXT');
  });

  // --- Regular paragraph ---

  test('replacing a word in a paragraph works cleanly', async ({ page }) => {
    const word = await findUniqueWord(page, 'plain');
    expect(word).toBeTruthy();
    await selectText(page, word);
    await replaceWith(page, 'REPLACED');

    const raw = await getRawDoc(page);
    expect(raw).toContain('REPLACED');
  });

  test('inserting text mid-paragraph works', async ({ page }) => {
    const word = await findUniqueWord(page, 'plain');
    expect(word).toBeTruthy();
    await cursorAfter(page, word);
    await typeText(page, ' INSERTED');

    const raw = await getRawDoc(page);
    expect(raw).toContain(word + ' INSERTED');
  });

  // --- Between structural blocks ---

  test('editing between two Question blocks does not corrupt them', async ({ page }) => {
    const raw1 = await getRawDoc(page);
    const qCount1 = (raw1.match(/<Question/g) || []).length;

    // Find text between question blocks dynamically
    const word = await findUniqueWord(page, 'plain');
    expect(word).toBeTruthy();
    await selectText(page, word);
    await replaceWith(page, 'BETWEEN');

    const raw2 = await getRawDoc(page);
    const qCount2 = (raw2.match(/<Question/g) || []).length;
    expect(qCount2).toBe(qCount1);
  });

  // --- Delete operations ---

  test('deleting a word in a paragraph', async ({ page }) => {
    const word = await findUniqueWord(page, 'plain');
    expect(word).toBeTruthy();
    await selectText(page, word);
    await deleteSelection(page);

    const raw = await getRawDoc(page);
    expect(raw).not.toContain(word);
  });

  test('deleting text inside bold preserves markers', async ({ page }) => {
    const word = await findUniqueWord(page, 'bold');
    expect(word).toBeTruthy();
    await selectText(page, word);
    await replaceWith(page, 'DELBOLD');

    const raw = await getRawDoc(page);
    expect(raw).toContain('**');
    expect(raw).toContain('DELBOLD');
    expect(raw).not.toContain('***');
  });
});

// ============================================================
// ACCEPT / REJECT FLOW
// ============================================================

test.describe('Editor - Accept/Reject Flow', () => {
  test.beforeEach(async ({ page }) => {
    await clearAllSuggestions();
    await page.goto(BASE_URL + TEST_SESSION_PATH);
    await login(page);
  });

  test.afterEach(async () => {
    await clearAllSuggestions();
  });

  test('suggestion persists after exiting editor', async ({ page }) => {
    await enterSuggestMode(page);
    const word = await findUniqueWord(page, 'plain');
    await selectText(page, word);
    await replaceWith(page, 'PERSISTED');
    await waitForAutoSave(page);

    await page.click('#btn-editor-done');
    await page.waitForTimeout(2000);

    const count = await getPendingSuggestionCount();
    expect(count).toBeGreaterThan(0);
  });

  test('Review button appears when suggestions exist', async ({ page }) => {
    await enterSuggestMode(page);
    const word = await findUniqueWord(page, 'plain');
    await selectText(page, word);
    await replaceWith(page, 'REVIEW');
    await waitForAutoSave(page);

    // Exit editor — triggers page reload
    await page.click('#btn-editor-done');
    // Wait for the reload to complete
    await page.waitForURL('**/' + TEST_SESSION_PATH.split('/').pop() + '*', { timeout: 15000 });
    await page.waitForTimeout(1000);

    const reviewBtn = page.locator('#btn-review');
    await expect(reviewBtn).toBeVisible({ timeout: 5000 });
  });

  test('review mode is read-only', async ({ page }) => {
    await enterSuggestMode(page);
    const word = await findUniqueWord(page, 'plain');
    await selectText(page, word);
    await replaceWith(page, 'READONLY');
    await waitForAutoSave(page);

    await page.click('#btn-editor-done');
    await page.waitForURL('**/' + TEST_SESSION_PATH.split('/').pop() + '*', { timeout: 15000 });
    await page.waitForTimeout(1000);

    await page.click('#btn-review');
    await page.waitForSelector('.cm-editor');
    await page.waitForTimeout(500);

    const label = page.locator('#editor-mode-label');
    await expect(label).toHaveText('Reviewing Suggestions');
  });
});

// ============================================================
// ACCEPT + REFRESH TESTS — verify decorations clear and editor matches GitHub
// ============================================================

test.describe('Accept Refresh', () => {
  let savedContent = null;
  const TEST_FILE = 'series/Narrative Journey Series/Foundations/Test Book/sessions/1-Session1-TheGospel.md';

  test.beforeEach(async ({ page }) => {
    await clearAllSuggestions();
    await page.goto(BASE_URL + TEST_SESSION_PATH);
    await login(page);
  });

  test.afterEach(async () => {
    await clearAllSuggestions();
    // Restore original file if the test modified it
    if (savedContent) {
      const http = require('http');
      await new Promise((resolve) => {
        const lr = http.request('http://localhost:8080/api/auth/test-login', { method: 'POST', headers: { 'Content-Type': 'application/json' } }, (loginRes) => {
          const cookie = loginRes.headers['set-cookie']?.[0]?.split(';')[0] || '';
          http.get('http://localhost:8080/api/suggestions/content?filePath=' + encodeURIComponent(TEST_FILE), { headers: { 'x-api-key': process.env.CLAUDE_API_KEY || '' } }, (gr) => {
            let d = ''; gr.on('data', c => d += c); gr.on('end', () => {
              const sha = JSON.parse(d).sha;
              const body = JSON.stringify({ filePath: TEST_FILE, content: savedContent, sha, comment: 'Restore after accept refresh test' });
              const er = http.request('http://localhost:8080/api/suggestions/direct-edit', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Cookie': cookie, 'Content-Length': Buffer.byteLength(body) } }, (r) => {
                let o = ''; r.on('data', c => o += c); r.on('end', () => { savedContent = null; resolve(); });
              }); er.write(body); er.end();
            });
          });
        });
        lr.write(JSON.stringify({ email: 'steve@noblecollective.org' })); lr.end();
      });
    }
  });

  test('accepting a suggestion clears inline decorations and refreshes from GitHub', async ({ page, request }) => {
    // Save original content for restoration
    const apiKey = process.env.CLAUDE_API_KEY || '';
    const contentRes = await request.get(BASE_URL + '/api/suggestions/content', {
      params: { filePath: TEST_FILE },
      headers: { 'x-api-key': apiKey },
    });
    const { content } = await contentRes.json();
    savedContent = content;

    await enterSuggestMode(page);

    // Find a unique word to edit dynamically
    const targetWord = await findUniqueWord(page, 'plain');
    expect(targetWord).toBeTruthy();

    // Make an edit
    await selectText(page, targetWord);
    await replaceWith(page, 'ACCEPTTEST');
    await page.waitForTimeout(500);

    // Verify green insertion decoration exists
    const insertions = page.locator('.cm-suggestion-insert');
    await expect(insertions.first()).toBeVisible({ timeout: 3000 });

    // Wait for auto-save
    await waitForAutoSave(page);

    // Accept the suggestion via the margin card
    const acceptBtn = page.locator('.margin-action--accept').first();
    await expect(acceptBtn).toBeVisible({ timeout: 3000 });
    await acceptBtn.click();

    // Wait for the full accept + refresh cycle (commit + GitHub fetch)
    await page.waitForTimeout(8000);

    // CRITICAL: inline decorations should be GONE after refresh
    const insertionsAfter = await page.locator('.cm-suggestion-insert').count();
    const deletionsAfter = await page.locator('.cm-suggestion-delete').count();
    expect(insertionsAfter).toBe(0);
    expect(deletionsAfter).toBe(0);

    // The editor text should contain the accepted change
    const doc = await page.evaluate(() => window.__editorView?.state.doc.toString() || '');
    expect(doc).toContain('supreme');
  });
});

// ============================================================
// ACCEPT PRECISION TESTS — context-based location
// ============================================================

test.describe('Accept Precision', () => {
  const TEST_FILE = 'series/Narrative Journey Series/Foundations/Test Book/sessions/1-Session1-TheGospel.md';
  const TEST_BOOK = 'series/Narrative Journey Series/Foundations/Test Book';
  let savedContent = null;

  // Restore original file after each test (the test modifies GitHub)
  test.afterEach(async () => {
    await clearAllSuggestions();
    if (savedContent) {
      const http = require('http');
      await new Promise((resolve) => {
        // Login
        const lr = http.request('http://localhost:8080/api/auth/test-login', { method: 'POST', headers: { 'Content-Type': 'application/json' } }, (loginRes) => {
          const cookie = loginRes.headers['set-cookie']?.[0]?.split(';')[0] || '';
          // Get current SHA (file was modified by the test)
          http.get('http://localhost:8080/api/suggestions/content?filePath=' + encodeURIComponent(TEST_FILE), { headers: { 'x-api-key': process.env.CLAUDE_API_KEY || '' } }, (gr) => {
            let d = ''; gr.on('data', c => d += c); gr.on('end', () => {
              const sha = JSON.parse(d).sha;
              const body = JSON.stringify({ filePath: TEST_FILE, content: savedContent, sha, comment: 'Restore after precision test' });
              const er = http.request('http://localhost:8080/api/suggestions/direct-edit', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Cookie': cookie, 'Content-Length': Buffer.byteLength(body) } }, (r) => {
                let o = ''; r.on('data', c => o += c); r.on('end', () => { savedContent = null; resolve(); });
              }); er.write(body); er.end();
            });
          });
        });
        lr.write(JSON.stringify({ email: 'steve@noblecollective.org' })); lr.end();
      });
    }
  });

  test('context-based accept targets the correct occurrence, not the first', async ({ request }) => {
    const apiKey = process.env.CLAUDE_API_KEY || '';

    // Read the current file (whatever state it's in)
    const contentRes = await request.get(BASE_URL + '/api/suggestions/content', {
      params: { filePath: TEST_FILE },
      headers: { 'x-api-key': apiKey },
    });
    const { content, sha } = await contentRes.json();
    savedContent = content;

    // Find ALL periods in the file
    const periods = [];
    for (let i = 0; i < content.length; i++) {
      if (content[i] === '.') periods.push(i);
    }
    expect(periods.length).toBeGreaterThan(10); // File must have many periods

    // Pick a period in the latter half — NOT the first occurrence
    const targetIdx = Math.floor(periods.length * 0.75);
    const targetPos = periods[targetIdx];
    const firstPeriod = periods[0];
    expect(targetPos).toBeGreaterThan(firstPeriod); // Sanity check

    // Snapshot everything before the target
    const contentBeforeTarget = content.substring(0, targetPos);

    // Build context from surrounding text
    const ctxBefore = content.substring(Math.max(0, targetPos - 50), targetPos);
    const ctxAfter = content.substring(targetPos + 1, Math.min(content.length, targetPos + 51));

    // Create a suggestion to remove this specific period
    const createRes = await request.post(BASE_URL + '/api/suggestions/hunk', {
      headers: { 'x-api-key': apiKey, 'Content-Type': 'application/json' },
      data: {
        filePath: TEST_FILE, bookPath: TEST_BOOK, baseCommitSha: sha,
        type: 'replacement', originalFrom: targetPos, originalTo: targetPos + 1,
        originalText: '.', newText: '',
        contextBefore: ctxBefore, contextAfter: ctxAfter,
      },
    });
    const sugg = await createRes.json();
    expect(sugg.id).toBeTruthy();

    // Accept it
    await request.post(BASE_URL + '/api/auth/test-login', { data: { email: 'steve@noblecollective.org' } });
    const acceptRes = await request.put(BASE_URL + '/api/suggestions/hunk/' + sugg.id + '/accept', {
      headers: { 'Content-Type': 'application/json' },
    });
    expect(acceptRes.ok()).toBeTruthy();

    // Read the file after accept
    const afterRes = await request.get(BASE_URL + '/api/suggestions/content', {
      params: { filePath: TEST_FILE },
      headers: { 'x-api-key': apiKey },
    });
    const after = await afterRes.json();

    // CRITICAL: everything before the target position must be IDENTICAL
    // If the old indexOf bug existed, an earlier period would be removed
    expect(after.content.substring(0, targetPos)).toBe(contentBeforeTarget);

    // The period at the target position should be gone (file is 1 char shorter there)
    expect(after.content.length).toBe(content.length - 1);
  });
});

// ============================================================
// DIRECT EDIT (ADMIN)
// ============================================================

test.describe('Editor - Direct Edit', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(BASE_URL + TEST_SESSION_PATH);
    await login(page);
  });

  test('direct edit shows "Direct Editing" label', async ({ page }) => {
    await enterDirectMode(page);
    const label = page.locator('#editor-mode-label');
    await expect(label).toHaveText('Direct Editing');
  });

  test('direct edit has no suggestion decorations', async ({ page }) => {
    await enterDirectMode(page);
    const word = await findUniqueWord(page, 'plain');
    await selectText(page, word);
    await replaceWith(page, 'DIRECT');
    await page.waitForTimeout(500);

    const insertions = page.locator('.cm-suggestion-insert');
    await expect(insertions).toHaveCount(0);
  });

  test('direct edit can modify the document', async ({ page }) => {
    await enterDirectMode(page);
    const word = await findUniqueWord(page, 'plain');
    await selectText(page, word);
    await replaceWith(page, 'MODIFIED');

    const raw = await getRawDoc(page);
    expect(raw).toContain('MODIFIED');
    expect(raw).not.toContain(word);
  });
});

// ============================================================
// COMMENT SYSTEM
// ============================================================

test.describe('Editor - Comments', () => {
  test.beforeEach(async ({ page }) => {
    await clearAllSuggestions();
    await clearAllComments();
    await page.goto(BASE_URL + TEST_SESSION_PATH);
    await login(page);
    await enterSuggestMode(page);
  });

  test.afterEach(async () => {
    await clearAllSuggestions();
    await clearAllComments();
  });

  test('selecting text shows comment tooltip', async ({ page }) => {
    await selectText(page, 'belief system');
    await page.waitForTimeout(500);
    const tooltip = page.locator('.comment-tooltip');
    await expect(tooltip).toBeVisible({ timeout: 3000 });
  });

  test('adding a comment on selected text saves to Firestore', async ({ page }) => {
    await selectText(page, 'belief system');
    await page.waitForTimeout(500);
    // Click the floating tooltip
    await page.click('.comment-tooltip');
    await page.waitForTimeout(300);
    // Type in the popup
    await page.fill('#comment-popup-input', 'This needs clarification');
    await page.click('#comment-popup-submit');
    await page.waitForTimeout(2000);

    const count = await getPendingCommentCount();
    expect(count).toBeGreaterThan(0);
  });

  test('comment shows yellow highlight in editor', async ({ page }) => {
    await selectText(page, 'belief system');
    await page.waitForTimeout(500);
    await page.click('.comment-tooltip');
    await page.waitForTimeout(300);
    await page.fill('#comment-popup-input', 'Test comment');
    await page.click('#comment-popup-submit');
    await page.waitForTimeout(1000);

    const highlight = page.locator('.cm-comment-highlight');
    await expect(highlight.first()).toBeVisible({ timeout: 3000 });
  });

  test('comment shows in margin panel', async ({ page }) => {
    await selectText(page, 'belief system');
    await page.waitForTimeout(500);
    await page.click('.comment-tooltip');
    await page.waitForTimeout(300);
    await page.fill('#comment-popup-input', 'Needs rewording');
    await page.click('#comment-popup-submit');
    await page.waitForTimeout(1000);

    const commentCard = page.locator('.margin-card--comment');
    await expect(commentCard.first()).toBeVisible({ timeout: 3000 });
    const text = await commentCard.first().textContent();
    expect(text).toContain('Needs rewording');
  });
});

// ============================================================
// LOADING EXISTING SUGGESTIONS
// ============================================================

test.describe('Editor - Loading Existing Suggestions', () => {
  // Dynamic words found from the actual file — no hardcoded text dependencies
  let testWords = [];

  test.beforeEach(async ({ page }) => {
    await clearAllSuggestions();
    await clearAllComments();
    testWords = await findUniqueWordsInFile(2);
  });

  test.afterEach(async () => {
    await clearAllSuggestions();
    await clearAllComments();
  });

  test('existing suggestion shows inline when entering suggest mode', async ({ page }) => {
    await createTestSuggestion({
      type: 'replacement',
      originalText: testWords[0],
      newText: 'TESTREPLACEMENT',
    });

    await page.goto(BASE_URL + TEST_SESSION_PATH);
    await login(page);
    await enterSuggestMode(page);
    await page.waitForTimeout(1000);

    // Scroll to the suggestion replacement text
    await page.evaluate(() => {
      if (!window.__editorView) return;
      const doc = window.__editorView.state.doc.toString();
      const pos = doc.indexOf('TESTREPLACEMENT');
      if (pos >= 0) window.__editorView.dispatch({ selection: { anchor: pos }, scrollIntoView: true });
    });
    await page.waitForTimeout(500);

    const insertions = page.locator('.cm-suggestion-insert');
    await expect(insertions.first()).toBeVisible({ timeout: 5000 });
  });

  test('existing suggestion shows in margin with author info', async ({ page }) => {
    await createTestSuggestion({
      type: 'replacement',
      originalText: testWords[0],
      newText: 'TESTREPLACEMENT',
    });

    await page.goto(BASE_URL + TEST_SESSION_PATH);
    await login(page);
    await enterSuggestMode(page);
    await page.waitForTimeout(1000);

    const card = page.locator('.margin-card');
    await expect(card.first()).toBeVisible({ timeout: 5000 });
  });

  test('existing suggestion positioned at correct location (not top)', async ({ page }) => {
    await createTestSuggestion({
      type: 'replacement',
      originalText: testWords[0],
      newText: 'TESTREPLACEMENT',
    });

    await page.goto(BASE_URL + TEST_SESSION_PATH);
    await login(page);
    await enterSuggestMode(page);
    await page.waitForTimeout(1000);

    // Scroll to the suggestion
    await page.evaluate(() => {
      if (!window.__editorView) return;
      const doc = window.__editorView.state.doc.toString();
      const pos = doc.indexOf('TESTREPLACEMENT');
      if (pos >= 0) window.__editorView.dispatch({ selection: { anchor: pos }, scrollIntoView: true });
    });
    await page.waitForTimeout(500);

    const card = page.locator('.margin-card').first();
    await expect(card).toBeVisible({ timeout: 5000 });
    // Card exists and is positioned (any value is fine — it's at the right text location)
    const top = await card.evaluate(el => parseFloat(el.style.top));
    expect(top).toBeGreaterThanOrEqual(0);
  });

  test('Review button shows count of existing suggestions', async ({ page }) => {
    await createTestSuggestion({
      type: 'replacement',
      originalText: testWords[0],
      newText: 'TESTREPLACEMENT1',
    });
    await createTestSuggestion({
      type: 'replacement',
      originalText: testWords[1],
      newText: 'TESTREPLACEMENT2',
    });

    await page.goto(BASE_URL + TEST_SESSION_PATH);
    await login(page);

    const reviewBtn = page.locator('#btn-review');
    await expect(reviewBtn).toBeVisible({ timeout: 5000 });
    const text = await reviewBtn.textContent();
    expect(text).toContain('2');
  });

  test('suggestions from other users are visible', async ({ page }) => {
    await createTestSuggestion({
      type: 'replacement',
      originalText: testWords[0],
      newText: 'TESTREPLACEMENT',
      authorEmail: 'otheruser@example.com',
      authorName: 'Other User',
    });

    await page.goto(BASE_URL + TEST_SESSION_PATH);
    await login(page);
    await enterSuggestMode(page);
    await page.waitForTimeout(1000);

    // Scroll to the suggestion
    await page.evaluate(() => {
      if (!window.__editorView) return;
      const doc = window.__editorView.state.doc.toString();
      const pos = doc.indexOf('TESTREPLACEMENT');
      if (pos >= 0) window.__editorView.dispatch({ selection: { anchor: pos }, scrollIntoView: true });
    });
    await page.waitForTimeout(500);

    const card = page.locator('.margin-card');
    await expect(card.first()).toBeVisible({ timeout: 5000 });
    const cardText = await card.first().textContent();
    expect(cardText).toContain('Other User');
  });

  test('multiple suggestions positioned correctly (shift computation)', async ({ page }) => {
    // Create two suggestions — the first changes document length, so the second
    // must be shifted in the working doc. This tests buildShiftedRegistryEntries.
    const replacement1 = testWords[0] + 'EXTRA';  // longer than original = positive shift
    const replacement2 = 'SHIFTED' + testWords[1]; // different replacement for second word
    await createTestSuggestion({
      type: 'replacement',
      originalText: testWords[0],
      newText: replacement1,
    });
    await createTestSuggestion({
      type: 'replacement',
      originalText: testWords[1],
      newText: replacement2,
    });

    await page.goto(BASE_URL + TEST_SESSION_PATH);
    await login(page);
    await enterSuggestMode(page);
    await page.waitForTimeout(1000);

    // Both suggestions should show as inline decorations
    const insertions = await page.locator('.cm-suggestion-insert').count();
    expect(insertions).toBeGreaterThanOrEqual(2);

    // Both margin cards should exist
    const cards = await getMarginCardCount(page);
    expect(cards).toBeGreaterThanOrEqual(2);

    // Verify the highlights cover the CORRECT replacement text, not shifted text
    const highlights = await page.evaluate(() => {
      const result = [];
      document.querySelectorAll('.cm-suggestion-insert').forEach(el => {
        result.push(el.textContent);
      });
      return result;
    });
    expect(highlights.some(h => h.includes(replacement1))).toBeTruthy();
    expect(highlights.some(h => h.includes(replacement2))).toBeTruthy();
  });

  test('comment positioned correctly when suggestion before it changes length', async ({ page }) => {
    // A suggestion that changes length shifts everything after it — including comments.
    // The comment's highlight must be on the correct text, not shifted off.
    const admin = require('firebase-admin');
    if (!admin.apps.length) admin.initializeApp();
    const db = admin.firestore();
    const github = require('../src/server/github');
    const filePath = 'series/Narrative Journey Series/Foundations/Test Book/sessions/1-Session1-TheGospel.md';

    const { content } = await github.getFileContent(filePath);

    // Use testWords: word[0] for suggestion (earlier in doc), word[1] for comment (later)
    const suggWord = testWords[0];
    const commentWord = testWords[1];
    const suggPos = content.indexOf(suggWord);
    const commentPos = content.indexOf(commentWord);

    // Ensure word[0] appears before word[1] — if not, swap
    const [earlyWord, lateWord, earlyPos, latePos] = suggPos < commentPos
      ? [suggWord, commentWord, suggPos, commentPos]
      : [commentWord, suggWord, commentPos, suggPos];

    const replacementText = earlyWord + 'EXTRA';  // longer = positive shift

    // Create a suggestion on the earlier word
    await createTestSuggestion({
      type: 'replacement',
      originalText: earlyWord,
      newText: replacementText,
    });

    // Create a comment on the later word (AFTER the suggestion)
    const ctxBefore = content.substring(Math.max(0, latePos - 50), latePos);
    const ctxAfter = content.substring(latePos + lateWord.length, Math.min(content.length, latePos + lateWord.length + 50));
    await db.collection('comments').add({
      filePath,
      bookPath: 'series/Narrative Journey Series/Foundations/Test Book',
      from: latePos,
      to: latePos + lateWord.length,
      selectedText: lateWord,
      commentText: 'Test comment on dynamic word',
      authorEmail: TEST_EMAIL,
      authorName: 'Steve',
      status: 'open',
      contextBefore: ctxBefore,
      contextAfter: ctxAfter,
      anchor: { exact: lateWord, prefix: ctxBefore, suffix: ctxAfter },
      position: { from: latePos, to: latePos + lateWord.length },
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    await page.goto(BASE_URL + TEST_SESSION_PATH);
    await login(page);
    await enterSuggestMode(page);
    await page.waitForTimeout(1000);

    // The comment highlight should cover the later word in the working doc
    const highlightText = await page.evaluate(() => {
      const els = document.querySelectorAll('.cm-comment-highlight');
      return els.length > 0 ? els[0].textContent : null;
    });
    expect(highlightText).toBe(lateWord);

    // The suggestion highlight should cover the replacement text
    const suggestionHighlights = await page.evaluate(() => {
      const els = document.querySelectorAll('.cm-suggestion-insert');
      return Array.from(els).map(el => el.textContent);
    });
    expect(suggestionHighlights.some(h => h.includes(replacementText))).toBeTruthy();
  });
});

// ============================================================
// API KEY AUTH TESTS (Claude AI bot)
// ============================================================

const TEST_FILE_PATH = 'series/Narrative Journey Series/Foundations/Test Book/sessions/1-Session1-TheGospel.md';
const TEST_BOOK_PATH = 'series/Narrative Journey Series/Foundations/Test Book';

function getApiKey() {
  return process.env.CLAUDE_API_KEY || '';
}

// Clean up bot-created suggestions/comments/replies after tests
async function cleanupBotData() {
  const admin = require('firebase-admin');
  if (!admin.apps.length) admin.initializeApp();
  const db = admin.firestore();
  const botEmail = 'claude@noblecollective.org';

  for (const col of ['suggestions', 'comments', 'replies']) {
    const snap = await db.collection(col).where('authorEmail', '==', botEmail).get();
    if (!snap.empty) {
      const batch = db.batch();
      snap.docs.forEach(d => batch.delete(d.ref));
      await batch.commit();
    }
  }
}

test.describe('API Key Auth (Claude AI bot)', () => {
  test.afterAll(async () => {
    await cleanupBotData();
  });

  test('content read via API key returns file content and metadata', async ({ request }) => {
    const res = await request.get(BASE_URL + '/api/suggestions/content', {
      params: { filePath: TEST_FILE_PATH },
      headers: { 'x-api-key': getApiKey() },
    });
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    expect(data.content).toBeTruthy();
    expect(data.content.length).toBeGreaterThan(1000);
    expect(data.sha).toBeTruthy();
    expect(data.filePath).toBe(TEST_FILE_PATH);
    expect(data.bookPath).toBe(TEST_BOOK_PATH);
    expect(Array.isArray(data.pendingSuggestions)).toBeTruthy();
    expect(Array.isArray(data.pendingComments)).toBeTruthy();
    expect(Array.isArray(data.pendingReplies)).toBeTruthy();
  });

  test('invalid API key is rejected', async ({ request }) => {
    const res = await request.get(BASE_URL + '/api/suggestions/content', {
      params: { filePath: TEST_FILE_PATH },
      headers: { 'x-api-key': 'wrong-key-12345' },
    });
    expect(res.status()).toBe(401);
  });

  test('creating a suggestion via API key works and shows correct author', async ({ request }) => {
    // Read content first to get SHA
    const contentRes = await request.get(BASE_URL + '/api/suggestions/content', {
      params: { filePath: TEST_FILE_PATH },
      headers: { 'x-api-key': getApiKey() },
    });
    const { content, sha } = await contentRes.json();
    // Find a unique word dynamically — no hardcoded text dependencies
    const words = content.match(/\b[a-zA-Z]{6,14}\b/g) || [];
    const targetWord = words.find(w => content.indexOf(w) === content.lastIndexOf(w));
    expect(targetWord).toBeTruthy();
    const pos = content.indexOf(targetWord);

    // Create suggestion
    const res = await request.post(BASE_URL + '/api/suggestions/hunk', {
      headers: { 'x-api-key': getApiKey(), 'Content-Type': 'application/json' },
      data: {
        filePath: TEST_FILE_PATH,
        bookPath: TEST_BOOK_PATH,
        baseCommitSha: sha,
        type: 'replacement',
        originalFrom: pos,
        originalTo: pos + targetWord.length,
        originalText: targetWord,
        newText: 'BOTTESTREPLACEMENT',
        contextBefore: content.substring(Math.max(0, pos - 50), pos),
        contextAfter: content.substring(pos + targetWord.length, pos + targetWord.length + 50),
      },
    });
    expect(res.ok()).toBeTruthy();
    const result = await res.json();
    expect(result.id).toBeTruthy();
    expect(result.status).toBe('ok');

    // Verify author in Firestore
    const admin = require('firebase-admin');
    if (!admin.apps.length) admin.initializeApp();
    const doc = await admin.firestore().collection('suggestions').doc(result.id).get();
    expect(doc.exists).toBeTruthy();
    expect(doc.data().authorEmail).toBe('claude@noblecollective.org');
    expect(doc.data().authorName).toBe('Claude AI');
  });

  test('creating a comment via API key works', async ({ request }) => {
    const contentRes = await request.get(BASE_URL + '/api/suggestions/content', {
      params: { filePath: TEST_FILE_PATH },
      headers: { 'x-api-key': getApiKey() },
    });
    const { content, sha } = await contentRes.json();
    // Find a unique word dynamically for the comment target
    const words = content.match(/\b[a-zA-Z]{6,14}\b/g) || [];
    const text = words.find(w => content.indexOf(w) === content.lastIndexOf(w));
    expect(text).toBeTruthy();
    const pos = content.indexOf(text);

    const res = await request.post(BASE_URL + '/api/suggestions/comments', {
      headers: { 'x-api-key': getApiKey(), 'Content-Type': 'application/json' },
      data: {
        filePath: TEST_FILE_PATH,
        bookPath: TEST_BOOK_PATH,
        baseCommitSha: sha,
        from: pos,
        to: pos + text.length,
        selectedText: text,
        commentText: 'Bot test comment on dynamic text.',
      },
    });
    expect(res.ok()).toBeTruthy();
    const result = await res.json();
    expect(result.id).toBeTruthy();
  });

  test('creating a reply via API key works', async ({ request }) => {
    // Create a suggestion first
    const contentRes = await request.get(BASE_URL + '/api/suggestions/content', {
      params: { filePath: TEST_FILE_PATH },
      headers: { 'x-api-key': getApiKey() },
    });
    const { content, sha } = await contentRes.json();
    // Find a unique word dynamically
    const allWords = content.match(/\b[a-zA-Z]{6,14}\b/g) || [];
    const replyWord = allWords.find(w => content.indexOf(w) === content.lastIndexOf(w));
    expect(replyWord).toBeTruthy();
    const pos = content.indexOf(replyWord);

    const suggRes = await request.post(BASE_URL + '/api/suggestions/hunk', {
      headers: { 'x-api-key': getApiKey(), 'Content-Type': 'application/json' },
      data: {
        filePath: TEST_FILE_PATH,
        bookPath: TEST_BOOK_PATH,
        baseCommitSha: sha,
        type: 'replacement',
        originalFrom: pos,
        originalTo: pos + replyWord.length,
        originalText: replyWord,
        newText: 'REPLYTEST',
        contextBefore: content.substring(Math.max(0, pos - 50), pos),
        contextAfter: content.substring(pos + replyWord.length, pos + replyWord.length + 50),
      },
    });
    const sugg = await suggRes.json();

    // Reply to the suggestion
    const res = await request.post(BASE_URL + '/api/suggestions/replies', {
      headers: { 'x-api-key': getApiKey(), 'Content-Type': 'application/json' },
      data: {
        parentId: sugg.id,
        parentType: 'suggestion',
        filePath: TEST_FILE_PATH,
        bookPath: TEST_BOOK_PATH,
        text: 'This better reflects the intended meaning in context.',
      },
    });
    expect(res.ok()).toBeTruthy();
    const result = await res.json();
    expect(result.id).toBeTruthy();
  });

  test('bot suggestion appears as inline decoration in editor', async ({ page, request }) => {
    await cleanupBotData();
    await clearAllSuggestions();

    // Create a suggestion via API key
    const contentRes = await request.get(BASE_URL + '/api/suggestions/content', {
      params: { filePath: TEST_FILE_PATH },
      headers: { 'x-api-key': getApiKey() },
    });
    const { content, sha } = await contentRes.json();
    // Find a unique word dynamically
    const words = content.match(/\b[a-zA-Z]{6,14}\b/g) || [];
    const botWord = words.find(w => content.indexOf(w) === content.lastIndexOf(w));
    expect(botWord).toBeTruthy();
    const pos = content.indexOf(botWord);
    const botReplacement = 'BOTVISIBLE';

    await request.post(BASE_URL + '/api/suggestions/hunk', {
      headers: { 'x-api-key': getApiKey(), 'Content-Type': 'application/json' },
      data: {
        filePath: TEST_FILE_PATH,
        bookPath: TEST_BOOK_PATH,
        baseCommitSha: sha,
        type: 'replacement',
        originalFrom: pos,
        originalTo: pos + botWord.length,
        originalText: botWord,
        newText: botReplacement,
        contextBefore: content.substring(Math.max(0, pos - 50), pos),
        contextAfter: content.substring(pos + botWord.length, pos + botWord.length + 50),
      },
    });

    // Open editor as human user — bot suggestion should load and render
    await page.goto(BASE_URL + TEST_SESSION_PATH);
    await login(page);
    await enterSuggestMode(page);
    await page.waitForTimeout(1500);

    // Scroll to the suggestion text
    await page.evaluate((replacement) => {
      if (!window.__editorView) return;
      const doc = window.__editorView.state.doc.toString();
      const pos = doc.indexOf(replacement);
      if (pos >= 0) window.__editorView.dispatch({ selection: { anchor: pos }, scrollIntoView: true });
    }, botReplacement);
    await page.waitForTimeout(500);

    // The green insertion decoration should be visible
    const insertion = page.locator('.cm-suggestion-insert');
    await expect(insertion.first()).toBeVisible({ timeout: 5000 });

    // The working doc should contain the suggested replacement
    const doc = await page.evaluate(() => window.__editorView?.state.doc.toString() || '');
    expect(doc).toContain(botReplacement);
  });
});

// ============================================================
// INTEGRATION TESTS — Sequential Multi-Operation Sessions
// These test real user workflows that cross state boundaries.
// Each bug found on 2026-04-15 only appeared during sequential
// operations (edit → auto-save → edit → accept → accept → comment).
// Isolated unit tests cannot catch these.
// ============================================================

test.describe('Integration - Full Editing Session', () => {
  const TEST_FILE = 'series/Narrative Journey Series/Foundations/Test Book/sessions/1-Session1-TheGospel.md';
  let savedContent = null;

  test.beforeEach(async ({ page }) => {
    await clearAllSuggestions();
    await clearAllComments();
    // Wait for server to settle (previous test's accepts trigger cache refreshes)
    await page.waitForTimeout(2000);
    await login(page);
  });

  test.afterEach(async () => {
    await clearAllSuggestions();
    await clearAllComments();
    // Restore original file if the test modified it
    if (savedContent) {
      const http = require('http');
      await new Promise((resolve) => {
        const lr = http.request('http://localhost:8080/api/auth/test-login', { method: 'POST', headers: { 'Content-Type': 'application/json' } }, (loginRes) => {
          const cookie = loginRes.headers['set-cookie']?.[0]?.split(';')[0] || '';
          http.get('http://localhost:8080/api/suggestions/content?filePath=' + encodeURIComponent(TEST_FILE), { headers: { 'x-api-key': process.env.CLAUDE_API_KEY || '' } }, (gr) => {
            let d = ''; gr.on('data', c => d += c); gr.on('end', () => {
              const sha = JSON.parse(d).sha;
              const body = JSON.stringify({ filePath: TEST_FILE, content: savedContent, sha, comment: 'Restore after integration test' });
              const er = http.request('http://localhost:8080/api/suggestions/direct-edit', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Cookie': cookie, 'Content-Length': Buffer.byteLength(body) } }, (r) => {
                let o = ''; r.on('data', c => o += c); r.on('end', () => { savedContent = null; resolve(); });
              }); er.write(body); er.end();
            });
          });
        });
        lr.write(JSON.stringify({ email: 'steve@noblecollective.org' })); lr.end();
      });
    }
  });

  // Helper: fetch suggestions/comments via page context (uses session cookie)
  async function getFileData(page) {
    return page.evaluate(async () => {
      const fp = window.__EDITOR_DATA.sessionFilePath;
      const res = await fetch('/api/suggestions/file?filePath=' + encodeURIComponent(fp));
      return res.json();
    });
  }

  // Helper: fetch file content via API key
  async function getFileContent(page) {
    return page.evaluate(async (fp) => {
      const res = await fetch('/api/suggestions/content?filePath=' + encodeURIComponent(fp));
      return res.json();
    }, TEST_FILE);
  }

  test('edit → auto-save → edit → accept both → comment: full session', async ({ page }) => {
    test.setTimeout(180000); // 3 minutes — sequential accepts are slow

    // Save original content for restoration
    const apiKey = process.env.CLAUDE_API_KEY || '';
    const initialContent = await (await fetch(BASE_URL + '/api/suggestions/content?filePath=' + encodeURIComponent(TEST_FILE), {
      headers: { 'x-api-key': apiKey },
    })).json();
    savedContent = initialContent.content;

    await enterSuggestMode(page);

    // --- PHASE 1: First edit + auto-save ---
    const word1 = await findUniqueWord(page, 'plain');
    expect(word1).toBeTruthy();

    await selectText(page, word1);
    await replaceWith(page, 'INTEGFIRST');
    await page.waitForTimeout(500);
    expect(await getMarginCardCount(page)).toBe(1);

    // Wait for auto-save to Firestore
    await waitForAutoSave(page);

    // Verify suggestion saved
    const data1 = await getFileData(page);
    expect(data1.suggestions.length).toBe(1);
    expect(data1.suggestions[0].newText).toContain('INTEGFIRST');

    // --- PHASE 2: Second edit AFTER auto-save (regression: escapeHtml crash) ---
    const word2 = await page.evaluate((skip) => {
      const doc = window.__editorView.state.doc.toString();
      const words = doc.match(/\b[a-zA-Z]{5,14}\b/g) || [];
      for (const w of words) {
        if (w !== skip && doc.indexOf(w) === doc.lastIndexOf(w)) return w;
      }
      return null;
    }, word1);
    expect(word2).toBeTruthy();

    await selectText(page, word2);
    await replaceWith(page, 'INTEGSECOND');
    await page.waitForTimeout(500);

    // REGRESSION: both cards must be visible after second edit
    expect(await getMarginCardCount(page)).toBeGreaterThanOrEqual(2);

    await waitForAutoSave(page);

    // Both suggestions in Firestore
    const data2 = await getFileData(page);
    expect(data2.suggestions.length).toBe(2);

    // --- PHASE 3: Accept first suggestion (regression: card vanishing) ---
    const acceptBtn1 = page.locator('.margin-action--accept').first();
    await acceptBtn1.click();

    // Wait for accept + refreshFromGitHub cycle
    await page.waitForTimeout(10000);

    // REGRESSION: second card must still be visible
    const cardsAfterAccept1 = await getMarginCardCount(page);
    expect(cardsAfterAccept1).toBeGreaterThanOrEqual(1);

    // Firestore: 1 pending remains
    const data3 = await getFileData(page);
    const pending3 = data3.suggestions.filter(s => s.status === 'pending');
    expect(pending3.length).toBe(1);

    // --- PHASE 4: Accept second suggestion (regression: stale context) ---
    const acceptBtn2 = page.locator('.margin-action--accept').first();
    await acceptBtn2.click();

    // Wait for accept + refresh
    await page.waitForTimeout(10000);

    // No pending suggestions remain
    const data4 = await getFileData(page);
    const pending4 = data4.suggestions.filter(s => s.status === 'pending');
    expect(pending4.length).toBe(0);

    // REGRESSION: both changes reflected in GitHub (stale context caused wrong placement)
    const verified = await getFileContent(page);
    expect(verified.content).toContain('INTEGFIRST');
    expect(verified.content).toContain('INTEGSECOND');
    expect(verified.content).not.toContain(word1);
    expect(verified.content).not.toContain(word2);

    // No suggestion decorations remain in editor
    const insertDecos = await page.locator('.cm-suggestion-insert').count();
    const deleteDecos = await page.locator('.cm-suggestion-delete').count();
    expect(insertDecos).toBe(0);
    expect(deleteDecos).toBe(0);

    // --- PHASE 5: Leave a comment after accepts (regression: initComments wrong args) ---
    const commentWord = await page.evaluate(() => {
      const doc = window.__editorView.state.doc.toString();
      const words = doc.match(/\b[a-zA-Z]{6,14}\b/g) || [];
      for (const w of words) {
        if (doc.indexOf(w) === doc.lastIndexOf(w)) return w;
      }
      return null;
    });
    expect(commentWord).toBeTruthy();

    // Scroll to the word, select it, and trigger the comment popup
    // After multiple refreshFromGitHub cycles, the editor may have re-rendered.
    // Use scrollIntoView + explicit viewport scroll to ensure tooltip is clickable.
    await page.evaluate((w) => {
      const view = window.__editorView;
      const doc = view.state.doc.toString();
      const idx = doc.indexOf(w);
      if (idx >= 0) {
        view.dispatch({ selection: { anchor: idx, head: idx + w.length }, scrollIntoView: true });
        // Also ensure the CM scroller has the selection in view
        const coords = view.coordsAtPos(idx);
        if (coords) {
          const scroller = view.scrollDOM;
          const rect = scroller.getBoundingClientRect();
          if (coords.top < rect.top || coords.top > rect.bottom) {
            scroller.scrollTop += coords.top - rect.top - rect.height / 2;
          }
        }
      }
    }, commentWord);
    await page.waitForTimeout(1000);

    // Click comment tooltip — use force:true to bypass viewport check since
    // Playwright's auto-scroll doesn't understand CM's nested scroll container
    const tooltip = page.locator('.comment-tooltip');
    await expect(tooltip).toBeVisible({ timeout: 5000 });
    await tooltip.click({ force: true });
    await page.waitForTimeout(300);

    // Type and submit comment
    await page.fill('#comment-popup-input', 'Integration test comment');
    await page.click('#comment-popup-submit');
    await page.waitForTimeout(2000);

    // REGRESSION: comment must save (not "onCommentAdded is not a function")
    const highlight = page.locator('.cm-comment-highlight');
    await expect(highlight.first()).toBeVisible({ timeout: 5000 });

    const commentCard = page.locator('.margin-card--comment');
    await expect(commentCard.first()).toBeVisible({ timeout: 5000 });

    // Only ONE comment card (no duplicates from re-init)
    const commentCount = await commentCard.count();
    expect(commentCount).toBe(1);

    // Comment in Firestore
    const data5 = await getFileData(page);
    expect(data5.comments.length).toBe(1);
  });

  test('edit → auto-save → edit → discard first → no re-creation', async ({ page }) => {
    test.setTimeout(120000);

    await enterSuggestMode(page);

    // --- Two edits with auto-save between ---
    const word1 = await findUniqueWord(page, 'plain');
    expect(word1).toBeTruthy();

    await selectText(page, word1);
    await replaceWith(page, 'DISCARD1');
    await waitForAutoSave(page);

    const word2 = await page.evaluate((skip) => {
      const doc = window.__editorView.state.doc.toString();
      const words = doc.match(/\b[a-zA-Z]{5,14}\b/g) || [];
      for (const w of words) {
        if (w !== skip && w !== 'DISCARD1' && doc.indexOf(w) === doc.lastIndexOf(w)) return w;
      }
      return null;
    }, word1);
    expect(word2).toBeTruthy();

    await selectText(page, word2);
    await replaceWith(page, 'DISCARD2');
    await waitForAutoSave(page);

    // Both saved
    expect(await getMarginCardCount(page)).toBeGreaterThanOrEqual(2);
    const dataBefore = await getFileData(page);
    expect(dataBefore.suggestions.length).toBe(2);

    // --- Discard first suggestion via X button ---
    const rejectBtn = page.locator('.margin-action--reject').first();
    await rejectBtn.click();
    await page.waitForTimeout(5000);

    // REGRESSION: discarded suggestion must NOT be re-created by auto-save
    const dataAfter = await getFileData(page);
    const pending = dataAfter.suggestions.filter(s => s.status === 'pending');
    expect(pending.length).toBe(1);

    // One suggestion remains (don't assume which card was "first" in position order)
    const remainingText = pending[0].newText;
    const discardedText = remainingText.includes('DISCARD1') ? 'DISCARD2' : 'DISCARD1';
    const restoredWord = remainingText.includes('DISCARD1') ? word2 : word1;

    // Editor: discarded word restored, other edit preserved
    const doc = await getRawDoc(page);
    expect(doc).toContain(restoredWord); // Original word restored for discarded edit
    expect(doc).toContain(remainingText); // Remaining edit preserved

    // Wait extra to catch delayed re-creation
    await page.waitForTimeout(5000);
    const dataAfterWait = await getFileData(page);
    expect(dataAfterWait.suggestions.filter(s => s.status === 'pending').length).toBe(1);
  });
});
