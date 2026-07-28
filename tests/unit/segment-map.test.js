// Unit tests for the P1 shared-content-editing server foundation:
// the segment-map resolver (resolveIncludesTracked) and the editor-model
// assembler (buildEditorModel). Pure functions, in-memory fixtures — no server,
// no GitHub. Run with:  npm run test:unit
const test = require('node:test');
const assert = require('node:assert');
const { resolveIncludes, resolveIncludesTracked } = require('../../src/renderer/parser');
const { buildEditorModel } = require('../../src/server/editor-model');
const { parseCommonBlocks } = require('../../src/server/content');

// ── Fixtures (mirror Test Book Session 5) ────────────────────────────────────
const commonBookMd = `<TestBookNote>
This is a shared book-level note.
It spans two lines.
</TestBookNote>
`;

const commonSeriesMd = `<TestSharedSeriesNote>
I believe in God.
Some other line.
</TestSharedSeriesNote>

<TestQuestionBlock>
<Question id="{id}">What do you think?</Question>
</TestQuestionBlock>
`;

const sessionMd = `# Session 5

Intro paragraph.

<!-- @include: TestBookNote -->

Middle paragraph.

<!-- @include: TestSharedSeriesNote bold="I believe in God." -->

<!-- @include: TestQuestionBlock id="Ses5Q1" -->

End paragraph.
`;

const BOOK_PATH = 'series/S/Foundations/Test Book/commonBook.md';
const SERIES_PATH = 'series/S/commonSeries.md';
const SESSION_PATH = 'series/S/Foundations/Test Book/sessions/5-Session5-Includes.md';

// Local block indexer — mirrors what content.gatherCommonBlocksTracked produces,
// so the resolver test doesn't depend on the server module.
function indexBlocks(md, sourceFile, sourceSha, level, index) {
  const re = /<([A-Za-z][A-Za-z0-9]*)>\r?\n([\s\S]*?)\r?\n<\/\1>/g;
  let m;
  while ((m = re.exec(md)) !== null) {
    const bodyStart = m.index + m[0].indexOf('\n') + 1;
    index[m[1]] = { body: m[2], sourceFile, sourceSha, level, srcFrom: bodyStart };
  }
  return index;
}

function buildIndex() {
  const index = {};
  indexBlocks(commonBookMd, BOOK_PATH, 'sha-book', 'book', index);
  indexBlocks(commonSeriesMd, SERIES_PATH, 'sha-series', 'series', index);
  return index;
}

// map sourceFile -> its full text, for verbatim checks
const SOURCE = {
  [SESSION_PATH]: sessionMd,
  [BOOK_PATH]: commonBookMd,
  [SERIES_PATH]: commonSeriesMd,
};

const sessionMeta = { sourceFile: SESSION_PATH, sourceSha: 'sha-session' };

// ── Tests ────────────────────────────────────────────────────────────────────

test('no-include session returns a single verbatim session segment (backward compatible)', () => {
  const src = '# Hello\n\nJust a plain session with no includes.\n';
  const { resolved, segments } = resolveIncludesTracked(src, {}, sessionMeta);
  assert.strictEqual(resolved, src);
  assert.strictEqual(resolved, resolveIncludes(src, {}));
  assert.strictEqual(segments.length, 1);
  const s = segments[0];
  assert.strictEqual(s.kind, 'session');
  assert.strictEqual(s.sourceFile, SESSION_PATH);
  assert.strictEqual(s.additiveOffset, 0);
  assert.strictEqual(s.includeDirective, null);
  assert.deepStrictEqual(s.readonlySpans, []);
  assert.strictEqual(s.bufFrom, 0);
  assert.strictEqual(s.bufTo, src.length);
});

test('empty content yields no segments and empty buffer', () => {
  const { resolved, segments } = resolveIncludesTracked('', {}, sessionMeta);
  assert.strictEqual(resolved, '');
  assert.deepStrictEqual(segments, []);
});

test('tracked resolution matches resolveIncludes byte-for-byte', () => {
  const index = buildIndex();
  const bodies = {};
  for (const k of Object.keys(index)) bodies[k] = index[k].body;
  const { resolved } = resolveIncludesTracked(sessionMd, index, sessionMeta);
  assert.strictEqual(resolved, resolveIncludes(sessionMd, bodies));
});

test('segments are contiguous and reconstruct the full buffer', () => {
  const { resolved, segments } = resolveIncludesTracked(sessionMd, buildIndex(), sessionMeta);
  let cursor = 0;
  let rebuilt = '';
  for (const s of segments) {
    assert.strictEqual(s.bufFrom, cursor, 'segment starts where previous ended');
    rebuilt += resolved.slice(s.bufFrom, s.bufTo);
    cursor = s.bufTo;
  }
  assert.strictEqual(cursor, resolved.length);
  assert.strictEqual(rebuilt, resolved);
});

test('INVARIANT: every editable piece is a verbatim slice of its source file', () => {
  const { resolved, segments } = resolveIncludesTracked(sessionMd, buildIndex(), sessionMeta);
  for (const s of segments) {
    const source = SOURCE[s.sourceFile];
    assert.ok(source, `source known for ${s.sourceFile}`);
    for (const p of s.pieces) {
      // buffer text must equal the buffer slice
      const bufText = resolved.slice(p.bufFrom, p.bufTo);
      if (p.editable) {
        assert.strictEqual(
          bufText,
          source.slice(p.srcFrom, p.srcTo),
          `editable piece [${p.bufFrom},${p.bufTo}) in ${s.sourceFile} must be verbatim source`
        );
      }
    }
  }
});

test('session segments carry a correct additive offset back to session source', () => {
  const { resolved, segments } = resolveIncludesTracked(sessionMd, buildIndex(), sessionMeta);
  for (const s of segments.filter(x => x.kind === 'session')) {
    for (let bufPos = s.bufFrom; bufPos < s.bufTo; bufPos++) {
      const srcPos = bufPos + s.additiveOffset;
      assert.strictEqual(resolved[bufPos], sessionMd[srcPos]);
    }
  }
});

test('shared @include lines become boundaries with the directive captured verbatim', () => {
  const { segments } = resolveIncludesTracked(sessionMd, buildIndex(), sessionMeta);
  const shared = segments.filter(s => s.kind === 'shared');
  assert.strictEqual(shared.length, 3);
  for (const s of shared) {
    assert.ok(s.includeDirective, 'shared segment has a directive');
    const { text, srcFrom, srcTo } = s.includeDirective;
    // directive text is not present in the buffer, but IS verbatim in session source
    assert.strictEqual(sessionMd.slice(srcFrom, srcTo), text);
    assert.match(text, /^<!--\s*@include:/);
  }
});

test('bold= inserts read-only ** spans around an editable, verbatim middle', () => {
  const { resolved, segments } = resolveIncludesTracked(sessionMd, buildIndex(), sessionMeta);
  const seg = segments.find(s => s.key === 'TestSharedSeriesNote');
  assert.ok(seg, 'found the bold segment');
  assert.strictEqual(seg.level, 'series');
  assert.strictEqual(seg.sourceFile, SERIES_PATH);
  // exactly two read-only spans, both '**', both reason 'bold'
  assert.strictEqual(seg.readonlySpans.length, 2);
  for (const rs of seg.readonlySpans) {
    assert.strictEqual(resolved.slice(rs.bufFrom, rs.bufTo), '**');
    assert.strictEqual(rs.reason, 'bold');
  }
  // the resolved buffer shows the bolded line
  assert.ok(resolved.includes('**I believe in God.**'));
  // additiveOffset is null (multiple pieces)
  assert.strictEqual(seg.additiveOffset, null);
  // the editable text between the ** markers is verbatim in the series source
  const editableMiddle = seg.pieces.filter(p => p.editable);
  const middleText = editableMiddle.map(p => resolved.slice(p.bufFrom, p.bufTo)).join('');
  assert.ok(middleText.includes('I believe in God.'));
});

test('{id} substitution is a single read-only span mapping to the {id} token', () => {
  const { resolved, segments } = resolveIncludesTracked(sessionMd, buildIndex(), sessionMeta);
  const seg = segments.find(s => s.key === 'TestQuestionBlock');
  assert.ok(seg, 'found the id segment');
  const idSpans = seg.readonlySpans.filter(r => r.reason === 'id');
  assert.strictEqual(idSpans.length, 1);
  assert.strictEqual(resolved.slice(idSpans[0].bufFrom, idSpans[0].bufTo), 'Ses5Q1');
  // the read-only piece maps to the 4-char {id} token in the series source
  const idPiece = seg.pieces.find(p => !p.editable && p.reason === 'id');
  assert.strictEqual(commonSeriesMd.slice(idPiece.srcFrom, idPiece.srcTo), '{id}');
  assert.ok(resolved.includes('id="Ses5Q1"'));
});

test('undefined @include key throws (parity with resolveIncludes)', () => {
  assert.throws(
    () => resolveIncludesTracked('<!-- @include: NoSuchKey -->', {}, sessionMeta),
    /undefined key "NoSuchKey"/
  );
});

test('{id} block without an id param throws', () => {
  const index = buildIndex();
  assert.throws(
    () => resolveIncludesTracked('<!-- @include: TestQuestionBlock -->', index, sessionMeta),
    /requires an id/
  );
});

// ── bold= (multi-line run + substring) and active= branches ──────────────────
// Build a one-block index + a session that includes it, and return {resolved, seg}.
function includeOnce(commonMd, key, params) {
  const idx = {};
  indexBlocks(commonMd, SERIES_PATH, 'sha-series', 'series', idx);
  const session = `Before.\n\n<!-- @include: ${key}${params ? ' ' + params : ''} -->\n\nAfter.\n`;
  const { resolved, segments } = resolveIncludesTracked(session, idx, sessionMeta);
  // the editor buffer must be byte-for-byte identical to the reading-view resolution
  const bodies = {}; for (const k of Object.keys(idx)) bodies[k] = idx[k].body;
  assert.strictEqual(resolved, resolveIncludes(session, bodies));
  return { resolved, seg: segments.find(s => s.key === key), source: commonMd };
}

// Assert the verbatim-slice invariant holds for every editable piece of a segment.
function assertVerbatim(seg, resolved, source) {
  for (const p of seg.pieces) {
    if (p.editable) assert.strictEqual(resolved.slice(p.bufFrom, p.bufTo), source.slice(p.srcFrom, p.srcTo));
  }
}

test('bold= across a multi-line run bolds each line and keeps middles verbatim', () => {
  const md = `<MultiNote>\nI believe in God.\nSome other line.\n</MultiNote>\n`;
  const { resolved, seg, source } = includeOnce(md, 'MultiNote', 'bold="I believe in God. Some other line."');
  assert.ok(resolved.includes('**I believe in God.**\n**Some other line.**'));
  assert.strictEqual(seg.readonlySpans.length, 4); // ** x2 per line
  assert.ok(seg.readonlySpans.every(r => r.reason === 'bold'));
  assertVerbatim(seg, resolved, source);
});

test('bold= substring inside a line wraps just the substring', () => {
  const md = `<SubNote>\nI believe in God today.\n</SubNote>\n`;
  const { resolved, seg, source } = includeOnce(md, 'SubNote', 'bold="God"');
  assert.ok(resolved.includes('I believe in **God** today.'));
  assert.strictEqual(seg.readonlySpans.length, 2);
  assertVerbatim(seg, resolved, source);
});

test('active= inserts a read-only " active" span on the matching Item', () => {
  const md = `<InfoNote>\n<Infographic title="x">\n<Item icon="a" label="Lament">body</Item>\n<Item icon="b" label="Praise">body</Item>\n</Infographic>\n</InfoNote>\n`;
  const { resolved, seg, source } = includeOnce(md, 'InfoNote', 'active="Praise"');
  assert.ok(resolved.includes('<Item icon="b" label="Praise" active>'));
  assert.ok(!resolved.includes('<Item icon="a" label="Lament" active>'));
  const activeSpans = seg.readonlySpans.filter(r => r.reason === 'active');
  assert.strictEqual(activeSpans.length, 1);
  assert.strictEqual(resolved.slice(activeSpans[0].bufFrom, activeSpans[0].bufTo), ' active');
  assertVerbatim(seg, resolved, source);
});

test('combined {id} + bold on one block keeps all editable pieces verbatim', () => {
  const md = `<Combo>\nheader line\n<Question id="{id}">Ponder this.</Question>\n</Combo>\n`;
  const { resolved, seg, source } = includeOnce(md, 'Combo', 'id="Q9" bold="header line"');
  assert.ok(resolved.includes('**header line**'));
  assert.ok(resolved.includes('id="Q9"'));
  assert.ok(seg.readonlySpans.some(r => r.reason === 'id'));
  assert.ok(seg.readonlySpans.some(r => r.reason === 'bold'));
  assertVerbatim(seg, resolved, source);
  // and the tracked buffer equals resolveIncludes for the same input
});

// ── content.js: parseCommonBlocksTracked / gatherCommonBlocksTracked ─────────
const content = require('../../src/server/content');
const github = require('../../src/server/github');

test('parseCommonBlocksTracked records body offsets that slice back to the body', () => {
  const blocks = content.parseCommonBlocksTracked(commonSeriesMd);
  assert.strictEqual(blocks.length, 2);
  for (const b of blocks) {
    assert.strictEqual(commonSeriesMd.slice(b.srcFrom, b.srcFrom + b.body.length), b.body);
  }
});

test('gatherCommonBlocksTracked loads files with SHAs and applies precedence', async () => {
  const orig = github.getFileContent;
  github.getFileContent = async (p) => {
    if (p.endsWith('commonSeries.md')) return { content: commonSeriesMd, sha: 'sha-series' };
    if (p.endsWith('commonBook.md')) return { content: commonBookMd, sha: 'sha-book' };
    throw new Error('not found: ' + p);
  };
  try {
    const series = { repoPath: 'series/S' };
    const book = { repoPath: 'series/S/Foundations/Test Book' };
    const { index, files } = await content.gatherCommonBlocksTracked(series, null, book);
    assert.strictEqual(index.TestBookNote.sourceFile, BOOK_PATH);
    assert.strictEqual(index.TestBookNote.sourceSha, 'sha-book');
    assert.strictEqual(index.TestBookNote.level, 'book');
    assert.strictEqual(index.TestSharedSeriesNote.sourceFile, SERIES_PATH);
    assert.strictEqual(index.TestSharedSeriesNote.level, 'series');
    // srcFrom lands on the body verbatim
    assert.strictEqual(commonSeriesMd.slice(index.TestSharedSeriesNote.srcFrom, index.TestSharedSeriesNote.srcFrom + b_len('I believe in God.')), 'I believe in God.');
    // files: lowest-precedence first, each with a sha
    assert.deepStrictEqual(files.map(f => f.level), ['series', 'book']);
    assert.ok(files.every(f => typeof f.sha === 'string'));
  } finally {
    github.getFileContent = orig;
  }
});
function b_len(s) { return s.length; }

// ── editor-model.js: buildEditorModel (pure) ─────────────────────────────────

// Convenience: resolve + build a model for the full session with a set of
// per-file annotations already anchored to SOURCE offsets.
function modelFor(annotationsByFile) {
  const index = buildIndex();
  const { resolved, segments } = resolveIncludesTracked(sessionMd, index, sessionMeta);
  const files = [
    { path: SESSION_PATH, level: 'session', sha: 'sha-session' },
    { path: SERIES_PATH, level: 'series', sha: 'sha-series' },
    { path: BOOK_PATH, level: 'book', sha: 'sha-book' },
  ];
  return { resolved, model: buildEditorModel(resolved, segments, files, annotationsByFile) };
}

test('buildEditorModel returns session-first files each with path/level/sha', () => {
  const { model } = modelFor({});
  assert.strictEqual(model.files[0].level, 'session');
  assert.strictEqual(model.files[0].path, SESSION_PATH);
  for (const f of model.files) {
    assert.ok(f.path && f.level && f.sha, 'file has path/level/sha');
  }
  assert.strictEqual(model.resolvedContent, resolveIncludes(sessionMd, (() => {
    const b = {}; const i = buildIndex(); for (const k of Object.keys(i)) b[k] = i[k].body; return b;
  })()));
});

test('buildEditorModel maps a session-file annotation to the right buffer text', () => {
  const from = sessionMd.indexOf('Middle paragraph.');
  const to = from + 'Middle paragraph.'.length;
  const { resolved, model } = modelFor({
    [SESSION_PATH]: { suggestions: [{ id: 's1', resolvedFrom: from, resolvedTo: to }], comments: [] },
  });
  const s = model.pendingSuggestions.find(x => x.id === 's1');
  assert.strictEqual(s.sourceFile, SESSION_PATH);
  assert.strictEqual(s.bufferMapped, true);
  assert.strictEqual(resolved.slice(s.bufferFrom, s.bufferTo), 'Middle paragraph.');
});

test('buildEditorModel maps a shared-file annotation into its shared segment', () => {
  const from = commonSeriesMd.indexOf('I believe in God.');
  const to = from + 'I believe in God.'.length;
  const { resolved, model } = modelFor({
    [SERIES_PATH]: { suggestions: [{ id: 'shared1', resolvedFrom: from, resolvedTo: to }], comments: [] },
  });
  const s = model.pendingSuggestions.find(x => x.id === 'shared1');
  assert.strictEqual(s.sourceFile, SERIES_PATH);
  assert.strictEqual(s.bufferMapped, true);
  // maps to the editable, verbatim text between the inserted ** markers
  assert.strictEqual(resolved.slice(s.bufferFrom, s.bufferTo), 'I believe in God.');
});

test('buildEditorModel flags an annotation landing inside a read-only {id} span as unmapped', () => {
  const idAt = commonSeriesMd.indexOf('{id}');
  const { model } = modelFor({
    [SERIES_PATH]: { suggestions: [{ id: 'ro', resolvedFrom: idAt + 1, resolvedTo: idAt + 3 }], comments: [] },
  });
  const s = model.pendingSuggestions.find(x => x.id === 'ro');
  assert.strictEqual(s.bufferMapped, false);
  assert.strictEqual(s.bufferFrom, null);
});

test('buildEditorModel flags a stale annotation as unmapped', () => {
  const { model } = modelFor({
    [SESSION_PATH]: { suggestions: [{ id: 'stale', resolvedStale: true }], comments: [] },
  });
  const s = model.pendingSuggestions.find(x => x.id === 'stale');
  assert.strictEqual(s.bufferMapped, false);
});

test('BACKWARD COMPAT: no-include session yields segments=[session], files=[session], session-only annotations', () => {
  const src = '# Plain\n\nNo includes here.\n';
  const { resolved, segments } = resolveIncludesTracked(src, buildIndex(), sessionMeta);
  assert.strictEqual(segments.length, 1);
  assert.strictEqual(segments[0].kind, 'session');
  // caller filters files to referenced ones → just the session
  const files = [{ path: SESSION_PATH, level: 'session', sha: 'sha-session' }];
  const model = buildEditorModel(resolved, segments, files, {
    [SESSION_PATH]: { suggestions: [{ id: 'a', resolvedFrom: 2, resolvedTo: 7 }], comments: [] },
    // a common file annotation is present but the file is NOT in `files` → excluded
    [SERIES_PATH]: { suggestions: [{ id: 'ignored', resolvedFrom: 0, resolvedTo: 3 }], comments: [] },
  });
  assert.strictEqual(model.files.length, 1);
  assert.strictEqual(model.pendingSuggestions.length, 1);
  assert.strictEqual(model.pendingSuggestions[0].id, 'a');
});

// ── Block keys may contain underscores/dashes (e.g. Recall_BookOverview_KeyIdea) ──
test('block keys with underscores/dashes parse and resolve (reading + tracked)', () => {
  const md = `<Recall_BookOverview_KeyIdea>
Summarize the main idea of this study.
</Recall_BookOverview_KeyIdea>

<Recall-Faith-Foundation>
Explore the discussion questions with your community.
</Recall-Faith-Foundation>
`;
  const blocks = parseCommonBlocks(md);
  assert.ok('Recall_BookOverview_KeyIdea' in blocks, 'underscore key parsed');
  assert.ok('Recall-Faith-Foundation' in blocks, 'dash key parsed');

  const session = 'Before\n<!-- @include: Recall_BookOverview_KeyIdea -->\nAfter\n';
  const resolved = resolveIncludes(session, blocks);
  assert.match(resolved, /Summarize the main idea/);
  assert.doesNotMatch(resolved, /@include/);

  // editor variant must agree
  const blockIndex = {
    Recall_BookOverview_KeyIdea: { body: blocks['Recall_BookOverview_KeyIdea'], sourceFile: 'commonSeries.md', level: 'series', sha: 'x' },
  };
  const tracked = resolveIncludesTracked(session, blockIndex, {});
  assert.strictEqual(tracked.resolved, resolved, 'tracked resolver byte-parity with resolveIncludes');
});
