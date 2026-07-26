const MarkdownIt = require('markdown-it');
const footnotePlugin = require('markdown-it-footnote');

// ── Common-content includes ──────────────────────────────────────────────
// Resolves `<!-- @include: KeyName param="value" -->` directives against a
// { KeyName: content } map gathered from the book/subseries/series common files.
// Supports three parameters:
//   id="…"     — substitutes every {id} token in the block (unique ids for shared questions)
//   bold="…"   — bolds the single line in the block whose visible text matches exactly
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
  let found = false;
  const out = body.split('\n').map(line => {
    const m = line.match(/^(\s*>\s*)?([\s\S]*?)(\s*)$/);
    const prefix = m[1] || '', text = m[2], trailing = m[3] || '';
    if (text === target) { found = true; return `${prefix}**${text}**${trailing}`; }
    return line;
  });
  if (!found) throw new IncludeError(`@include "${key}": bold="${target}" matched no line in the block`);
  return out.join('\n');
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
    /<!--\s*@include:\s*([A-Za-z][A-Za-z0-9]*)\s*(.*?)\s*-->/g,
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

  // ── Standard markdown images ![alt](name) — convert to <img> with proxy URL ──
  text = text.replace(
    /^!\[([^\]]*)\]\(([^)]+)\)\s*$/gm,
    (_, alt, name) => {
      const imgName = name.trim();
      const src = imageUrl(imgName);
      const caption = alt || imgName.replace(/_/g, ' ');
      return `<figure class="session-image"><img src="${src}" alt="${caption}" loading="lazy"><figcaption>${caption}</figcaption></figure>`;
    }
  );

  // ── Ensure <br> tags don't swallow adjacent markdown ──
  // markdown-it treats inline HTML followed by markdown as one HTML block.
  // Add blank lines around <br> tags so headings/lists after them parse correctly.
  text = text.replace(/^(<br\s*\/?>)\s*$/gm, '\n$1\n');

  return text;
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
        let slug = contentToken.content.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
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
  const processed = preprocess(content, options);
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
      const pullquotes = markers.map(text =>
        `<aside class="pullquote"><p>${inlineMd.renderInline(text)}</p></aside>`
      ).join('');
      return `${open}${cleaned}${close}\n${pullquotes}`;
    }
  );

  // Sub-paragraph indentation: paragraphs starting with a bold number
  // (e.g. **2** Some text...) get a class for first-line text-indent.
  html = html.replace(
    /<p><strong>(\d{1,2})<\/strong>/g,
    '<p class="sub-para"><strong>$1</strong>'
  );

  // Detect Bible references and wrap in clickable links.
  // Tracks "current book" context so shorthand refs like (2:1) get expanded
  // to full refs like "Acts 2:1" based on the nearest preceding full citation.

  // Known Bible book names
  const BIBLE_BOOKS = [
    'Genesis', 'Exodus', 'Leviticus', 'Numbers', 'Deuteronomy',
    'Joshua', 'Judges', 'Ruth', '1 Samuel', '2 Samuel',
    '1 Kings', '2 Kings', '1 Chronicles', '2 Chronicles',
    'Ezra', 'Nehemiah', 'Esther', 'Job', 'Psalm', 'Psalms', 'Proverbs',
    'Ecclesiastes', 'Song of Solomon', 'Isaiah', 'Jeremiah',
    'Lamentations', 'Ezekiel', 'Daniel', 'Hosea', 'Joel', 'Amos',
    'Obadiah', 'Jonah', 'Micah', 'Nahum', 'Habakkuk', 'Zephaniah',
    'Haggai', 'Zechariah', 'Malachi',
    'Matthew', 'Mark', 'Luke', 'John', 'Acts', 'Romans',
    '1 Corinthians', '2 Corinthians', 'Galatians', 'Ephesians',
    'Philippians', 'Colossians', '1 Thessalonians', '2 Thessalonians',
    '1 Timothy', '2 Timothy', 'Titus', 'Philemon', 'Hebrews',
    'James', '1 Peter', '2 Peter', '1 John', '2 John', '3 John',
    'Jude', 'Revelation',
  ];
  // Build regex from known names (longest first to avoid partial matches)
  const bookNamePat = BIBLE_BOOKS.sort((a, b) => b.length - a.length)
    .map(b => b.replace(/\s/g, '\\s')).join('|');
  // Verse spec: "15:1-19:38" or "2:1-47" or "2:23, 25-31, 33-35"
  // Cross-chapter range: \d+:\d+ optionally followed by –\d+:\d+ or –\d+
  const verseSpecPat = '\\d+:\\d+(?:[–\\-]\\d+:\\d+|[–\\-]\\d+)?(?:,\\s?\\d+(?:[–\\-]\\d+)?)*';
  const fullRefPat = new RegExp(`(${bookNamePat})\\s(${verseSpecPat})`, 'g');
  // Shorthand refs inside parens — handles semicolons, cf., cross-chapter ranges
  const shorthandVerseSpec = '\\d+:\\d+(?:[–\\-]\\d+:\\d+|[–\\-]\\d+)?(?:,\\s?\\d+(?:[–\\-]\\d+)?)*';
  const shorthandPat = new RegExp(`\\(((?:cf\\.\\s?)?(?:${shorthandVerseSpec})(?:;\\s?(?:cf\\.\\s?)?(?:${shorthandVerseSpec}))*)\\)`, 'g');

  // First pass: find all full references to build a context map.
  // Section declarations ("Biblical Narrative (Book Ch:V)") are authoritative.
  // Inline refs only update context when no section declaration is active.
  const bookAtPosition = []; // [{pos, book, isSection}]

  // Look for "Biblical Narrative (Book Ch:V)" pattern — the section declarations
  const sectionDeclPat = new RegExp(`Biblical Narrative \\((${bookNamePat})\\s${verseSpecPat}`, 'g');
  let sd;
  while ((sd = sectionDeclPat.exec(html)) !== null) {
    bookAtPosition.push({ pos: sd.index, book: sd[1], isSection: true });
  }
  const hasSectionDecls = bookAtPosition.length > 0;

  // Also track from standalone full references (not cf., not compound)
  let fm;
  fullRefPat.lastIndex = 0;
  while ((fm = fullRefPat.exec(html)) !== null) {
    const before = html.substring(Math.max(0, fm.index - 1), fm.index);
    if (before === '"' || before === '=' || before === '/') continue;
    // Skip if inside an HTML tag
    const afterTag = html.lastIndexOf('<', fm.index);
    const afterClose = html.lastIndexOf('>', fm.index);
    if (afterTag > afterClose) continue;
    // Skip cf. references
    const preceding = html.substring(Math.max(0, fm.index - 5), fm.index);
    if (/cf\.\s?$/.test(preceding)) continue;
    // Skip if preceded by semicolon (part of a compound ref like "; Psalm 16:8-11")
    const precSemicolon = html.substring(Math.max(0, fm.index - 3), fm.index);
    if (/;\s?$/.test(precSemicolon)) continue;
    // If section declarations exist, inline refs don't change context —
    // they're incidental quotes within a declared section
    if (hasSectionDecls) continue;
    // No section declarations (e.g., HomeStead) — inline refs set context
    bookAtPosition.push({ pos: fm.index, book: fm[1], isSection: false });
  }

  function getBookAt(pos) {
    let book = null;
    for (const entry of bookAtPosition) {
      if (entry.pos <= pos) book = entry.book;
      else break;
    }
    return book;
  }

  // Second pass: wrap all references (full and shorthand) in links
  // Process from end to start so positions don't shift

  const replacements = [];

  // Helper: check if position is inside an HTML tag's attribute (not just inside element content)
  function isInsideTagAttribute(pos) {
    const afterTag = html.lastIndexOf('<', pos);
    const afterClose = html.lastIndexOf('>', pos);
    if (afterTag <= afterClose) return false; // We're in element content, not a tag
    // We're between < and > — check if it's an opening/closing tag definition
    const tagContent = html.substring(afterTag, pos);
    // If we see a quote before our position (attribute value), skip
    return /=\s*["'][^"']*$/.test(tagContent) || /^<\/?[a-z]/.test(tagContent) && !/>\s*$/.test(tagContent);
  }

  // Collect full references
  fullRefPat.lastIndex = 0;
  while ((fm = fullRefPat.exec(html)) !== null) {
    if (isInsideTagAttribute(fm.index)) continue; // Inside a tag

    const fullRef = fm[0];
    const fullBook = fm[1];
    replacements.push({
      start: fm.index,
      end: fm.index + fm[0].length,
      original: fm[0],
      ref: fullRef,
    });

    // Also link semicolon-separated chapter:verse continuations that follow the
    // full ref, even when NOT inside parentheses — e.g. "Job 1:6–12; 2:1–6" links
    // "2:1–6" too (same book). Otherwise these are only caught inside parens.
    let tailStart = fm.index + fm[0].length;
    const contPat = /^(;\s?)((?:cf\.\s?)?\d+:\d+(?:[–\-]\d+:\d+|[–\-]\d+)?(?:,\s?\d+(?:[–\-]\d+)?)*)/;
    let cm;
    while ((cm = contPat.exec(html.slice(tailStart))) !== null) {
      const sep = cm[1];
      const verseSpec = cm[2].replace(/^cf\.\s?/, '');
      const segStart = tailStart + sep.length + (cm[2].length - verseSpec.length);
      const segEnd = segStart + verseSpec.length;
      if (!isInsideTagAttribute(segStart)) {
        replacements.push({
          start: segStart,
          end: segEnd,
          original: verseSpec,
          ref: `${fullBook} ${verseSpec}`,
        });
      }
      tailStart = segEnd;
    }
  }

  // Collect shorthand references — split on semicolons inside parens
  let sm;
  while ((sm = shorthandPat.exec(html)) !== null) {
    const book = getBookAt(sm.index);
    if (!book) continue;

    if (isInsideTagAttribute(sm.index)) continue;

    // The full match is everything inside parens. Split on semicolons.
    const innerContent = sm[1];
    const verseRefPat = /(?:cf\.\s?)?(\d+:\d+(?:[–\-]\d+)?(?:,\s?\d+(?:[–\-]\d+)?)*)/g;
    let vm;
    while ((vm = verseRefPat.exec(innerContent)) !== null) {
      const verseSpec = vm[1];
      const fullRef = `${book} ${verseSpec}`;
      // Find position of this verse spec in the original HTML
      const innerStart = sm.index + 1 + vm.index + (vm[0].length - vm[1].length); // +1 for opening paren
      const innerEnd = innerStart + vm[1].length;

      replacements.push({
        start: innerStart,
        end: innerEnd,
        original: vm[1],
        ref: fullRef,
      });
    }
  }

  // Sort by position descending and apply replacements
  replacements.sort((a, b) => b.start - a.start);

  // Deduplicate overlapping replacements (keep the one that starts first)
  const used = new Set();
  for (const r of replacements) {
    let overlap = false;
    for (let p = r.start; p < r.end; p++) {
      if (used.has(p)) { overlap = true; break; }
    }
    if (overlap) continue;
    for (let p = r.start; p < r.end; p++) used.add(p);

    const link = `<a class="bible-ref" href="#" data-ref="${r.ref.replace(/[–]/g, '-').replace(/"/g, '&quot;')}" title="${r.ref}">${r.original}</a>`;
    html = html.substring(0, r.start) + link + html.substring(r.end);
  }

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

  return html;
}

function renderCommonContent(parts) {
  if (!parts || parts.length === 0) return '';
  return parts.map(part => renderMarkdown(part)).join('');
}

module.exports = { renderMarkdown, renderCommonContent, createRenderer, resolveIncludes, IncludeError };
