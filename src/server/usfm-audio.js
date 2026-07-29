/**
 * usfm-audio.js — CommonJS port of the audiobook repo's src/usfm-to-markdown.js
 * parser, used to RENDER audio-enabled Bible chapters in the exact block structure the
 * audio timestamps were generated from.
 *
 * IMPORTANT: keep this in sync with Noble-Imprint-Audiobooks/src/usfm-to-markdown.js.
 * Both must produce the same per-chapter blocks (section headings + stanza-grouped
 * paragraphs with <sup>N</sup> verse numbers) or the highlight sync will drift. The
 * audio side generates markdown "# {Book} {N}\n\n## heading\n\n<sup>1</sup>…"; here we
 * return the post-H1 blocks (the chapter <h1> is rendered by the template), so the DOM
 * block order matches the timestamps' blockIndex (0 = <h1>, 1 = first section/para, …).
 */

// Strip all USFM markup from an inline segment, keeping readable text. Footnotes/xrefs
// (whose \fr/\ft sub-text must NOT be spoken/shown) are removed as whole spans first.
function cleanInline(raw) {
  let t = raw || '';
  t = t.replace(/\\f\s.*?\\f\*/g, '');   // footnotes \f + \fr … \ft …\f*
  t = t.replace(/\\x\s.*?\\x\*/g, '');   // cross-refs \x … \x*
  t = t.replace(/\\[a-z]+\d*\*/gi, '');  // remaining closing char-style markers \wj* \nd* …
  t = t.replace(/\\[a-z]+\d*\s?/gi, ' '); // remaining opening/standalone markers \p \q1 \add …
  t = t.replace(/¶\s*/g, '');
  return t.replace(/\s+/g, ' ').trim();
}

// Lines that begin a new PROSE paragraph. Poetry \q* is intentionally excluded so
// consecutive poetic lines group into a stanza paragraph; \b is the stanza separator.
const NEW_PARA_RE = /^\\(p|pi\d?|pc|pmo|pmc|pmr|pm|m|mi|nb|b)\b/;

/**
 * Parse a USFM book into ordered per-chapter blocks (no chapter <h1> — the template
 * renders that). Returns { bookName, chapters: [{ num, blocks: [{type,text}] }] }
 * where type is 'h2' (\s1), 'h3' (\s2), or 'p'.
 */
function parseUsfmBook(usfmText) {
  const lines = usfmText.split(/\r?\n/);
  let bookName = '';
  let chapterNum = 0;
  let cur = null;
  const chapters = [];
  let para = '';

  function flushPara() {
    const t = para.trim();
    if (t && cur) cur.blocks.push({ type: 'p', text: t });
    para = '';
  }
  function append(text, label) {
    if (label) para += (para ? ' ' : '') + `<sup>${label}</sup>` + text;
    else if (text) para += (para ? ' ' : '') + text;
  }
  function processContent(line) {
    const parts = line.split(/\\v\s+(\d+(?:[-–]\d+)?)\s*/);
    const leading = cleanInline(parts[0]);
    if (leading) append(leading, null);
    for (let i = 1; i < parts.length; i += 2) append(cleanInline(parts[i + 1] || ''), parts[i]);
  }

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith('\\h ')) { bookName = line.slice(3).trim(); continue; }
    if (line.startsWith('\\c ')) {
      flushPara();
      chapterNum = parseInt(line.slice(3).trim(), 10);
      cur = { num: chapterNum, blocks: [] };
      chapters.push(cur);
      continue;
    }
    if (chapterNum === 0) continue;
    if (/^\\ms\d?\s/.test(line) || line.startsWith('\\mr ')) continue;
    if (line.startsWith('\\s1 ') || line.startsWith('\\s2 ')) {
      flushPara();
      const level = line.startsWith('\\s1') ? 'h2' : 'h3';
      cur.blocks.push({ type: level, text: cleanInline(line.replace(/^\\s[12]\s+/, '')) });
      continue;
    }
    if (line.startsWith('\\r ')) continue;
    if (line.startsWith('\\d ')) {
      flushPara();
      const text = cleanInline(line.slice(3));
      if (text) cur.blocks.push({ type: 'p', text });
      continue;
    }
    if (NEW_PARA_RE.test(line)) flushPara();
    processContent(line);
  }
  flushPara();
  return { bookName, chapters };
}

/** Return the ordered blocks for one chapter, or null if the chapter isn't present. */
function chapterBlocks(usfmText, chapterNum) {
  const { chapters } = parseUsfmBook(usfmText);
  const ch = chapters.find(c => c.num === chapterNum);
  return ch ? ch.blocks : null;
}

module.exports = { parseUsfmBook, chapterBlocks, cleanInline };
