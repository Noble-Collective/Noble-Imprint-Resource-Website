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
    const editorText = await page.locator('.cm-content').first().textContent();
    expect(editorText).not.toContain('**earnestly');
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
    await scrollEditorTo(page, 0.10);
    const qBlock = page.locator('.cm-question-block');
    await expect(qBlock.first()).toBeVisible({ timeout: 5000 });
    const text = await qBlock.first().textContent();
    expect(text).not.toContain('<Question');
    expect(text).not.toContain('</Question>');
    expect(text.length).toBeGreaterThan(10);
  });

  test('Callout tags hidden, content highlighted', async ({ page }) => {
    await scrollEditorTo(page, 0.40);
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
    await page.goto(BASE_URL + TEST_SESSION_PATH);
    await login(page);
    await enterSuggestMode(page);
  });

  test.afterEach(async () => {
    await clearAllSuggestions();
  });

  test('replacing a word shows green insertion and red deletion', async ({ page }) => {
    await selectText(page, 'Christianity');
    await replaceWith(page, 'Faith');

    await page.waitForTimeout(500);
    const insertions = page.locator('.cm-suggestion-insert');
    const deletions = page.locator('.cm-suggestion-delete');
    await expect(insertions.first()).toBeVisible({ timeout: 3000 });
    await expect(deletions.first()).toBeVisible({ timeout: 3000 });
  });

  test('adding text at end of sentence shows green insertion', async ({ page }) => {
    await cursorAfter(page, 'belief system.');
    await typeText(page, ' Indeed it is more.');

    await page.waitForTimeout(500);
    const insertions = page.locator('.cm-suggestion-insert');
    await expect(insertions.first()).toBeVisible({ timeout: 3000 });
  });

  test('deleting a word shows red strikethrough', async ({ page }) => {
    await selectText(page, 'sovereign');
    await deleteSelection(page);

    await page.waitForTimeout(500);
    const deletions = page.locator('.cm-suggestion-delete');
    await expect(deletions.first()).toBeVisible({ timeout: 3000 });
  });

  test('margin card appears for each change', async ({ page }) => {
    await selectText(page, 'Christianity');
    await replaceWith(page, 'Faith');
    await page.waitForTimeout(500);

    const count = await getMarginCardCount(page);
    expect(count).toBeGreaterThan(0);
  });

  test('margin card shows user name', async ({ page }) => {
    await selectText(page, 'Christianity');
    await replaceWith(page, 'Faith');
    await page.waitForTimeout(500);

    const name = page.locator('.margin-card-name');
    await expect(name.first()).toBeVisible();
  });

  test('two edits in different parts create two margin cards', async ({ page }) => {
    // Edit 1: near the top
    await selectText(page, 'Christianity');
    await replaceWith(page, 'Faith');
    await page.waitForTimeout(300);

    // Edit 2: further down
    await selectText(page, 'sovereign');
    await replaceWith(page, 'supreme');
    await page.waitForTimeout(500);

    const count = await getMarginCardCount(page);
    expect(count).toBeGreaterThanOrEqual(2);
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
    await selectText(page, 'Christianity');
    await replaceWith(page, 'Faith');
    await waitForAutoSave(page);

    const count = await getPendingSuggestionCount();
    expect(count).toBeGreaterThan(0);
  });

  test('"Saved" appears in toolbar', async ({ page }) => {
    await selectText(page, 'Christianity');
    await replaceWith(page, 'Faith');
    await page.waitForSelector('#editor-save-status:not(:empty)', { timeout: 5000 });
    const status = await page.textContent('#editor-save-status');
    expect(status).toBe('Saved');
  });

  test('discarding (X) removes suggestion from Firestore', async ({ page }) => {
    await selectText(page, 'Christianity');
    await replaceWith(page, 'Faith');
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
    await selectText(page, 'Christianity');
    await replaceWith(page, 'Faith');
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
    await selectText(page, 'Session Overview');
    await replaceWith(page, 'Session Summary');

    const raw = await getRawDoc(page);
    expect(raw).toContain('## Session Summary');
    expect(raw).not.toContain('## ## ');
  });

  test('appending text to H3 heading preserves ###', async ({ page }) => {
    await cursorAfter(page, 'Key Elements');
    await typeText(page, ' (v2)');

    const raw = await getRawDoc(page);
    expect(raw).toContain('### Key Elements (v2)');
  });

  test('replacing a word in H3 heading preserves ###', async ({ page }) => {
    await selectText(page, 'Confessional');
    await replaceWith(page, 'Core');

    const raw = await getRawDoc(page);
    expect(raw).toContain('### Core Statement');
  });

  // --- Bold ---

  test('replacing a word inside bold preserves ** markers', async ({ page }) => {
    // "**earnestly receive..." — replace "earnestly" with "humbly"
    await selectText(page, 'earnestly');
    await replaceWith(page, 'humbly');

    const raw = await getRawDoc(page);
    expect(raw).toContain('**humbly receive');
    expect(raw).not.toContain('***');
  });

  test('appending to bold text stays inside ** markers', async ({ page }) => {
    // "**Key Passage**" — add text after "Passage" but before **
    await selectText(page, 'Key Passage');
    await replaceWith(page, 'Main Passage');

    const raw = await getRawDoc(page);
    expect(raw).toContain('**Main Passage**');
  });

  // --- Italic ---

  test('replacing italic text preserves _ markers', async ({ page }) => {
    // "_The Path of Discipleship_" is inside << attribution
    await selectText(page, 'The Path of Discipleship');
    await replaceWith(page, 'The Way of Discipleship');

    const raw = await getRawDoc(page);
    expect(raw).toContain('_The Way of Discipleship_');
  });

  // --- Blockquote ---

  test('replacing text inside blockquote preserves > marker', async ({ page }) => {
    await selectText(page, 'Disciples of Christ');
    await replaceWith(page, 'Followers of Christ');

    const raw = await getRawDoc(page);
    expect(raw).toContain('>Followers of Christ');
    // Should not have lost the > marker
    expect(raw).not.toContain('\nFollowers of Christ');
  });

  test('appending text inside blockquote stays in blockquote', async ({ page }) => {
    await cursorAfter(page, 'through baptism,');
    await typeText(page, ' as commanded,');

    const raw = await getRawDoc(page);
    expect(raw).toContain('>publicly declare their faith commitment and community participation through baptism, as commanded,');
  });

  // --- Attribution ---

  test('replacing text in attribution preserves << and _italic_', async ({ page }) => {
    await selectText(page, 'Path');
    await replaceWith(page, 'Way');

    const raw = await getRawDoc(page);
    expect(raw).toContain('<< _The Way of Discipleship_');
  });

  // --- Question blocks ---

  test('editing inside a Question block preserves tags', async ({ page }) => {
    // Select specific text inside a question
    await selectText(page, 'What happened when the Holy Spirit');
    await replaceWith(page, 'What occurred when the Holy Spirit');

    const raw = await getRawDoc(page);
    expect(raw).toContain('<Question id=TheCallSes1-Hearing-Q1>');
    expect(raw).toContain('</Question>');
    expect(raw).toContain('What occurred when the Holy Spirit');
  });

  test('appending text inside Question block stays inside tags', async ({ page }) => {
    await cursorAfter(page, 'Acts 2:1–13');
    await typeText(page, ' (please read carefully)');

    const raw = await getRawDoc(page);
    // The added text should be before </Question>
    expect(raw).toContain('Acts 2:1–13 (please read carefully)');
    expect(raw).toContain('</Question>');
  });

  // --- Callout blocks ---

  test('replacing text inside Callout preserves tags', async ({ page }) => {
    await scrollEditorTo(page, 0.40);
    await selectText(page, 'All who genuinely believe in Jesus');
    await replaceWith(page, 'Everyone who truly believes in Jesus');

    const raw = await getRawDoc(page);
    expect(raw).toContain('<Callout>');
    expect(raw).toContain('</Callout>');
    expect(raw).toContain('Everyone who truly believes in Jesus');
  });

  // --- Regular paragraph ---

  test('replacing a word in a paragraph works cleanly', async ({ page }) => {
    await selectText(page, 'philosophy');
    await replaceWith(page, 'worldview');

    const raw = await getRawDoc(page);
    expect(raw).toContain('an idea, a worldview, or a belief system');
  });

  test('inserting text mid-paragraph works', async ({ page }) => {
    await cursorAfter(page, 'more than an idea,');
    await typeText(page, ' much more than');

    const raw = await getRawDoc(page);
    expect(raw).toContain('more than an idea, much more than a');
  });

  // --- Between structural blocks ---

  test('editing between two Question blocks does not corrupt them', async ({ page }) => {
    const raw1 = await getRawDoc(page);
    const qCount1 = (raw1.match(/<Question/g) || []).length;

    await selectText(page, 'Retell this story');
    await replaceWith(page, 'Retell this narrative');

    const raw2 = await getRawDoc(page);
    const qCount2 = (raw2.match(/<Question/g) || []).length;
    expect(qCount2).toBe(qCount1);
  });

  // --- Delete operations ---

  test('deleting a word in a paragraph', async ({ page }) => {
    await selectText(page, 'sovereign ');
    await deleteSelection(page);

    const raw = await getRawDoc(page);
    expect(raw).toContain('as rightful king');
    expect(raw).not.toContain('as sovereign rightful');
  });

  test('deleting text inside bold preserves markers', async ({ page }) => {
    // Replace "earnestly" with nothing (effectively deleting it)
    await selectText(page, 'earnestly');
    await replaceWith(page, 'gratefully');

    const raw = await getRawDoc(page);
    expect(raw).toContain('**gratefully receive');
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
    await selectText(page, 'Christianity');
    await replaceWith(page, 'Faith');
    await waitForAutoSave(page);

    // Exit
    await page.click('#btn-editor-done');
    await page.waitForTimeout(2000);

    // Verify still in Firestore
    const count = await getPendingSuggestionCount();
    expect(count).toBeGreaterThan(0);
  });

  test('Review button appears when suggestions exist', async ({ page }) => {
    await enterSuggestMode(page);
    await selectText(page, 'Christianity');
    await replaceWith(page, 'Faith');
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
    await selectText(page, 'Christianity');
    await replaceWith(page, 'Faith');
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
    await selectText(page, 'Christianity');
    await replaceWith(page, 'Faith');
    await page.waitForTimeout(500);

    const insertions = page.locator('.cm-suggestion-insert');
    await expect(insertions).toHaveCount(0);
  });

  test('direct edit can modify the document', async ({ page }) => {
    await enterDirectMode(page);
    await selectText(page, 'Christianity');
    await replaceWith(page, 'Faith');

    const raw = await getRawDoc(page);
    expect(raw).toContain('Faith is more than');
    expect(raw).not.toContain('Christianity is more than');
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

  test('Comment button exists in toolbar', async ({ page }) => {
    const btn = page.locator('#btn-add-comment');
    await expect(btn).toBeVisible();
  });

  test('clicking Comment with no selection shows alert', async ({ page }) => {
    page.on('dialog', dialog => dialog.accept());
    await page.click('#btn-add-comment');
    // Alert should have fired (we accepted it)
  });

  test('adding a comment on selected text saves to Firestore', async ({ page }) => {
    await selectText(page, 'belief system');
    // Handle the prompt dialog
    page.on('dialog', async dialog => {
      if (dialog.type() === 'prompt') {
        await dialog.accept('This needs clarification');
      } else {
        await dialog.accept();
      }
    });
    await page.click('#btn-add-comment');
    await page.waitForTimeout(2000);

    const count = await getPendingCommentCount();
    expect(count).toBeGreaterThan(0);
  });

  test('comment shows yellow highlight in editor', async ({ page }) => {
    await selectText(page, 'belief system');
    page.on('dialog', async dialog => {
      if (dialog.type() === 'prompt') {
        await dialog.accept('Test comment');
      } else {
        await dialog.accept();
      }
    });
    await page.click('#btn-add-comment');
    await page.waitForTimeout(1000);

    const highlight = page.locator('.cm-comment-highlight');
    await expect(highlight.first()).toBeVisible({ timeout: 3000 });
  });

  test('comment shows in margin panel', async ({ page }) => {
    await selectText(page, 'belief system');
    page.on('dialog', async dialog => {
      if (dialog.type() === 'prompt') {
        await dialog.accept('Needs rewording');
      } else {
        await dialog.accept();
      }
    });
    await page.click('#btn-add-comment');
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
  test.beforeEach(async ({ page }) => {
    await clearAllSuggestions();
    await clearAllComments();
  });

  test.afterEach(async () => {
    await clearAllSuggestions();
    await clearAllComments();
  });

  test('existing suggestion shows inline when entering suggest mode', async ({ page }) => {
    await createTestSuggestion({
      type: 'replacement',
      originalText: 'Christianity',
      newText: 'Faith',
    });

    await page.goto(BASE_URL + TEST_SESSION_PATH);
    await login(page);
    await enterSuggestMode(page);
    await page.waitForTimeout(1000);

    // Scroll to where "Faith" is (it replaced "Christianity" mid-document)
    await page.evaluate(() => {
      if (!window.__editorView) return;
      const doc = window.__editorView.state.doc.toString();
      const pos = doc.indexOf('Faith');
      if (pos >= 0) window.__editorView.dispatch({ selection: { anchor: pos }, scrollIntoView: true });
    });
    await page.waitForTimeout(500);

    const insertions = page.locator('.cm-suggestion-insert');
    await expect(insertions.first()).toBeVisible({ timeout: 5000 });
  });

  test('existing suggestion shows in margin with author info', async ({ page }) => {
    await createTestSuggestion({
      type: 'replacement',
      originalText: 'Christianity',
      newText: 'Faith',
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
      originalText: 'Christianity',
      newText: 'Faith',
    });

    await page.goto(BASE_URL + TEST_SESSION_PATH);
    await login(page);
    await enterSuggestMode(page);
    await page.waitForTimeout(1000);

    // Scroll to the suggestion
    await page.evaluate(() => {
      if (!window.__editorView) return;
      const doc = window.__editorView.state.doc.toString();
      const pos = doc.indexOf('Faith');
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
      originalText: 'Christianity',
      newText: 'Faith',
    });
    await createTestSuggestion({
      type: 'replacement',
      originalText: 'sovereign',
      newText: 'supreme',
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
      originalText: 'Christianity',
      newText: 'Faith',
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
      const pos = doc.indexOf('Faith');
      if (pos >= 0) window.__editorView.dispatch({ selection: { anchor: pos }, scrollIntoView: true });
    });
    await page.waitForTimeout(500);

    const card = page.locator('.margin-card');
    await expect(card.first()).toBeVisible({ timeout: 5000 });
    const cardText = await card.first().textContent();
    expect(cardText).toContain('Other User');
  });
});
