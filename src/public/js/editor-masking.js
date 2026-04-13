// Noble Imprint — CodeMirror 6 Masking Extension
// Hides structural markdown/custom syntax, shows formatted text
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

// --- Build decorations by scanning document text ---
function buildMaskingDecorations(view) {
  const doc = view.state.doc;
  const text = doc.toString();
  const decorations = [];

  // Helper: add a collapsed (hidden) range
  function hide(from, to) {
    if (from < to) {
      decorations.push(Decoration.replace({ inclusive: false }).range(from, to));
    }
  }

  // Helper: add a styled range
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

    hide(fullStart, openTagEnd);          // Hide <Question id=...>
    hide(closeTagStart, fullEnd);          // Hide </Question>
    mark(openTagEnd, closeTagStart, 'cm-question-block'); // Style content
  }

  // --- Callout blocks: <Callout>content</Callout> ---
  const calloutRe = /<Callout>([\s\S]*?)<\/Callout>/g;
  while ((m = calloutRe.exec(text)) !== null) {
    const fullStart = m.index;
    const fullEnd = fullStart + m[0].length;
    const openTagEnd = fullStart + '<Callout>'.length;
    const closeTagStart = fullEnd - '</Callout>'.length;

    hide(fullStart, openTagEnd);
    hide(closeTagStart, fullEnd);
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

      hide(fullStart, openTagEnd);
      hide(closeTagStart, fullEnd);
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
      hide(lineFrom, lineFrom + prefixLen);
      mark(lineFrom + prefixLen, line.to, 'cm-heading-' + level);
      continue;
    }

    // Attribution: << text
    const attrMatch = lineText.match(/^<<\s+/);
    if (attrMatch) {
      const prefixLen = attrMatch[0].length;
      hide(lineFrom, lineFrom + prefixLen);
      mark(lineFrom + prefixLen, line.to, 'cm-attribution');
      continue;
    }

    // Blockquote: > text
    const bqMatch = lineText.match(/^>\s*/);
    if (bqMatch && lineText.trim() !== '>') {
      const prefixLen = bqMatch[0].length;
      hide(lineFrom, lineFrom + prefixLen);
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
    hide(fullStart, fullStart + 2);              // Hide opening **
    hide(fullEnd - 2, fullEnd);                  // Hide closing **
    mark(fullStart + 2, fullEnd - 2, 'cm-bold'); // Style content
  }

  // --- Inline: _italic_ (single underscore, not inside words) ---
  const italicRe = /(?<![a-zA-Z0-9])_(.+?)_(?![a-zA-Z0-9])/g;
  while ((m = italicRe.exec(text)) !== null) {
    const fullStart = m.index;
    const fullEnd = fullStart + m[0].length;
    hide(fullStart, fullStart + 1);                // Hide opening _
    hide(fullEnd - 1, fullEnd);                    // Hide closing _
    mark(fullStart + 1, fullEnd - 1, 'cm-italic'); // Style content
  }

  // Sort by position (required by CodeMirror)
  decorations.sort((a, b) => a.from - b.from || a.to - b.to);

  return Decoration.set(decorations, true);
}

// --- ViewPlugin that recomputes decorations on each document change ---
const maskingPlugin = ViewPlugin.fromClass(
  class {
    constructor(view) {
      this.decorations = buildMaskingDecorations(view);
    }
    update(update) {
      if (update.docChanged || update.viewportChanged) {
        this.decorations = buildMaskingDecorations(update.view);
      }
    }
  },
  {
    decorations: (v) => v.decorations,
  }
);

// --- Atomic ranges: cursor skips over hidden decorations ---
const atomicRanges = EditorView.atomicRanges.of((view) => {
  const plugin = view.plugin(maskingPlugin);
  return plugin ? plugin.decorations : Decoration.none;
});

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
    maxWidth: '100%',
  },
  '.cm-line': {
    padding: '0 24px',
  },
  '.cm-gutters': {
    display: 'none',
  },
  '.cm-scroller': {
    minHeight: '400px',
    overflow: 'auto',
  },
  '&.cm-focused': {
    outline: 'none',
  },

  // Headings
  '.cm-heading-1': {
    fontFamily: "'Poppins', sans-serif",
    fontSize: '2rem',
    fontWeight: '600',
    lineHeight: '1.3',
    marginTop: '0.5em',
  },
  '.cm-heading-2': {
    fontFamily: "'Poppins', sans-serif",
    fontSize: '1.5rem',
    fontWeight: '600',
    lineHeight: '1.3',
    marginTop: '0.5em',
    paddingBottom: '0.25em',
    borderBottom: '1px solid #e5e5e5',
  },
  '.cm-heading-3': {
    fontFamily: "'Poppins', sans-serif",
    fontSize: '1.15rem',
    fontWeight: '600',
    lineHeight: '1.4',
    marginTop: '0.3em',
  },
  '.cm-heading-4': {
    fontFamily: "'Poppins', sans-serif",
    fontSize: '0.95rem',
    fontWeight: '600',
    lineHeight: '1.4',
    color: '#6b6b6b',
  },
  '.cm-heading-5': {
    fontFamily: "'Poppins', sans-serif",
    fontSize: '0.85rem',
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
    color: '#888',
  },

  // Question blocks
  '.cm-question-block': {
    display: 'block',
    borderLeft: '3px solid #dfb53b',
    background: '#fdfbf4',
    padding: '0.75rem 1.25rem',
    margin: '0.5rem 0',
    borderRadius: '0 6px 6px 0',
  },

  // Callouts
  '.cm-callout': {
    background: 'rgba(83, 105, 66, 0.07)',
    borderRadius: '3px',
    padding: '1px 4px',
  },

  // Attributions (right-aligned)
  '.cm-attribution': {
    display: 'block',
    textAlign: 'right',
    fontSize: '0.85rem',
    color: '#6b6b6b',
    fontWeight: '600',
    padding: '4px 0',
  },

  // Blockquotes
  '.cm-blockquote': {
    borderLeft: '3px solid #536942',
    background: '#f6f8f5',
    paddingLeft: '1.5rem',
    fontStyle: 'italic',
  },

  // Section blocks
  '.cm-section-block': {
    display: 'block',
    background: '#f6f8f5',
    border: '1px solid #e2e6df',
    borderRadius: '6px',
    padding: '1rem 1.5rem',
    margin: '0.5rem 0',
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
export function maskingExtension() {
  return [maskingPlugin, atomicRanges, maskingTheme];
}
