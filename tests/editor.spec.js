// Noble Imprint — Comprehensive Editor Tests
// Tests the masked editor, suggestion tracking, auto-save, accept/reject
// Run with: npx playwright test tests/editor.spec.js

const { test, expect } = require('@playwright/test');

const BASE_URL = 'http://localhost:8080';
const TEST_SESSION_PATH = '/narrative-journey-series/foundations/test-book/1-session1-thegospel';
const TEST_FILE_PATH = 'series/Narrative Journey Series/Foundations/Test Book/sessions/1-Session1-TheGospel.md';
const TEST_EMAIL = 'steve@noblecollective.org';

// --- Helper: authenticate via test endpoint ---
async function login(page) {
  const res = await page.request.post(`${BASE_URL}/api/auth/test-login`, {
    data: { email: TEST_EMAIL },
  });
  expect(res.ok()).toBeTruthy();
  // Reload to pick up cookie
  await page.goto(BASE_URL + TEST_SESSION_PATH);
}

// --- Helper: enter suggest edit mode ---
async function enterSuggestMode(page) {
  await page.click('#btn-suggest-edit');
  await page.waitForSelector('#codemirror-host .cm-editor');
  // Wait for editor to be ready
  await page.waitForTimeout(500);
}

// --- Helper: enter direct edit mode ---
async function enterDirectMode(page) {
  await page.click('#btn-direct-edit');
  await page.waitForSelector('#codemirror-host .cm-editor');
  await page.waitForTimeout(500);
}

// --- Helper: get editor text content ---
async function getEditorContent(page) {
  return page.evaluate(() => {
    const cm = document.querySelector('.cm-content');
    return cm ? cm.textContent : '';
  });
}

// --- Helper: get raw editor document ---
async function getRawDoc(page) {
  return page.evaluate(() => {
    if (window.__editorView) return window.__editorView.state.doc.toString();
    return null;
  });
}

// --- Helper: scroll editor to a position in the document ---
async function scrollEditorTo(page, fraction) {
  await page.evaluate((frac) => {
    if (window.__editorView) {
      const doc = window.__editorView.state.doc;
      const pos = Math.floor(doc.length * frac);
      window.__editorView.dispatch({
        effects: window.__editorView.constructor.scrollIntoView(pos, { y: 'start' }),
      });
    }
  }, fraction);
  await page.waitForTimeout(300);
}

// --- Helper: place cursor at a specific text in the editor ---
async function clickTextInEditor(page, searchText) {
  const found = await page.evaluate((text) => {
    if (!window.__editorView) return false;
    const doc = window.__editorView.state.doc.toString();
    const pos = doc.indexOf(text);
    if (pos === -1) return false;
    // Set cursor at the end of the found text
    window.__editorView.dispatch({
      selection: { anchor: pos + text.length },
      scrollIntoView: true,
    });
    window.__editorView.focus();
    return true;
  }, searchText);
  expect(found).toBeTruthy();
  await page.waitForTimeout(200);
}

// --- Helper: type at cursor position ---
async function typeAtCursor(page, text) {
  await page.keyboard.type(text);
  await page.waitForTimeout(200);
}

// --- Helper: select text in editor ---
async function selectTextInEditor(page, searchText) {
  const found = await page.evaluate((text) => {
    if (!window.__editorView) return false;
    const doc = window.__editorView.state.doc.toString();
    const pos = doc.indexOf(text);
    if (pos === -1) return false;
    window.__editorView.dispatch({
      selection: { anchor: pos, head: pos + text.length },
      scrollIntoView: true,
    });
    window.__editorView.focus();
    return true;
  }, searchText);
  expect(found).toBeTruthy();
  await page.waitForTimeout(200);
}

// --- Helper: count margin cards ---
async function getMarginCardCount(page) {
  return page.locator('.margin-card').count();
}

// --- Helper: wait for auto-save ---
async function waitForAutoSave(page) {
  // Auto-save debounce is 1500ms, wait a bit more
  await page.waitForTimeout(2500);
}

// --- Helper: check Firestore suggestions count ---
async function getPendingSuggestionCount() {
  // Use the API endpoint (requires auth cookie from the page context)
  const admin = require('firebase-admin');
  if (!admin.apps.length) admin.initializeApp();
  const db = admin.firestore();
  const snap = await db.collection('suggestions').where('status', '==', 'pending').get();
  return snap.size;
}

// --- Helper: clear all suggestions ---
async function clearAllSuggestions() {
  const admin = require('firebase-admin');
  if (!admin.apps.length) admin.initializeApp();
  const db = admin.firestore();
  const snap = await db.collection('suggestions').get();
  const batch = db.batch();
  snap.docs.forEach(d => batch.delete(d.ref));
  await batch.commit();
}

// ============================================================
// TEST SUITE
// ============================================================

test.describe('Editor - Masking', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(BASE_URL + TEST_SESSION_PATH);
    await login(page);
    await enterSuggestMode(page);
  });

  test('headings are masked - # markers hidden, text styled', async ({ page }) => {
    // The H1 "# Session 1: The Gospel" should show without the "# "
    const h1 = page.locator('.cm-heading-1');
    await expect(h1.first()).toBeVisible();
    const text = await h1.first().textContent();
    expect(text).toContain('Session 1: The Gospel');
    expect(text).not.toContain('# ');
  });

  test('H2 headings masked', async ({ page }) => {
    const h2 = page.locator('.cm-heading-2');
    await expect(h2.first()).toBeVisible();
    const text = await h2.first().textContent();
    expect(text).not.toContain('## ');
  });

  test('H3 headings masked', async ({ page }) => {
    const h3 = page.locator('.cm-heading-3');
    await expect(h3.first()).toBeVisible();
  });

  test('bold markers hidden - ** not visible', async ({ page }) => {
    const bold = page.locator('.cm-bold');
    await expect(bold.first()).toBeVisible();
    // Check the visible text doesn't contain **
    const editorText = await getEditorContent(page);
    expect(editorText).not.toContain('**earnestly');
  });

  test('italic markers hidden - _ not visible', async ({ page }) => {
    const italic = page.locator('.cm-italic');
    await expect(italic.first()).toBeVisible();
  });

  test('blockquote markers hidden - > not visible at line start', async ({ page }) => {
    const bq = page.locator('.cm-blockquote');
    await expect(bq.first()).toBeVisible();
  });

  test('attribution markers hidden - << not visible', async ({ page }) => {
    const attr = page.locator('.cm-attribution');
    await expect(attr.first()).toBeVisible();
    const text = await attr.first().textContent();
    expect(text).not.toContain('<<');
  });

  test('Question tags hidden, content styled', async ({ page }) => {
    // Question blocks start around line 41 — scroll to ~30% of document
    await scrollEditorTo(page, 0.10);
    const qBlock = page.locator('.cm-question-block');
    await expect(qBlock.first()).toBeVisible({ timeout: 5000 });
    const text = await qBlock.first().textContent();
    expect(text).not.toContain('<Question');
    expect(text).not.toContain('</Question>');
    expect(text.length).toBeGreaterThan(10);
  });

  test('Callout tags hidden, content styled', async ({ page }) => {
    // Callouts appear around line 69+ — scroll to ~50% of document
    await scrollEditorTo(page, 0.40);
    const callout = page.locator('.cm-callout');
    await expect(callout.first()).toBeVisible({ timeout: 5000 });
    const text = await callout.first().textContent();
    expect(text).not.toContain('<Callout>');
    expect(text).not.toContain('</Callout>');
  });

  test('raw document still contains structural syntax', async ({ page }) => {
    const raw = await getRawDoc(page);
    expect(raw).toContain('# Session 1');
    expect(raw).toContain('<Question id=');
    expect(raw).toContain('</Question>');
    expect(raw).toContain('<Callout>');
    expect(raw).toContain('<<');
    expect(raw).toContain('**');
  });
});

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
    // Find and click on "Christianity" in the paragraph text
    await clickTextInEditor(page, 'Christianity');
    // Select the word
    await page.keyboard.press('Control+Shift+Left');
    // Type replacement
    await typeAtCursor(page, 'Faith');

    // Check inline decorations appear
    await page.waitForTimeout(500);
    const insertions = page.locator('.cm-suggestion-insert');
    const deletions = page.locator('.cm-suggestion-delete');
    await expect(insertions.first()).toBeVisible();
    // Deletion widget should appear
    await expect(deletions.first()).toBeVisible();
  });

  test('adding text shows only green insertion', async ({ page }) => {
    // Click at end of "The Gospel" heading
    await clickTextInEditor(page, 'The Gospel');
    await page.keyboard.press('End');
    await typeAtCursor(page, ' - Updated');

    await page.waitForTimeout(500);
    const insertions = page.locator('.cm-suggestion-insert');
    await expect(insertions.first()).toBeVisible();
    const text = await insertions.first().textContent();
    expect(text).toContain('Updated');
  });

  test('deleting text shows red strikethrough', async ({ page }) => {
    // Select "sovereign king" and delete
    await selectTextInEditor(page, 'sovereign king');
    await page.keyboard.press('Delete');

    await page.waitForTimeout(500);
    const deletions = page.locator('.cm-suggestion-delete');
    await expect(deletions.first()).toBeVisible();
  });

  test('margin card appears for each change', async ({ page }) => {
    // Make a change
    await selectTextInEditor(page, 'Christianity');
    await typeAtCursor(page, 'Faith');
    await page.waitForTimeout(500);

    const count = await getMarginCardCount(page);
    expect(count).toBeGreaterThan(0);
  });

  test('margin card shows user name and avatar', async ({ page }) => {
    await selectTextInEditor(page, 'Christianity');
    await typeAtCursor(page, 'Faith');
    await page.waitForTimeout(500);

    const name = page.locator('.margin-card-name');
    await expect(name.first()).toBeVisible();
  });

  test('two edits in different areas create two margin cards', async ({ page }) => {
    // Edit 1: change "Christianity" to "Faith"
    await selectTextInEditor(page, 'Christianity');
    await typeAtCursor(page, 'Faith');
    await page.waitForTimeout(300);

    // Edit 2: change "sovereign" to "supreme"
    await selectTextInEditor(page, 'sovereign');
    await typeAtCursor(page, 'supreme');
    await page.waitForTimeout(500);

    const count = await getMarginCardCount(page);
    expect(count).toBeGreaterThanOrEqual(2);
  });
});

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
    // Make a change
    await selectTextInEditor(page, 'Christianity');
    await typeAtCursor(page, 'Faith');

    // Wait for auto-save (1500ms debounce + network time)
    await waitForAutoSave(page);

    // Check Firestore
    const count = await getPendingSuggestionCount();
    expect(count).toBeGreaterThan(0);
  });

  test('"Saved" status appears in toolbar after auto-save', async ({ page }) => {
    await selectTextInEditor(page, 'Christianity');
    await typeAtCursor(page, 'Faith');

    // Wait for save status
    await page.waitForSelector('#editor-save-status:not(:empty)', { timeout: 5000 });
    const status = await page.textContent('#editor-save-status');
    expect(status).toBe('Saved');
  });

  test('discarding a suggestion (X) deletes from Firestore', async ({ page }) => {
    // Make a change and wait for save
    await selectTextInEditor(page, 'Christianity');
    await typeAtCursor(page, 'Faith');
    await waitForAutoSave(page);

    const before = await getPendingSuggestionCount();
    expect(before).toBeGreaterThan(0);

    // Click the X button on the margin card
    await page.click('.margin-action--reject');
    await page.waitForTimeout(1000);

    const after = await getPendingSuggestionCount();
    expect(after).toBe(before - 1);
  });

  test('reverting an edit removes it from Firestore', async ({ page }) => {
    // Make a change
    await selectTextInEditor(page, 'Christianity');
    await typeAtCursor(page, 'Faith');
    await waitForAutoSave(page);

    // Undo
    await page.keyboard.press('Control+z');
    await page.keyboard.press('Control+z');
    await waitForAutoSave(page);

    const count = await getPendingSuggestionCount();
    expect(count).toBe(0);
  });
});

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

  test('editing inside a Question block preserves tags', async ({ page }) => {
    // Find question text and edit it
    await clickTextInEditor(page, 'What happened when the Holy Spirit');
    await page.keyboard.press('Home');
    await typeAtCursor(page, 'TEST: ');

    // Verify raw doc still has Question tags
    const raw = await getRawDoc(page);
    expect(raw).toContain('<Question id=TheCallSes1-Hearing-Q1>');
    expect(raw).toContain('</Question>');
    expect(raw).toContain('TEST: 1. What happened');
  });

  test('editing inside a Callout block preserves tags', async ({ page }) => {
    await clickTextInEditor(page, 'All who genuinely believe');
    await page.keyboard.press('Home');
    await typeAtCursor(page, 'Indeed, ');

    const raw = await getRawDoc(page);
    expect(raw).toContain('<Callout>');
    expect(raw).toContain('</Callout>');
    expect(raw).toContain('Indeed, All who genuinely');
  });

  test('editing attribution text preserves << marker', async ({ page }) => {
    await clickTextInEditor(page, 'The Path of Discipleship');
    await page.keyboard.press('End');
    await typeAtCursor(page, ' (revised)');

    const raw = await getRawDoc(page);
    expect(raw).toContain('<< _The Path of Discipleship (revised)_');
  });

  test('editing heading text preserves # markers', async ({ page }) => {
    await clickTextInEditor(page, 'Session Overview');
    await page.keyboard.press('End');
    await typeAtCursor(page, ' (Draft)');

    const raw = await getRawDoc(page);
    expect(raw).toContain('## Session Overview (Draft)');
  });

  test('editing bold text preserves ** markers', async ({ page }) => {
    await clickTextInEditor(page, 'Key Passage');
    await page.keyboard.press('End');
    await typeAtCursor(page, ' Updated');

    const raw = await getRawDoc(page);
    expect(raw).toContain('**Key Passage Updated**');
  });

  test('editing blockquote text preserves > marker', async ({ page }) => {
    await clickTextInEditor(page, 'Disciples of Christ');
    await page.keyboard.press('End');
    await typeAtCursor(page, ' today');

    const raw = await getRawDoc(page);
    expect(raw).toContain('>Disciples of Christ today');
  });

  test('editing between two structural blocks does not corrupt them', async ({ page }) => {
    // Edit text between two Question blocks
    const raw1 = await getRawDoc(page);
    const qCount1 = (raw1.match(/<Question/g) || []).length;

    // Click in the text area between questions
    await clickTextInEditor(page, 'Retell this story');
    await page.keyboard.press('Home');
    await typeAtCursor(page, 'Please ');

    const raw2 = await getRawDoc(page);
    const qCount2 = (raw2.match(/<Question/g) || []).length;
    expect(qCount2).toBe(qCount1); // Same number of Question blocks
  });

  test('typing at the start of a heading line preserves # prefix', async ({ page }) => {
    // Place cursor right at the beginning of "Session Overview" (H2)
    await page.evaluate(() => {
      const doc = window.__editorView.state.doc.toString();
      const pos = doc.indexOf('## Session Overview');
      // Position cursor right after "## " (at the S of Session)
      window.__editorView.dispatch({
        selection: { anchor: pos + 3 },
        scrollIntoView: true,
      });
      window.__editorView.focus();
    });
    await page.waitForTimeout(200);
    await page.keyboard.press('Home');
    await typeAtCursor(page, 'New ');

    const raw = await getRawDoc(page);
    // The ## should still be there, and "New" should be in the heading text
    expect(raw).toContain('## New Session Overview');
  });

  test('typing at the end of a heading preserves structure', async ({ page }) => {
    await clickTextInEditor(page, 'Key Elements');
    await page.keyboard.press('End');
    await typeAtCursor(page, ' (v2)');

    const raw = await getRawDoc(page);
    expect(raw).toContain('### Key Elements (v2)');
  });

  test('deleting a word at the boundary of bold does not corrupt markers', async ({ page }) => {
    // "**earnestly receive" — select "earnestly" and delete it
    await selectTextInEditor(page, 'earnestly');
    await page.keyboard.press('Delete');

    const raw = await getRawDoc(page);
    // Bold markers should still be intact
    expect(raw).toContain('**');
    expect(raw).not.toContain('***'); // No triple asterisks
  });

  test('editing italic text inside attribution preserves structure', async ({ page }) => {
    // The Path of Discipleship is italic inside <<
    await clickTextInEditor(page, 'The Path of Discipleship');
    await selectTextInEditor(page, 'Path');
    await typeAtCursor(page, 'Way');

    const raw = await getRawDoc(page);
    expect(raw).toContain('<< _The Way of Discipleship_');
  });
});

test.describe('Editor - Accept/Reject Flow', () => {
  test.beforeEach(async ({ page }) => {
    await clearAllSuggestions();
    await page.goto(BASE_URL + TEST_SESSION_PATH);
    await login(page);
  });

  test.afterEach(async () => {
    await clearAllSuggestions();
  });

  test('creating suggestion and reviewing shows Review button', async ({ page }) => {
    // Create a suggestion
    await enterSuggestMode(page);
    await selectTextInEditor(page, 'Christianity');
    await typeAtCursor(page, 'Faith');
    await waitForAutoSave(page);

    // Exit editor
    await page.click('#btn-editor-done');
    await page.waitForNavigation();

    // Should see Review button
    const reviewBtn = page.locator('#btn-review');
    await expect(reviewBtn).toBeVisible();
  });

  test('accept button commits to GitHub', async ({ page }) => {
    // Create suggestion
    await enterSuggestMode(page);
    await selectTextInEditor(page, 'Christianity');
    await typeAtCursor(page, 'Faith');
    await waitForAutoSave(page);
    await page.click('#btn-editor-done');
    await page.waitForNavigation();

    // Enter review mode
    await page.click('#btn-review');
    await page.waitForSelector('.margin-card');

    // Click accept
    await page.click('.margin-action--accept');
    await page.waitForNavigation({ timeout: 30000 });

    // Verify suggestion is gone from Firestore
    const count = await getPendingSuggestionCount();
    expect(count).toBe(0);
  });
});

test.describe('Editor - Direct Edit (Admin)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(BASE_URL + TEST_SESSION_PATH);
    await login(page);
  });

  test('direct edit mode shows "Direct Editing" label', async ({ page }) => {
    await enterDirectMode(page);
    const label = page.locator('#editor-mode-label');
    await expect(label).toHaveText('Direct Editing');
  });

  test('direct edit has no suggestion decorations', async ({ page }) => {
    await enterDirectMode(page);
    await selectTextInEditor(page, 'Christianity');
    await typeAtCursor(page, 'Faith');
    await page.waitForTimeout(500);

    // Should not have suggestion decorations in direct mode
    const insertions = page.locator('.cm-suggestion-insert');
    await expect(insertions).toHaveCount(0);
  });
});
