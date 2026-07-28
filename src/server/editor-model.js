// Editor-model assembly for shared-content editing (P1 server foundation).
//
// buildEditorModel is a PURE function (no I/O) that turns a resolved buffer +
// segment map + per-file annotations into the shape the editor client will
// consume. It is unit-tested directly with in-memory fixtures.
//
// getEditorModel is the thin I/O wrapper that fetches the session + referenced
// common files (with SHAs) and pending annotations, resolves each annotation
// against its own source file, then delegates to buildEditorModel. Requires are
// lazy so unit tests can import buildEditorModel without booting server deps.

// Map a source-file offset to a buffer offset via the segment map. Returns null
// when the position doesn't land in an editable piece of that source file (e.g.
// it fell inside a read-only param span, or the file isn't in the buffer).
function mapSourcePosToBuffer(segments, sourceFile, srcPos) {
  for (const seg of segments) {
    if (seg.sourceFile !== sourceFile) continue;
    for (const p of seg.pieces) {
      if (!p.editable) continue;
      if (srcPos >= p.srcFrom && srcPos <= p.srcTo) {
        return p.bufFrom + (srcPos - p.srcFrom);
      }
    }
  }
  return null;
}

// Attach buffer offsets to one annotation (already resolved to source offsets).
function mapAnnotation(segments, anno, sourceFile) {
  const out = Object.assign({}, anno, { sourceFile });
  if (anno.resolvedStale || anno.resolvedFrom == null || anno.resolvedTo == null) {
    out.bufferMapped = false;
    out.bufferFrom = null;
    out.bufferTo = null;
    return out;
  }
  const bf = mapSourcePosToBuffer(segments, sourceFile, anno.resolvedFrom);
  const bt = mapSourcePosToBuffer(segments, sourceFile, anno.resolvedTo);
  if (bf == null || bt == null) {
    out.bufferMapped = false;
    out.bufferFrom = null;
    out.bufferTo = null;
  } else {
    out.bufferMapped = true;
    out.bufferFrom = bf;
    out.bufferTo = bt;
  }
  return out;
}

// Pure assembler.
//   resolved   : the editor buffer text (from resolveIncludesTracked)
//   segments   : the segment map (from resolveIncludesTracked)
//   files      : [{ path, level, sha }] — session (level 'session') first, then
//                each REFERENCED common file. Callers must pre-filter to files
//                actually present in the buffer so a no-@include session gets
//                files=[session] (today's shape).
//   annotationsByFile : { path: { suggestions: [...], comments: [...] } } where
//                each annotation carries resolvedFrom/resolvedTo (source offsets)
//                or resolvedStale=true.
// Returns { resolvedContent, segments, files, pendingSuggestions, pendingComments }.
function buildEditorModel(resolved, segments, files, annotationsByFile) {
  annotationsByFile = annotationsByFile || {};
  const pendingSuggestions = [];
  const pendingComments = [];
  for (const f of files) {
    const bucket = annotationsByFile[f.path];
    if (!bucket) continue;
    for (const s of (bucket.suggestions || [])) pendingSuggestions.push(mapAnnotation(segments, s, f.path));
    for (const c of (bucket.comments || [])) pendingComments.push(mapAnnotation(segments, c, f.path));
  }
  return {
    resolvedContent: resolved,
    segments,
    files,
    pendingSuggestions,
    pendingComments,
  };
}

// I/O wrapper. Given a resolved route ({ series, subseries, book, session }),
// returns the full editor model. Backward-compatible: a session with no
// @include yields segments=[one session segment] and files=[session], and only
// the session file's annotations (exactly today's data set).
async function getEditorModel(resolvedRoute) {
  const content = require('./content');
  const github = require('./github');
  const suggestions = require('./suggestions');
  const { resolveIncludesTracked } = require('../renderer/parser');

  const { series, subseries, book, session } = resolvedRoute;
  const sessionData = await content.loadSessionContent(session);
  const sessionMeta = { sourceFile: session.path, sourceSha: sessionData.sha };

  const { index, files: commonFiles } = await content.gatherCommonBlocksTracked(series, subseries || null, book);
  const { resolved, segments } = resolveIncludesTracked(sessionData.content, index, sessionMeta);

  // Only common files actually referenced by this session belong in the model.
  const usedPaths = new Set(segments.filter(s => s.kind === 'shared').map(s => s.sourceFile));
  const files = [
    { path: session.path, level: 'session', sha: sessionData.sha },
    ...commonFiles.filter(f => usedPaths.has(f.path)),
  ];

  // Gather + resolve annotations per file, in source space.
  const annotationsByFile = {};
  for (const f of files) {
    const fileContent = f.path === session.path
      ? sessionData.content
      : (await github.getFileContent(f.path)).content;
    const sugg = await suggestions.getSuggestionsForFile(f.path);
    const comm = await suggestions.getCommentsForFile(f.path);
    for (const s of sugg) {
      const r = suggestions.resolveAnchor(s, fileContent);
      if (!r.stale) { s.resolvedFrom = r.from; s.resolvedTo = r.to; } else { s.resolvedStale = true; }
    }
    for (const c of comm) {
      const r = suggestions.resolveAnchor(c, fileContent);
      if (!r.stale) { c.resolvedFrom = r.from; c.resolvedTo = r.to; } else { c.resolvedStale = true; }
    }
    annotationsByFile[f.path] = { suggestions: sugg, comments: comm };
  }

  const model = buildEditorModel(resolved, segments, files, annotationsByFile);
  // Mirror getSessionPageData: editing must start from live content, so surface
  // when the session came from the disk-cache fallback (GitHub unavailable).
  model.fromDiskCache = sessionData.fromDiskCache || false;
  return model;
}

module.exports = { buildEditorModel, getEditorModel, mapSourcePosToBuffer };
