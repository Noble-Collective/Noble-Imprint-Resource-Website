// Noble Imprint — Suggestion Tracking Extension
// Computes diff between original and current, renders inline decorations,
// and manages suggestion state for the margin panel.
import {
  Decoration, ViewPlugin, WidgetType, StateField, StateEffect,
  EditorView, diffWords,
} from '/static/js/codemirror-bundle.js';

// --- State: original document content (set once on init) ---
const setOriginal = StateEffect.define();
export const originalDocField = StateField.define({
  create() { return ''; },
  update(value, tr) {
    for (const e of tr.effects) {
      if (e.is(setOriginal)) return e.value;
    }
    return value;
  },
});

// --- Widget for showing deleted text inline ---
class DeletedTextWidget extends WidgetType {
  constructor(text, hunkId) {
    super();
    this.text = text;
    this.hunkId = hunkId;
  }
  toDOM() {
    const span = document.createElement('span');
    span.className = 'cm-suggestion-delete';
    span.textContent = this.text;
    span.dataset.hunkId = this.hunkId || '';
    return span;
  }
  ignoreEvent() { return true; }
  eq(other) { return this.text === other.text && this.hunkId === other.hunkId; }
}

// --- Compute diff hunks between original and current ---
export function computeHunks(original, current) {
  const diffs = diffWords(original, current);
  const hunks = [];
  let origOffset = 0;
  let currOffset = 0;
  let hunkId = 0;

  for (const part of diffs) {
    if (!part.added && !part.removed) {
      // Unchanged
      origOffset += part.value.length;
      currOffset += part.value.length;
    } else if (part.removed && !part.added) {
      // Deletion: text in original but not in current
      hunks.push({
        id: 'hunk-' + (hunkId++),
        type: 'deletion',
        originalFrom: origOffset,
        originalTo: origOffset + part.value.length,
        originalText: part.value,
        newText: '',
        currentPos: currOffset, // Where the widget goes in the current doc
      });
      origOffset += part.value.length;
    } else if (part.added && !part.removed) {
      // Insertion: text in current but not in original
      hunks.push({
        id: 'hunk-' + (hunkId++),
        type: 'insertion',
        originalFrom: origOffset,
        originalTo: origOffset,
        originalText: '',
        newText: part.value,
        currentFrom: currOffset,
        currentTo: currOffset + part.value.length,
      });
      currOffset += part.value.length;
    }
  }

  // Merge adjacent deletion+insertion into replacements
  const merged = [];
  let i = 0;
  while (i < hunks.length) {
    if (i + 1 < hunks.length &&
        hunks[i].type === 'deletion' &&
        hunks[i + 1].type === 'insertion' &&
        hunks[i].currentPos === hunks[i + 1].currentFrom) {
      merged.push({
        id: hunks[i].id,
        type: 'replacement',
        originalFrom: hunks[i].originalFrom,
        originalTo: hunks[i].originalTo,
        originalText: hunks[i].originalText,
        newText: hunks[i + 1].newText,
        currentFrom: hunks[i + 1].currentFrom,
        currentTo: hunks[i + 1].currentTo,
        currentPos: hunks[i].currentPos,
      });
      i += 2;
    } else {
      merged.push(hunks[i]);
      i++;
    }
  }

  return merged;
}

// --- Build suggestion decorations from hunks ---
function buildSuggestionDecorations(hunks) {
  const decorations = [];

  for (const hunk of hunks) {
    if (hunk.type === 'insertion') {
      decorations.push(
        Decoration.mark({
          class: 'cm-suggestion-insert',
          attributes: { 'data-hunk-id': hunk.id },
        }).range(hunk.currentFrom, hunk.currentTo)
      );
    } else if (hunk.type === 'deletion') {
      decorations.push(
        Decoration.widget({
          widget: new DeletedTextWidget(hunk.originalText, hunk.id),
          side: -1,
        }).range(hunk.currentPos)
      );
    } else if (hunk.type === 'replacement') {
      // Show deleted text as widget, then mark the insertion
      decorations.push(
        Decoration.widget({
          widget: new DeletedTextWidget(hunk.originalText, hunk.id),
          side: -1,
        }).range(hunk.currentFrom)
      );
      decorations.push(
        Decoration.mark({
          class: 'cm-suggestion-insert',
          attributes: { 'data-hunk-id': hunk.id },
        }).range(hunk.currentFrom, hunk.currentTo)
      );
    }
  }

  decorations.sort((a, b) => a.from - b.from);
  return Decoration.set(decorations, true);
}

// --- ViewPlugin: recompute diff on every document change ---
let currentHunks = [];
let debounceTimer = null;
let onHunksChanged = null; // Callback for margin panel

export function setHunksChangedCallback(fn) {
  onHunksChanged = fn;
}

const suggestionPlugin = ViewPlugin.fromClass(
  class {
    constructor(view) {
      this.decorations = Decoration.none;
      this._lastOriginal = '';
    }
    update(update) {
      const original = update.view.state.field(originalDocField);
      const originalChanged = original !== this._lastOriginal;
      if (originalChanged) this._lastOriginal = original;
      if (update.docChanged || originalChanged) {
        const original = update.view.state.field(originalDocField);
        if (!original) {
          this.decorations = Decoration.none;
          return;
        }
        const current = update.view.state.doc.toString();
        if (current === original) {
          currentHunks = [];
          this.decorations = Decoration.none;
          if (onHunksChanged) onHunksChanged([]);
          return;
        }

        const hunks = computeHunks(original, current);
        currentHunks = hunks;
        this.decorations = buildSuggestionDecorations(hunks);

        // Notify margin panel (debounced)
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
          if (onHunksChanged) onHunksChanged(currentHunks);
        }, 300);
      }
    }
  },
  {
    decorations: (v) => v.decorations,
  }
);

// --- Theme for suggestion decorations ---
const suggestionTheme = EditorView.theme({
  '.cm-suggestion-insert': {
    background: 'rgba(52, 168, 83, 0.18)',
    color: '#1e7e34',
    textDecoration: 'underline',
    textDecorationColor: 'rgba(52, 168, 83, 0.4)',
  },
  '.cm-suggestion-delete': {
    background: 'rgba(234, 67, 53, 0.12)',
    color: '#c62828',
    textDecoration: 'line-through',
    cursor: 'default',
    userSelect: 'none',
    fontSize: 'inherit',
    fontFamily: 'inherit',
  },
});

// --- Export ---
export function suggestionExtension() {
  return [originalDocField, suggestionPlugin, suggestionTheme];
}

export function getCurrentHunks() {
  return currentHunks;
}

export { setOriginal };
