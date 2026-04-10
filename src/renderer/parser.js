const MarkdownIt = require('markdown-it');

// Pre-process custom syntax in raw markdown BEFORE markdown-it sees it.
// This is the most reliable approach since markdown-it's HTML parser
// interferes with custom tags like <Question> and <Callout>.

function preprocess(raw) {
  let text = raw;

  // ── Question blocks ──
  // <Question id=TheCallSes1-Q1>text</Question>
  // → placeholder div that markdown-it will pass through as html_block
  text = text.replace(
    /<Question\s+id=([^>]+)>([\s\S]*?)<\/Question>/g,
    (_, id, content) => {
      // Render inline markdown manually for bold/italic inside questions
      const inner = content.trim();
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
  text = text.replace(
    /^<image\s+(.+?)>$/gm,
    (_, name) => `<div class="image-placeholder">[Image: ${name.trim()}]</div>`
  );

  // ── Ensure <br> tags don't swallow adjacent markdown ──
  // markdown-it treats inline HTML followed by markdown as one HTML block.
  // Add blank lines around <br> tags so headings/lists after them parse correctly.
  text = text.replace(/^(<br\s*\/?>)\s*$/gm, '\n$1\n');

  return text;
}

function createRenderer(options = {}) {
  const headingColors = options.color || {};

  const md = new MarkdownIt({
    html: true,
    breaks: false,
    linkify: true,
    typographer: true,
  });

  // ── Heading colors from meta.json ──
  const defaultOpen = md.renderer.rules.heading_open;
  md.renderer.rules.heading_open = function (tokens, idx, opts, env, self) {
    const token = tokens[idx];
    const level = token.tag;
    const mdLevel = '#'.repeat(parseInt(level.charAt(1)));
    const color = headingColors[mdLevel];
    if (color && color !== '#000000') {
      token.attrSet('style', `color: ${color}`);
    }
    if (defaultOpen) return defaultOpen(tokens, idx, opts, env, self);
    return self.renderToken(tokens, idx, opts);
  };

  return md;
}

function renderMarkdown(content, options = {}) {
  const processed = preprocess(content);
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
  // Only track current book from "Biblical Narrative (Book Ch:V)" section
  // declarations — these set the primary book for the section.
  // Other inline refs (cf., Psalm quotes, etc.) don't change context.
  let currentBook = null;
  const bookAtPosition = []; // [{pos, book}]

  // Look for "Biblical Narrative (Book Ch:V)" pattern — the section declarations
  const sectionDeclPat = new RegExp(`Biblical Narrative \\((${bookNamePat})\\s${verseSpecPat}`, 'g');
  let sd;
  while ((sd = sectionDeclPat.exec(html)) !== null) {
    currentBook = sd[1];
    bookAtPosition.push({ pos: sd.index, book: currentBook });
  }

  // Also track from heading-level full refs and standalone primary citations
  // that are NOT inside parentheses with cf. or semicolons (compound refs)
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
    // Only update context if it's the same book already set, or if no context yet
    // This prevents one-off quotes of other books from hijacking the context
    if (bookAtPosition.length > 0) {
      const lastBook = bookAtPosition[bookAtPosition.length - 1].book;
      if (fm[1] !== lastBook) continue; // Different book — don't update context
    }
    bookAtPosition.push({ pos: fm.index, book: fm[1] });
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
    replacements.push({
      start: fm.index,
      end: fm.index + fm[0].length,
      original: fm[0],
      ref: fullRef,
    });
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

  return html;
}

function renderCommonContent(parts) {
  if (!parts || parts.length === 0) return '';
  return parts.map(part => renderMarkdown(part)).join('');
}

module.exports = { renderMarkdown, renderCommonContent, createRenderer };
