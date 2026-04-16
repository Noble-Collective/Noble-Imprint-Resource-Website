// Noble Imprint — CodeMirror 6 Masking Extension (v2)
// Hides structural markdown/custom syntax, shows formatted text.
//
// Inline syntax (##, **, _, <<, >) is hidden using mark decorations with
// CSS zero-width styling. The text stays in the DOM so the cursor passes
// through smoothly — no jumping, no atomic range issues.
//
// Block-level tags (<Question>, </Question>, <Callout>, etc.) use replace
// decorations so the cursor skips them in one step. These are long strings
// that users should never interact with.
import { Decoration, ViewPlugin, WidgetType, EditorView } from '/static/js/codemirror-bundle.js';

// --- Widget for <br> spacer ---
class BrSpacerWidget extends WidgetType {
  toDOM() {
    const el = document.createElement('div');
    el.className = 'cm-br-spacer';
    el.setAttribute('aria-hidden', 'true');
    return el;
  }
  ignoreEvent() { return true; }
}

// Mode flag: when true, the cursor's line shows raw markdown
let revealFocusedLine = false;

export function setRevealFocusedLine(enabled) {
  revealFocusedLine = enabled;
}

// --- Build decorations by scanning document text ---
function buildMaskingDecorations(view, skipLineNumber) {
  const doc = view.state.doc;
  const text = doc.toString();
  const decorations = [];

  // Determine the focused line range (for direct edit reveal)
  let skipFrom = -1, skipTo = -1;
  if (skipLineNumber !== undefined && skipLineNumber >= 1 && skipLineNumber <= doc.lines) {
    const skipLine = doc.line(skipLineNumber);
    skipFrom = skipLine.from;
    skipTo = skipLine.to;
  }

  function isOnFocusedLine(from, to) {
    return skipFrom >= 0 && from >= skipFrom && to <= skipTo;
  }

  // Helper: hide inline syntax — on focused line, reveal with muted styling instead
  function hideInline(from, to) {
    if (from < to) {
      if (isOnFocusedLine(from, to)) {
        decorations.push(Decoration.mark({ class: 'cm-revealed-syntax' }).range(from, to));
      } else {
        decorations.push(Decoration.mark({ class: 'cm-hidden-syntax' }).range(from, to));
      }
    }
  }

  // Helper: hide block-level tag — on focused line, reveal with muted styling instead
  function hideBlock(from, to) {
    if (from < to) {
      if (isOnFocusedLine(from, to)) {
        decorations.push(Decoration.mark({ class: 'cm-revealed-syntax' }).range(from, to));
      } else {
        decorations.push(Decoration.replace({ inclusive: false }).range(from, to));
      }
    }
  }

  // Helper: add a styled range — ALWAYS applies (styling stays on focused line)
  function mark(from, to, cls) {
    if (from < to) {
      decorations.push(Decoration.mark({ class: cls }).range(from, to));
    }
  }

  // --- Question blocks: <Question id=...>content</Question> ---
  const questionRe = /<Question\s+id=([^>]+)>([\s\S]*?)<\/Question>/g;
  let m;
  while ((m = questionRe.exec(text)) !== null) {
    const fullStart = m.index;
    const fullEnd = fullStart + m[0].length;
    const openTagEnd = fullStart + m[0].indexOf('>') + 1;
    const closeTagStart = fullEnd - '</Question>'.length;

    hideBlock(fullStart, openTagEnd);          // Hide <Question id=...>
    hideBlock(closeTagStart, fullEnd);          // Hide </Question>
    mark(openTagEnd, closeTagStart, 'cm-question-block');
  }

  // --- Callout blocks: <Callout>content</Callout> ---
  const calloutRe = /<Callout>([\s\S]*?)<\/Callout>/g;
  while ((m = calloutRe.exec(text)) !== null) {
    const fullStart = m.index;
    const fullEnd = fullStart + m[0].length;
    const openTagEnd = fullStart + '<Callout>'.length;
    const closeTagStart = fullEnd - '</Callout>'.length;

    hideBlock(fullStart, openTagEnd);
    hideBlock(closeTagStart, fullEnd);
    mark(openTagEnd, closeTagStart, 'cm-callout');
  }

  // --- Structural section tags ---
  const sectionTags = ['IntroductionNote', 'ReflectionPrompt', 'DeepDivePrompt', 'ClosingThoughts', 'WrapUpNotes'];
  for (const tag of sectionTags) {
    const re = new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, 'g');
    while ((m = re.exec(text)) !== null) {
      const fullStart = m.index;
      const fullEnd = fullStart + m[0].length;
      const openTagEnd = fullStart + `<${tag}>`.length;
      const closeTagStart = fullEnd - `</${tag}>`.length;

      hideBlock(fullStart, openTagEnd);
      hideBlock(closeTagStart, fullEnd);
      mark(openTagEnd, closeTagStart, 'cm-section-block');
    }
  }

  // --- Process line by line for headings, attributions, blockquotes, br ---
  for (let i = 1; i <= doc.lines; i++) {
    const line = doc.line(i);
    const lineText = line.text;
    const lineFrom = line.from;

    // Headings: # through #####
    const headingMatch = lineText.match(/^(#{1,5})\s+/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const prefixLen = headingMatch[0].length;
      // Heading markers revealed at the heading's font size, not base size
      if (isOnFocusedLine(lineFrom, lineFrom + prefixLen)) {
        decorations.push(Decoration.mark({ class: 'cm-revealed-syntax cm-heading-' + level }).range(lineFrom, lineFrom + prefixLen));
      } else {
        decorations.push(Decoration.mark({ class: 'cm-hidden-syntax' }).range(lineFrom, lineFrom + prefixLen));
      }
      mark(lineFrom + prefixLen, line.to, 'cm-heading-' + level);
      // Line-level decoration for spacing — CM6 syncs gutter height with .cm-line height
      decorations.push(Decoration.line({ class: 'cm-heading-line-' + level }).range(lineFrom));
      continue;
    }

    // Attribution: << text
    const attrMatch = lineText.match(/^<<\s+/);
    if (attrMatch) {
      const prefixLen = attrMatch[0].length;
      hideInline(lineFrom, lineFrom + prefixLen);
      mark(lineFrom + prefixLen, line.to, 'cm-attribution');
      continue;
    }

    // Blockquote: > text
    const bqMatch = lineText.match(/^>\s*/);
    if (bqMatch && lineText.trim() !== '>') {
      const prefixLen = bqMatch[0].length;
      hideInline(lineFrom, lineFrom + prefixLen);
      mark(lineFrom, line.to, 'cm-blockquote');
      continue;
    }

    // BR tag: <br> or <br/>
    if (/^<br\s*\/?>$/.test(lineText.trim())) {
      decorations.push(
        Decoration.replace({ widget: new BrSpacerWidget() }).range(lineFrom, line.to)
      );
      continue;
    }

    // Image tag: <image name>
    const imageMatch = lineText.match(/^<image\s+(.+?)>$/);
    if (imageMatch) {
      mark(lineFrom, line.to, 'cm-image-placeholder');
      continue;
    }
  }

  // --- Inline: **bold** (not inside tags we already processed) ---
  const boldRe = /\*\*(.+?)\*\*/g;
  while ((m = boldRe.exec(text)) !== null) {
    const fullStart = m.index;
    const fullEnd = fullStart + m[0].length;
    hideInline(fullStart, fullStart + 2);              // Hide opening **
    hideInline(fullEnd - 2, fullEnd);                  // Hide closing **
    mark(fullStart + 2, fullEnd - 2, 'cm-bold');       // Style content
  }

  // --- Inline: _italic_ (single underscore, not inside words) ---
  const italicRe = /(?<![a-zA-Z0-9])_(.+?)_(?![a-zA-Z0-9])/g;
  while ((m = italicRe.exec(text)) !== null) {
    const fullStart = m.index;
    const fullEnd = fullStart + m[0].length;
    hideInline(fullStart, fullStart + 1);              // Hide opening _
    hideInline(fullEnd - 1, fullEnd);                  // Hide closing _
    mark(fullStart + 1, fullEnd - 1, 'cm-italic');     // Style content
  }

  // Sort by position (required by CodeMirror)
  decorations.sort((a, b) => a.from - b.from || a.to - b.to);

  return Decoration.set(decorations, true);
}

// --- ViewPlugin that recomputes decorations on each document/selection change ---
const maskingPlugin = ViewPlugin.fromClass(
  class {
    constructor(view) {
      this._lastCursorLine = 0;
      this.decorations = buildMaskingDecorations(view, this._getSkipLine(view));
    }
    _getSkipLine(view) {
      if (!revealFocusedLine) return undefined;
      const pos = view.state.selection.main.head;
      return view.state.doc.lineAt(pos).number;
    }
    update(update) {
      const cursorLine = this._getSkipLine(update.view);
      const lineChanged = cursorLine !== this._lastCursorLine;
      if (update.docChanged || update.viewportChanged || lineChanged) {
        this._lastCursorLine = cursorLine;
        this.decorations = buildMaskingDecorations(update.view, cursorLine);
      }
    }
  },
  {
    decorations: (v) => v.decorations,
  }
);

// --- Theme: visual styles matching the reading view ---
const maskingTheme = EditorView.theme({
  // Editor base
  '&': {
    fontSize: '17px',
  },
  '.cm-content': {
    fontFamily: "'Lora', Georgia, serif",
    lineHeight: '1.8',
    padding: '24px 0',
    maxWidth: '680px',
  },
  '.cm-line': {
    padding: '0 24px',
  },
  '.cm-gutters': {
    background: 'transparent',
    borderRight: '1px solid #eee',
    color: '#ccc',
    fontSize: '11px',
    fontFamily: "'DM Sans', sans-serif",
    minWidth: '36px',
  },
  '.cm-gutter.cm-lineNumbers .cm-gutterElement': {
    paddingRight: '8px',
    paddingLeft: '8px',
    lineHeight: '2.8',
  },
  '.cm-scroller': {
    minHeight: '400px',
    overflow: 'auto',
  },
  '&.cm-focused': {
    outline: 'none',
  },
  // Use native browser selection instead of drawSelection overlay.
  // drawSelection fails to render backgrounds within mark decoration spans
  // (italic, bold, blockquote) due to coordsAtPos measurement issues.
  '.cm-selectionLayer': {
    display: 'none !important',
  },
  '& .cm-content .cm-line ::selection': {
    backgroundColor: 'rgba(215, 180, 74, 0.3) !important',
  },
  '& .cm-content .cm-line::selection': {
    backgroundColor: 'rgba(215, 180, 74, 0.3) !important',
  },

  // Revealed syntax on focused line — visible but muted (Obsidian style: same size, muted color)
  '.cm-revealed-syntax': {
    color: '#bbb',
    fontSize: 'inherit',
  },

  // Zero-width hidden syntax — text stays in DOM but takes no space
  '.cm-hidden-syntax': {
    fontSize: '0',
    lineHeight: '0',
    overflow: 'hidden',
    display: 'inline',
    width: '0',
    padding: '0',
    margin: '0',
    border: 'none',
    color: 'transparent',
  },

  // Headings — mark class just flags the text; font styling on line-level so
  // CM6 measures consistent height for gutter alignment (no mixed font sizes)
  '.cm-heading-1': {},
  '.cm-heading-2': {},
  '.cm-heading-3': {},
  '.cm-heading-4': { color: '#6b6b6b' },
  '.cm-heading-5': { textTransform: 'uppercase', letterSpacing: '0.5px', color: '#888' },
  // Line-level heading styles — font on the .cm-line so gutter syncs properly
  '.cm-heading-line-1': {
    fontFamily: "'Poppins', sans-serif",
    fontSize: '2rem',
    fontWeight: '600',
    lineHeight: '1.3',
  },
  '.cm-heading-line-2': {
    fontFamily: "'Poppins', sans-serif",
    fontSize: '1.5rem',
    fontWeight: '600',
    lineHeight: '1.3',
    paddingBottom: '0.2em',
    borderBottom: '1px solid #e5e5e5',
  },
  '.cm-heading-line-3': {
    fontFamily: "'Poppins', sans-serif",
    fontSize: '1.15rem',
    fontWeight: '600',
    lineHeight: '1.4',
  },
  '.cm-heading-line-4': {
    fontFamily: "'Poppins', sans-serif",
    fontSize: '0.95rem',
    fontWeight: '600',
    lineHeight: '1.4',
  },
  '.cm-heading-line-5': {
    fontFamily: "'Poppins', sans-serif",
    fontSize: '0.85rem',
    fontWeight: '600',
  },

  // Question blocks — border on line to prevent duplication from split spans
  // Minimal paddingTop so line number aligns with text; spacing mostly in paddingBottom
  '.cm-line:has(.cm-question-block)': {
    borderLeft: '3px solid #dfb53b',
    background: '#fdfbf4',
    padding: '0.3rem 1.25rem 0.8rem 1.25rem !important',
    borderRadius: '0 6px 6px 0',
  },
  '.cm-question-block': {
    display: 'inline',
  },

  // Callouts
  '.cm-callout': {
    background: 'rgba(83, 105, 66, 0.07)',
    borderRadius: '3px',
    padding: '1px 4px',
  },

  // Attributions — right-align on line to prevent split-span issues
  '.cm-line:has(.cm-attribution)': {
    textAlign: 'right',
    padding: '4px 24px !important',
  },
  '.cm-attribution': {
    fontSize: '0.85rem',
    color: '#6b6b6b',
    fontWeight: '600',
  },

  // Blockquotes — border + background on the LINE to prevent duplication
  // when suggestion/comment marks split the blockquote into multiple spans
  '.cm-line:has(.cm-blockquote)': {
    borderLeft: '3px solid #536942',
    background: '#f6f8f5',
    paddingLeft: '1.5rem !important',
  },
  '.cm-blockquote': {
    fontStyle: 'italic',
  },

  // Section blocks — border on line to prevent duplication
  // Minimal paddingTop so line number aligns with text; spacing in paddingBottom
  '.cm-line:has(.cm-section-block)': {
    background: '#f6f8f5',
    border: '1px solid #e2e6df',
    borderRadius: '6px',
    padding: '0.3rem 1.5rem 1rem 1.5rem !important',
  },
  '.cm-section-block': {
    display: 'inline',
  },

  // Bold / Italic
  '.cm-bold': {
    fontWeight: 'bold',
  },
  '.cm-italic': {
    fontStyle: 'italic',
  },

  // BR spacer
  '.cm-br-spacer': {
    height: '1.5em',
  },

  // Image placeholder
  '.cm-image-placeholder': {
    display: 'block',
    background: '#f0f0f0',
    border: '1px dashed #ccc',
    borderRadius: '4px',
    padding: '8px 12px',
    color: '#888',
    fontSize: '0.85rem',
    textAlign: 'center',
  },
});

// --- Export the complete masking extension ---
// No atomicRanges: inline syntax uses zero-width marks (smooth cursor),
// block tags use replace decorations (inherently atomic).
export function maskingExtension() {
  return [maskingPlugin, maskingTheme];
}
