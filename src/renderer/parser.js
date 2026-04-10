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

  return html;
}

function renderCommonContent(parts) {
  if (!parts || parts.length === 0) return '';
  return parts.map(part => renderMarkdown(part)).join('');
}

module.exports = { renderMarkdown, renderCommonContent, createRenderer };
