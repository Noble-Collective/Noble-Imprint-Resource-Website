const { test } = require('node:test');
const assert = require('node:assert');

const ac = require('../../src/server/access-control');

const BOOK = 'series/Narrative Journey Series/Foundations/Book A';

// --- filePathBelongsToBook ----------------------------------------------------

test('filePathBelongsToBook: a session inside the book is allowed', () => {
  assert.strictEqual(ac.filePathBelongsToBook(BOOK + '/sessions/1-Intro.md', BOOK), true);
});

test('filePathBelongsToBook: the book\'s own commonBook.md is allowed', () => {
  assert.strictEqual(ac.filePathBelongsToBook(BOOK + '/commonBook.md', BOOK), true);
});

test('filePathBelongsToBook: an ancestor commonSeries.md the book includes is allowed', () => {
  assert.strictEqual(ac.filePathBelongsToBook('series/Narrative Journey Series/commonSeries.md', BOOK), true);
});

test('filePathBelongsToBook: an ancestor commonSubseries.md is allowed', () => {
  assert.strictEqual(ac.filePathBelongsToBook('series/Narrative Journey Series/Foundations/commonSubseries.md', BOOK), true);
});

test('filePathBelongsToBook: ANOTHER book\'s session is rejected (cross-file write)', () => {
  assert.strictEqual(ac.filePathBelongsToBook('series/Narrative Journey Series/Foundations/Book B/sessions/1.md', BOOK), false);
});

test('filePathBelongsToBook: a commonSeries.md on a DIFFERENT series is rejected', () => {
  assert.strictEqual(ac.filePathBelongsToBook('series/Other Series/commonSeries.md', BOOK), false);
});

test('filePathBelongsToBook: null/empty inputs are rejected', () => {
  assert.strictEqual(ac.filePathBelongsToBook('', BOOK), false);
  assert.strictEqual(ac.filePathBelongsToBook(BOOK + '/sessions/1.md', ''), false);
});

// --- owningDirForFile ---------------------------------------------------------

test('owningDirForFile: session -> book dir', () => {
  assert.strictEqual(ac.owningDirForFile(BOOK + '/sessions/1-Intro.md'), BOOK);
});
test('owningDirForFile: commonBook.md -> book dir', () => {
  assert.strictEqual(ac.owningDirForFile(BOOK + '/commonBook.md'), BOOK);
});
test('owningDirForFile: commonSeries.md -> series dir', () => {
  assert.strictEqual(ac.owningDirForFile('series/Narrative Journey Series/commonSeries.md'), 'series/Narrative Journey Series');
});

// --- hasRoleAtOrUnder ---------------------------------------------------------

test('hasRoleAtOrUnder: exact book role matches', () => {
  const roles = { [BOOK.replace(/\//g, '|')]: 'comment-suggest' };
  assert.strictEqual(ac.hasRoleAtOrUnder(roles, BOOK), true);
});

test('hasRoleAtOrUnder: a role on a book under a series grants the series common dir', () => {
  const roles = { [BOOK.replace(/\//g, '|')]: 'manuscript-owner' };
  assert.strictEqual(ac.hasRoleAtOrUnder(roles, 'series/Narrative Journey Series'), true);
});

test('hasRoleAtOrUnder: a role on a book in a DIFFERENT series does not grant this series', () => {
  const roles = { ['series/Other Series/Sub/Book'.replace(/\//g, '|')]: 'admin' };
  assert.strictEqual(ac.hasRoleAtOrUnder(roles, 'series/Narrative Journey Series'), false);
});

test('hasRoleAtOrUnder: a falsy role value does not count', () => {
  const roles = { [BOOK.replace(/\//g, '|')]: null };
  assert.strictEqual(ac.hasRoleAtOrUnder(roles, BOOK), false);
});

// --- neutralizeDangerousHtml --------------------------------------------------

test('neutralizeDangerousHtml: strips <script> blocks', () => {
  const out = ac.neutralizeDangerousHtml('hello <script>alert(1)</script> world');
  assert.ok(!/script/i.test(out), out);
  assert.ok(out.includes('hello') && out.includes('world'));
});

test('neutralizeDangerousHtml: strips inline event handlers', () => {
  const out = ac.neutralizeDangerousHtml('<img src="x" onerror="alert(1)">');
  assert.ok(!/onerror/i.test(out), out);
});

test('neutralizeDangerousHtml: neutralizes javascript: URIs', () => {
  const out = ac.neutralizeDangerousHtml('<a href="javascript:alert(1)">x</a>');
  assert.ok(!/javascript:/i.test(out), out);
});

test('neutralizeDangerousHtml: leaves ordinary markdown and custom tags untouched', () => {
  const md = '## Heading\n\n<Question>What is grace?</Question>\n\n<<Augustine>>\n\n**bold** and _em_ and [a](https://x.com)';
  assert.strictEqual(ac.neutralizeDangerousHtml(md), md);
});
