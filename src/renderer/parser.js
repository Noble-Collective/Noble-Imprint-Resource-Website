const MarkdownIt = require('markdown-it');
const footnotePlugin = require('markdown-it-footnote');
const scripture = require('../vendor/scripture.cjs');

// ── Common-content includes ──────────────────────────────────────────────
// Resolves `<!-- @include: KeyName param="value" -->` directives against a
// { KeyName: content } map gathered from the book/subseries/series common files.
// Supports three parameters:
//   id="…"     — substitutes every {id} token in the block (unique ids for shared questions)
//   bold="…"   — bolds the passed text: a single line, a run of consecutive lines
//                (joined by spaces), or a partial substring within one line
//   active="…" — marks the single <Item> in the block whose label matches as active
//                (a filled node in an infographic timeline)
// Errors are HARD: an undefined key, a missing required id, a bold target that
// matches no line, or an active target that matches no item throws — surfacing the
// problem rather than silently dropping content.
class IncludeError extends Error {}

function parseIncludeParams(str) {
  const params = {};
  const re = /(\w+)="([^"]*)"/g;
  let m;
  while ((m = re.exec(str)) !== null) params[m[1]] = m[2];
  return params;
}

function boldMatchingLine(body, target, key) {
  // Bolds the passed text within the block. Handles three cases so the caller can
  // pass the ACTUAL text to emphasize (not a line number):
  //   1. a single full line,
  //   2. a run of consecutive full lines (joined by spaces) — each line is bolded,
  //   3. a partial substring inside one line.
  const parsed = body.split('\n').map(line => {
    const m = line.match(/^(\s*>\s*)?([\s\S]*?)(\s*)$/);
    return { line, prefix: m[1] || '', text: m[2], trailing: m[3] || '' };
  });
  const norm = s => s.replace(/\s+/g, ' ').trim();
  const tgt = norm(target);

  // (1)/(2) contiguous run of full lines whose joined visible text equals the target
  for (let s = 0; s < parsed.length; s++) {
    if (!parsed[s].text) continue;
    let joined = '';
    for (let e = s; e < parsed.length; e++) {
      if (!parsed[e].text) break;
      joined = joined ? `${joined} ${norm(parsed[e].text)}` : norm(parsed[e].text);
      if (joined === tgt) {
        for (let i = s; i <= e; i++) {
          parsed[i].line = `${parsed[i].prefix}**${parsed[i].text}**${parsed[i].trailing}`;
        }
        return parsed.map(p => p.line).join('\n');
      }
      if (!tgt.startsWith(joined)) break; // this run can't grow into the target
    }
  }
  // (3) partial substring inside a single line
  for (const p of parsed) {
    if (p.text && p.text.includes(target)) {
      p.line = `${p.prefix}${p.text.replace(target, `**${target}**`)}${p.trailing}`;
      return parsed.map(x => x.line).join('\n');
    }
  }
  throw new IncludeError(`@include "${key}": bold="${target}" matched no line(s) in the block`);
}

function activateMatchingItem(body, target, key) {
  let found = false;
  const out = body.replace(/<Item\b([^>]*)>/g, (full, attrs) => {
    const lm = attrs.match(/label="([^"]*)"/);
    if (!found && lm && lm[1] === target) {
      found = true;
      if (/\bactive\b/.test(attrs)) return full;
      return `<Item${attrs} active>`;
    }
    return full;
  });
  if (!found) throw new IncludeError(`@include "${key}": active="${target}" matched no <Item label> in the block`);
  return out;
}

function resolveIncludes(content, blocks) {
  if (!content || content.indexOf('@include') === -1) return content;
  return content.replace(
    /<!--\s*@include:\s*([A-Za-z][A-Za-z0-9_-]*)\s*(.*?)\s*-->/g,
    (full, key, paramStr) => {
      if (!blocks || !(key in blocks)) {
        throw new IncludeError(`@include references undefined key "${key}"`);
      }
      let body = blocks[key];
      const params = parseIncludeParams(paramStr);
      if (body.includes('{id}')) {
        if (!params.id) throw new IncludeError(`@include "${key}" requires an id="…" parameter`);
        body = body.split('{id}').join(params.id);
      }
      if (params.bold) body = boldMatchingLine(body, params.bold, key);
      if (params.active) body = activateMatchingItem(body, params.active, key);
      return body;
    }
  );
}

// ── Tracked include resolution (segment map for the editor) ──────────────────
// resolveIncludesTracked mirrors resolveIncludes but ALSO returns an ordered
// segment map describing where each range of the resolved buffer came from. It
// is used ONLY by the editor path; the reading view keeps using resolveIncludes
// above (untouched). Behavioral invariant (asserted by unit tests):
//   resolveIncludesTracked(content, index, meta).resolved === resolveIncludes(content, bodies)
//
// Each segment covers a contiguous buffer range [bufFrom, bufTo) and is split
// into `pieces`, alternating editable / read-only:
//   - editable piece: buffer text is VERBATIM from the source file, i.e.
//       buffer.slice(bufFrom,bufTo) === sourceFile.slice(srcFrom,srcTo)
//   - read-only piece: a parameter-driven substitution ({id}) or insertion
//       (`**` from bold=, ` active` from active=) — NEVER written back to source.
// `readonlySpans` lists the buffer ranges of the read-only pieces (client aid).
// `additiveOffset` (sourceOffset = bufPos + additiveOffset) is set only when the
// segment is a single editable piece (session text, param-free shared blocks);
// otherwise it is null and callers must use `pieces`.
//
// The read-only classification means the content a user CAN edit inside a shared
// block exists verbatim in the shared source, so additive-offset mapping and the
// content-anchoring commit path stay exact with no reverse transform on write.

// Split editable 'src' pieces on `{id}`, substituting the id value. The `{id}`
// token maps to a read-only piece; the surrounding text stays verbatim.
function pieceSubstituteId(pieces, idValue) {
  const out = [];
  for (const p of pieces) {
    if (!p.editable) { out.push(p); continue; }
    const text = p.text;
    let last = 0;
    let at;
    while ((at = text.indexOf('{id}', last)) !== -1) {
      if (at > last) out.push({ text: text.slice(last, at), srcFrom: p.srcFrom + last, srcTo: p.srcFrom + at, editable: true });
      out.push({ text: idValue, srcFrom: p.srcFrom + at, srcTo: p.srcFrom + at + 4, editable: false, reason: 'id' });
      last = at + 4; // '{id}'.length
    }
    if (last < text.length) out.push({ text: text.slice(last), srcFrom: p.srcFrom + last, srcTo: p.srcTo, editable: true });
    else if (text.length === 0) out.push(p);
  }
  return out;
}

// Insertion points for bold= expressed as flat (whole-block) offsets, mirroring
// boldMatchingLine's three cases exactly. Returns [{flat, text:'**', reason}].
function computeBoldInsertions(text, target, key) {
  const lines = text.split('\n');
  const starts = [];
  let acc = 0;
  for (const l of lines) { starts.push(acc); acc += l.length + 1; }
  const parsed = lines.map(line => {
    const mm = line.match(/^(\s*>\s*)?([\s\S]*?)(\s*)$/);
    return { prefix: mm[1] || '', text: mm[2], trailing: mm[3] || '' };
  });
  const norm = s => s.replace(/\s+/g, ' ').trim();
  const tgt = norm(target);
  // (1)/(2) a contiguous run of full lines whose joined visible text equals target
  for (let s = 0; s < parsed.length; s++) {
    if (!parsed[s].text) continue;
    let joined = '';
    for (let e = s; e < parsed.length; e++) {
      if (!parsed[e].text) break;
      joined = joined ? `${joined} ${norm(parsed[e].text)}` : norm(parsed[e].text);
      if (joined === tgt) {
        const ins = [];
        for (let i = s; i <= e; i++) {
          const open = starts[i] + parsed[i].prefix.length;
          ins.push({ flat: open, text: '**', reason: 'bold' });
          ins.push({ flat: open + parsed[i].text.length, text: '**', reason: 'bold' });
        }
        return ins;
      }
      if (!tgt.startsWith(joined)) break;
    }
  }
  // (3) partial substring inside a single line
  for (let i = 0; i < parsed.length; i++) {
    const p = parsed[i];
    if (p.text && p.text.includes(target)) {
      const base = starts[i] + p.prefix.length + p.text.indexOf(target);
      return [
        { flat: base, text: '**', reason: 'bold' },
        { flat: base + target.length, text: '**', reason: 'bold' },
      ];
    }
  }
  throw new IncludeError(`@include "${key}": bold="${target}" matched no line(s) in the block`);
}

// Insertion point for active= (mirrors activateMatchingItem). Returns [] when the
// matched item is already active, or throws when no item label matches.
function computeActiveInsertion(text, target, key) {
  const re = /<Item\b([^>]*)>/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const attrs = m[1];
    const lm = attrs.match(/label="([^"]*)"/);
    if (lm && lm[1] === target) {
      if (/\bactive\b/.test(attrs)) return [];
      return [{ flat: m.index + 5 + attrs.length, text: ' active', reason: 'active' }];
    }
  }
  throw new IncludeError(`@include "${key}": active="${target}" matched no <Item label> in the block`);
}

// Apply flat-offset insertions to a piece list, splitting editable pieces as
// needed and emitting read-only 'ins' pieces (zero-width in source).
function pieceApplyInsertions(pieces, insertions) {
  if (!insertions.length) return pieces;
  const sorted = insertions.slice().sort((a, b) => a.flat - b.flat);
  const sliceEditable = (p, a, b) => ({ text: p.text.slice(a, b), srcFrom: p.srcFrom + a, srcTo: p.srcFrom + b, editable: true });
  const insPiece = (ins, srcPoint) => ({ text: ins.text, srcFrom: srcPoint, srcTo: srcPoint, editable: false, reason: ins.reason });
  const out = [];
  let flat = 0;
  let ii = 0;
  for (const p of pieces) {
    const pStart = flat;
    const pEnd = flat + p.text.length;
    // Insertions landing before/at this piece's start (zero-width, at its start).
    while (ii < sorted.length && sorted[ii].flat <= pStart) {
      out.push(insPiece(sorted[ii], p.srcFrom));
      ii++;
    }
    if (!p.editable) {
      // Read-only pieces ({id} substitutions) are passed through unchanged. bold=
      // and active= never target inside them; guard against an unexpected interior hit.
      if (ii < sorted.length && sorted[ii].flat < pEnd) {
        throw new IncludeError('include tracking: insertion inside a read-only span (unexpected)');
      }
      out.push(p);
      flat = pEnd;
      continue;
    }
    // Editable piece: split at each interior insertion, keeping halves verbatim.
    let cursor = 0;
    while (ii < sorted.length && sorted[ii].flat < pEnd) {
      const within = sorted[ii].flat - pStart;
      if (within > cursor) out.push(sliceEditable(p, cursor, within));
      out.push(insPiece(sorted[ii], p.srcFrom + within));
      cursor = within;
      ii++;
    }
    if (cursor < p.text.length) out.push(sliceEditable(p, cursor, p.text.length));
    else if (p.text.length === 0) out.push(p);
    flat = pEnd;
  }
  while (ii < sorted.length) { // trailing insertions at/after end of block
    const lastSrc = out.length ? out[out.length - 1].srcTo : 0;
    out.push(insPiece(sorted[ii], lastSrc));
    ii++;
  }
  return out;
}

// Resolve one block body with its params into { text, pieces } in body-local
// coordinates. Applies id → bold → active in the SAME order as resolveIncludes.
function resolveBlockPieces(body, key, params) {
  let pieces = [{ text: body, srcFrom: 0, srcTo: body.length, editable: true }];
  if (body.includes('{id}')) {
    if (!params.id) throw new IncludeError(`@include "${key}" requires an id="…" parameter`);
    pieces = pieceSubstituteId(pieces, params.id);
  }
  if (params.bold) {
    pieces = pieceApplyInsertions(pieces, computeBoldInsertions(pieces.map(p => p.text).join(''), params.bold, key));
  }
  if (params.active) {
    const ins = computeActiveInsertion(pieces.map(p => p.text).join(''), params.active, key);
    if (ins.length) pieces = pieceApplyInsertions(pieces, ins);
  }
  return { text: pieces.map(p => p.text).join(''), pieces };
}

// blockIndex: { key: { body, sourceFile, sourceSha, level, srcFrom } }
//   srcFrom = offset of `body` within its common source file.
// sessionMeta (optional): { sourceFile, sourceSha } for the session file itself.
function resolveIncludesTracked(content, blockIndex, sessionMeta) {
  sessionMeta = sessionMeta || {};
  const sessionFile = sessionMeta.sourceFile || null;
  const sessionSha = sessionMeta.sourceSha || null;
  const segments = [];
  let buf = '';
  let bufLen = 0;
  let srcPos = 0;

  function pushSessionSegment(fromSrc, toSrc) {
    if (toSrc <= fromSrc) return;
    const text = content.slice(fromSrc, toSrc);
    const bufFrom = bufLen;
    const bufTo = bufLen + text.length;
    segments.push({
      bufFrom, bufTo,
      kind: 'session',
      sourceFile: sessionFile,
      sourceSha: sessionSha,
      level: null,
      key: null,
      includeDirective: null,
      additiveOffset: fromSrc - bufFrom,
      pieces: [{ bufFrom, bufTo, srcFrom: fromSrc, srcTo: toSrc, editable: true }],
      readonlySpans: [],
    });
    buf += text;
    bufLen = bufTo;
  }

  const re = /<!--\s*@include:\s*([A-Za-z][A-Za-z0-9_-]*)\s*(.*?)\s*-->/g;
  let m;
  while ((m = re.exec(content)) !== null) {
    const full = m[0], key = m[1], paramStr = m[2];
    pushSessionSegment(srcPos, m.index);

    const block = blockIndex && blockIndex[key];
    if (!block) throw new IncludeError(`@include references undefined key "${key}"`);
    const params = parseIncludeParams(paramStr);
    const { text, pieces } = resolveBlockPieces(block.body, key, params);

    const segBufFrom = bufLen;
    const absPieces = [];
    const readonlySpans = [];
    let cum = 0;
    for (const p of pieces) {
      const pbFrom = segBufFrom + cum;
      const pbTo = pbFrom + p.text.length;
      const abs = {
        bufFrom: pbFrom, bufTo: pbTo,
        srcFrom: block.srcFrom + p.srcFrom,
        srcTo: block.srcFrom + p.srcTo,
        editable: p.editable,
      };
      if (!p.editable) {
        abs.reason = p.reason;
        readonlySpans.push({ bufFrom: pbFrom, bufTo: pbTo, reason: p.reason });
      }
      absPieces.push(abs);
      cum += p.text.length;
    }
    const segBufTo = segBufFrom + text.length;
    const singleEditable = absPieces.length === 1 && absPieces[0].editable;
    segments.push({
      bufFrom: segBufFrom, bufTo: segBufTo,
      kind: 'shared',
      sourceFile: block.sourceFile,
      sourceSha: block.sourceSha,
      level: block.level || null,
      key,
      includeDirective: { text: full, srcFrom: m.index, srcTo: m.index + full.length },
      additiveOffset: singleEditable ? (absPieces[0].srcFrom - absPieces[0].bufFrom) : null,
      pieces: absPieces,
      readonlySpans,
    });
    buf += text;
    bufLen = segBufTo;
    srcPos = m.index + full.length;
  }
  pushSessionSegment(srcPos, content.length);

  return { resolved: buf, segments };
}

// Pre-process custom syntax in raw markdown BEFORE markdown-it sees it.
// This is the most reliable approach since markdown-it's HTML parser
// interferes with custom tags like <Question> and <Callout>.

function preprocess(raw, options = {}) {
  let text = raw;

  // ── Question blocks ──
  // <Question id=TheCallSes1-Q1>text</Question>
  // → placeholder div that markdown-it will pass through as html_block
  text = text.replace(
    /<Question\s+id="?([^">]+)"?>([\s\S]*?)<\/Question>/g,
    (_, id, content) => {
      const inner = content.trim();
      // If the content is a heading (e.g., "###### Record Your Thoughts Below"),
      // render it as a heading element instead of wrapping in <p>
      const headingMatch = inner.match(/^(#{1,6})\s+(.+)$/);
      if (headingMatch) {
        const level = headingMatch[1].length;
        return `\n<div class="question-block" data-question-id="${id.trim()}"><h${level}>${headingMatch[2]}</h${level}></div>\n`;
      }
      return `\n<div class="question-block" data-question-id="${id.trim()}"><p>${inner}</p></div>\n`;
    }
  );

  // ── Callout → keep inline as plain text, mark for pullquote duplication ──
  // The callout text stays in the paragraph as-is (no special inline styling).
  // A hidden marker is inserted so post-processing can add a pullquote block after the paragraph.
  text = text.replace(
    /<Callout>([\s\S]*?)<\/Callout>/g,
    (_, content) => `${content}<!--PULLQUOTE:${content.trim()}:ENDPULLQUOTE-->`
  );

  // ── ChapterNum → styled inline section number ──
  // <ChapterNum>1</ChapterNum> → <span class="chapter-num">1</span>
  text = text.replace(
    /<ChapterNum>([\s\S]*?)<\/ChapterNum>/g,
    (_, content) => `<span class="chapter-num">${content.trim()}</span>`
  );

  // ── Accent → inline span in the book's accent color (from meta.json "accent") ──
  // <Accent>text</Accent> → <span class="accent" style="color:…">text</span>
  // Inner markdown (e.g. _italics_) is preserved and rendered normally.
  if (text.indexOf('<Accent>') !== -1) {
    const styleAttr = options.accent ? ` style="color: ${options.accent}"` : '';
    text = text.replace(
      /<Accent>([\s\S]*?)<\/Accent>/g,
      (_, content) => `<span class="accent"${styleAttr}>${content.trim()}</span>`
    );
  }

  // ── Attribution ──
  // << **1 Peter 2:24** → right-aligned div
  text = text.replace(
    /^<<\s*(.+)$/gm,
    (_, content) => `<div class="attribution">${content.trim()}</div>`
  );

  // ── Structural section tags ──
  const structuralTags = ['IntroductionNote', 'ReflectionPrompt', 'DeepDivePrompt', 'ClosingThoughts', 'WrapUpNotes'];
  for (const tag of structuralTags) {
    const pattern = new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, 'g');
    text = text.replace(pattern, (_, content) => {
      const label = tag.replace(/([A-Z])/g, ' $1').trim();
      return `\n<div class="common-content"><div class="section-tag">${label}</div>\n\n${content.trim()}\n\n</div>\n`;
    });
  }

  // ── Bibliography wrapper (hanging indent, no bullets — Chicago style) ──
  // Wraps entries in a scoped div so CSS can render a hanging indent instead of
  // disc bullets. Blank lines around the content let markdown-it render the inner
  // list/paragraphs and italics normally (same pattern as the structural tags above).
  text = text.replace(/<Bibliography>([\s\S]*?)<\/Bibliography>/g, (_, content) => {
    return `\n<div class="bibliography">\n\n${content.trim()}\n\n</div>\n`;
  });

  // ── <image name> tags ──
  const imagesPath = options.imagesPath || '';
  function imageUrl(name) {
    if (!imagesPath) return name;
    return '/image/' + encodeURIComponent(imagesPath + '/' + name).replace(/%2F/g, '/');
  }

  text = text.replace(
    /^<image\s+(.+?)>$/gm,
    (_, name) => {
      const imgName = name.trim();
      const src = imageUrl(imgName);
      return `<figure class="session-image"><img src="${src}" alt="${imgName}" loading="lazy"><figcaption>${imgName.replace(/_/g, ' ')}</figcaption></figure>`;
    }
  );

  // ── Infographic blocks ──
  // <Infographic title="…" type="menu|sequence"> intro… <Item icon="…" label="…">body</Item> … </Infographic>
  // Title/intro/labels/bodies are the editable source of truth; rendered as a
  // responsive accent-themed timeline. Icons are Font Awesome solid names
  // (icon="church"); "triquetra" is a custom inline SVG. Inner markdown in the
  // intro/body is rendered in the post-process inline pass.
  if (text.indexOf('<Infographic') !== -1) {
    const TRIQUETRA = '<svg class="info-tri" viewBox="0 0 64 64" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="4"><circle cx="32" cy="23" r="13"/><circle cx="22" cy="41" r="13"/><circle cx="42" cy="41" r="13"/></svg>';
    const iconMarkup = (name) => {
      if (!name) return '';
      if (name === 'triquetra') return TRIQUETRA;
      return `<i class="fa-solid fa-${name}" aria-hidden="true"></i>`;
    };
    // Story-arc glyph for sequence infographics: a plot mountain (base → rise →
    // climax → fall → resolution) with the current stage's node filled.
    // Story-arc glyph: a plot mountain with a flat base-left, symmetric slopes to
    // a single apex, and short horizontal stubs at each base — small hollow nodes,
    // with the current stage's node filled (line masked inside each node).
    const ARC_PTS = [[16, 46], [30, 46], [45, 29], [55, 15], [70, 29], [84, 46]];
    const storyArc = (active) => {
      let d = 'M4,46 H16';
      for (let i = 1; i < ARC_PTS.length; i++) d += ` L${ARC_PTS[i][0]},${ARC_PTS[i][1]}`;
      d += ' H96';
      const circles = ARC_PTS.map((p, i) =>
        `<circle cx="${p[0]}" cy="${p[1]}" r="4.5" fill="${i === active - 1 ? 'currentColor' : 'var(--accent, #8D4449)'}"/>`
      ).join('');
      return `<svg class="info-arc" viewBox="0 0 100 56" width="54" height="30" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="${d}"/>${circles}</svg>`;
    };
    text = text.replace(/<Infographic([^>]*)>([\s\S]*?)<\/Infographic>/g, (_, attrs, inner) => {
      const title = (attrs.match(/title="([^"]*)"/) || [])[1] || '';
      const type = (attrs.match(/type="([^"]*)"/) || [])[1] || 'menu';
      const firstItem = inner.search(/<Item\b/);
      // Intro: break after the first sentence so the second always starts a new line.
      const intro = (firstItem >= 0 ? inner.slice(0, firstItem) : inner).trim().replace(/\.\s+/, '.<br>');
      const itemPat = /<Item([^>]*)>([\s\S]*?)<\/Item>/g;
      const items = [];
      let im, n = 0;
      while ((im = itemPat.exec(inner)) !== null) {
        n++;
        const ia = im[1];
        const icon = (ia.match(/icon="([^"]*)"/) || [])[1] || '';
        const label = (ia.match(/label="([^"]*)"/) || [])[1] || '';
        const active = /\bactive\b/.test(ia);
        const body = im[2].trim();
        const marker = type === 'sequence'
          ? storyArc(n)
          : iconMarkup(icon);
        items.push(
          `<li class="info-item${active ? ' info-item--active' : ''}"><span class="info-marker">${marker}</span>` +
          `<span class="info-text"><span class="info-label">${label}</span>` +
          `<span class="info-body">${body}</span></span></li>`
        );
      }
      return `\n<div class="infographic infographic--${type}">` +
        (title ? `<div class="info-title">${title}</div>` : '') +
        (intro ? `<div class="info-intro">${intro}</div>` : '') +
        `<ul class="info-items">${items.join('')}</ul></div>\n`;
    });
  }

  // ── Standard markdown images ![alt](name "optional caption") — convert to <img>.
  // An optional title becomes the <figcaption> (may contain <br> for multi-line
  // credits); alt stays the accessible short text. Only [ \t] before EOL (not \s)
  // so the blank line after the image is preserved — otherwise the following
  // paragraph gets absorbed into this figure's HTML block by markdown-it. Output
  // is wrapped in blank lines for safe block separation.
  text = text.replace(
    /^!\[([^\]]*)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)[ \t]*$/gm,
    (_, alt, name, title) => {
      const imgName = name.trim();
      const src = imageUrl(imgName);
      const caption = (title && title.trim()) || alt || imgName.replace(/_/g, ' ');
      const altText = (alt || imgName.replace(/_/g, ' ')).replace(/<br\s*\/?>/gi, ' ').trim();
      return `\n<figure class="session-image"><img src="${src}" alt="${altText}" loading="lazy"><figcaption>${caption}</figcaption></figure>\n`;
    }
  );

  // ── Ensure <br> tags don't swallow adjacent markdown ──
  // markdown-it treats inline HTML followed by markdown as one HTML block.
  // Add blank lines around <br> tags so headings/lists after them parse correctly.
  text = text.replace(/^(<br\s*\/?>)\s*$/gm, '\n$1\n');

  return text;
}

// ── Scripture references ──────────────────────────────────────────────────
// What links is decided by the shared parser (@noble-collective/userdata/scripture, vendored in
// src/vendor/scripture.cjs; Collective-Shared ARCHITECTURE §9c), run on the session MARKDOWN the
// way the mobile app and Collective-Shared scripts/scripture-audit read it: each paragraph on its
// own, with the whole session's book context. Rendering then mustn't move the references, so each
// one is wrapped in private-use marks before markdown-it ("\uE000" + its index in \uE010–\uE019
// digits … "\uE001") and the marks become <a class="bible-ref"> links after it. The marks behave
// like letters to markdown-it (not punctuation or space), so emphasis and smart quotes around a
// reference render exactly as before.
const SCRIPTURE_OPEN = '\uE000';
const SCRIPTURE_CLOSE = '\uE001';
const SCRIPTURE_MARK = /\uE000[\uE010-\uE019]*|\uE001/g;
const PARAGRAPH = /[^\n]+(?:\n(?!\s*\n)[^\n]+)*/g;

function markScriptureReferences(text) {
  text = text.replace(/[\uE000-\uE01F]/g, '');
  const context = scripture.bookContext(text);
  const refs = [];
  for (const p of text.matchAll(PARAGRAPH)) {
    for (const r of scripture.findReferences(p[0], { context, contextOffset: p.index })) {
      refs.push({ ...r, start: r.start + p.index, end: r.end + p.index });
    }
  }
  let out = '';
  let at = 0;
  refs.forEach((r, i) => {
    const index = String(i).replace(/\d/g, (d) => String.fromCharCode(0xE010 + +d));
    out += text.slice(at, r.start) + SCRIPTURE_OPEN + index + text.slice(r.start, r.end) + SCRIPTURE_CLOSE;
    at = r.end;
  });
  return { text: out + text.slice(at), refs };
}

const escapeAttr = (s) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

// data-ref is "Book spec" with the shared parser's normal-form spec ("John 3:16-18,20",
// "Genesis 1-50"); /api/verses resolves it. A mark inside a tag or a comment (an image's alt text)
// is dropped, and so is one inside an existing link (no nested <a>).
function linkScriptureReferences(html, refs) {
  const stack = [];
  let inLink = 0;
  return html.replace(/<!--[\s\S]*?-->|<[^>]*>|\uE000([\uE010-\uE019]+)|\uE001/g, (m, digits) => {
    if (m[0] === '<') {
      if (/^<a[\s>]/i.test(m)) inLink++;
      else if (/^<\/a\s*>/i.test(m)) inLink = Math.max(0, inLink - 1);
      return m.replace(SCRIPTURE_MARK, '');
    }
    if (m === SCRIPTURE_CLOSE) return stack.pop() ? '</a>' : '';
    const r = refs[+digits.replace(/./g, (c) => c.charCodeAt(0) - 0xE010)];
    if (!r || inLink) {
      stack.push(false);
      return '';
    }
    stack.push(true);
    const shown = r.implied || r.continuation ? `${r.book} ${r.text}` : r.text;
    return `<a class="bible-ref" href="#" data-ref="${escapeAttr(`${r.book} ${r.spec}`)}" title="${escapeAttr(shown)}">`;
  });
}

function createRenderer(options = {}) {
  const headingColors = options.color || {};
  const maxNavHeadingLevel = options.maxNavHeadingLevel || 2;
  const slugCounts = {};

  const md = new MarkdownIt({
    html: true,
    breaks: false,
    linkify: true,
    typographer: true,
  });

  md.use(footnotePlugin);

  // ── Heading colors + id slugs from meta.json ──
  const defaultOpen = md.renderer.rules.heading_open;
  md.renderer.rules.heading_open = function (tokens, idx, opts, env, self) {
    const token = tokens[idx];
    const level = token.tag;
    const mdLevel = '#'.repeat(parseInt(level.charAt(1)));
    const color = headingColors[mdLevel];
    if (color && color !== '#000000') {
      token.attrSet('style', `color: ${color}`);
    }
    // Add id slug to headings for anchor linking (h2 through maxNavHeadingLevel)
    const levelNum = parseInt(level.charAt(1));
    if (levelNum >= 2 && levelNum <= maxNavHeadingLevel) {
      const contentToken = tokens[idx + 1];
      if (contentToken && contentToken.content) {
        // Scripture marks aren't heading text: the slug must match extractHeadings' (index.js).
        let slug = contentToken.content.replace(SCRIPTURE_MARK, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
        // Deduplicate slugs
        if (slugCounts[slug]) {
          slugCounts[slug]++;
          slug = slug + '-' + slugCounts[slug];
        } else {
          slugCounts[slug] = 1;
        }
        token.attrSet('id', slug);
      }
    }
    if (defaultOpen) return defaultOpen(tokens, idx, opts, env, self);
    return self.renderToken(tokens, idx, opts);
  };

  return md;
}

function renderMarkdown(content, options = {}) {
  if (options.includeBlocks) content = resolveIncludes(content, options.includeBlocks);
  const marked = markScriptureReferences(content);
  const processed = preprocess(marked.text, options);
  const md = createRenderer(options);
  let html = md.render(processed);

  // Post-process: render inline markdown inside question blocks and attributions
  // The preprocess step left raw markdown (like **bold**) inside HTML blocks.
  // markdown-it with html:true will pass HTML blocks through without processing
  // inline markdown inside them. We need a second pass for these.
  const inlineMd = new MarkdownIt({ html: true, typographer: true });

  // Process question blocks
  html = html.replace(
    /(<div class="question-block"[^>]*><p>)([\s\S]*?)(<\/p><\/div>)/g,
    (_, open, inner, close) => {
      const rendered = inlineMd.renderInline(inner);
      return `${open}${rendered}${close}`;
    }
  );

  // Process attribution blocks
  html = html.replace(
    /(<div class="attribution">)([\s\S]*?)(<\/div>)/g,
    (_, open, inner, close) => {
      const rendered = inlineMd.renderInline(inner);
      return `${open}${rendered}${close}`;
    }
  );

  // Process infographic intro + item bodies (inline markdown left raw in the html block)
  html = html.replace(
    /(<div class="info-intro">)([\s\S]*?)(<\/div>)/g,
    (_, open, inner, close) => `${open}${inlineMd.renderInline(inner)}${close}`
  );
  html = html.replace(
    /(<span class="info-body">)([\s\S]*?)(<\/span>)/g,
    (_, open, inner, close) => `${open}${inlineMd.renderInline(inner)}${close}`
  );

  // Process callout pullquotes — extract markers from paragraphs and
  // insert a pullquote block after the closing </p>
  html = html.replace(
    /(<p>)([\s\S]*?)(<\/p>)/g,
    (match, open, inner, close) => {
      const markers = [];
      const cleaned = inner.replace(
        /<!--PULLQUOTE:([\s\S]*?):ENDPULLQUOTE-->/g,
        (_, text) => { markers.push(text); return ''; }
      );
      if (markers.length === 0) return match;
      const pullquotes = markers.map(text => {
        // A callout pulled from mid-sentence begins lowercase in the manuscript;
        // capitalize the first letter for the standalone pullquote display only
        // (the inline text and the source file are left unchanged).
        const display = text.replace(/^([_*"'“‘([]*)([a-z])/, (_, pre, ch) => pre + ch.toUpperCase());
        return `<aside class="pullquote"><p>${inlineMd.renderInline(display)}</p></aside>`;
      }).join('');
      return `${open}${cleaned}${close}\n${pullquotes}`;
    }
  );

  // Sub-paragraph indentation: paragraphs starting with a bold number
  // (e.g. **2** Some text...) get a class for first-line text-indent.
  html = html.replace(
    /<p><strong>(\d{1,2})<\/strong>/g,
    '<p class="sub-para"><strong>$1</strong>'
  );

  // Scripture references found on the markdown (markScriptureReferences) become links.
  html = linkScriptureReferences(html, marked.refs);

  // Merge 1-cell heading tables with the body table that follows.
  // Pattern: <table> with a single <th> immediately followed by another <table>.
  // The heading cell becomes a colspan row at the top of the body table.
  html = html.replace(
    /<table>\s*<thead>\s*<tr>\s*<th[^>]*>([\s\S]*?)<\/th>\s*<\/tr>\s*<\/thead>\s*<\/table>\s*(<table>[\s\S]*?<\/table>)/g,
    (match, headingText, bodyTable) => {
      // Count columns from the body table's first <tr>
      const firstRow = bodyTable.match(/<tr>([\s\S]*?)<\/tr>/);
      const colCount = firstRow ? (firstRow[1].match(/<t[hd][^>]*>/g) || []).length : 2;
      return bodyTable.replace(
        /<table>\s*<thead>/,
        `<table>\n<thead><tr><th colspan="${colCount}" class="table-heading-row">${headingText}</th></tr>`
      );
    }
  );

  // Remove the empty header row from the merged body table (the row with empty <th> cells
  // that was the original body table's header). It's now redundant since we added the heading row.
  html = html.replace(
    /(class="table-heading-row"[^>]*>[\s\S]*?<\/th><\/tr>)\s*\n?\s*<tr>\s*(\s*<th[^>]*>\s*<\/th>\s*)+<\/tr>\s*\n?\s*<\/thead>/g,
    '$1\n</thead>'
  );

  // Tag the Planning Calendar table (identified by its "Biblical Passage" header)
  // so CSS can fix its column widths — otherwise the wide passage cell starves the
  // empty Teacher/Date columns.
  html = html.replace(
    /<table>(\s*<thead>\s*<tr>\s*<th[^>]*>Biblical Passage<\/th>)/g,
    '<table class="pc-table">$1'
  );

  // Tag the Opening's Core Content table (identified by its "Session" + "Focus" headers)
  // so CSS gives the Session column real width instead of letting it collapse to content.
  html = html.replace(
    /<table>(\s*<thead>\s*<tr>\s*<th[^>]*>Session<\/th>\s*<th[^>]*>Focus<\/th>)/g,
    '<table class="cc-table">$1'
  );

  // Tag the Recall's Learning Plan tables (Session + Topic headers — Selected Passages /
  // Recommended Reading) so CSS can keep the "Session N" label from wrapping.
  html = html.replace(
    /<table>(\s*<thead>\s*<tr>\s*<th[^>]*>Session<\/th>\s*<th[^>]*>Topic<\/th>)/g,
    '<table class="lp-table">$1'
  );

  // Tag the Further Resources reading-plan tables (first header "Week N") for fixed
  // equal column widths, then wrap each in a scroll container so it can scroll
  // horizontally on narrow (phone) screens instead of crushing the columns.
  html = html.replace(
    /<table>(\s*<thead>\s*<tr>\s*<th[^>]*>Week \d+<\/th>)/g,
    '<table class="rp-table">$1'
  );
  html = html.replace(
    /<table class="rp-table">([\s\S]*?)<\/table>/g,
    '<div class="rp-scroll"><table class="rp-table">$1</table></div>'
  );

  // External links (autolinked URLs + explicit http(s) links) open in a new tab.
  html = html.replace(
    /<a href="(https?:\/\/[^"]*)"/g,
    '<a href="$1" target="_blank" rel="noopener noreferrer"'
  );

  return html;
}

function renderCommonContent(parts) {
  if (!parts || parts.length === 0) return '';
  return parts.map(part => renderMarkdown(part)).join('');
}

module.exports = { renderMarkdown, renderCommonContent, createRenderer, resolveIncludes, resolveIncludesTracked, IncludeError };
