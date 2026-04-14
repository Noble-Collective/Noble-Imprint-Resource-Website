// Noble Imprint — Suggestion Tracking Extension
// Computes diff between original and current, renders inline decorations,
// and manages suggestion state for the margin panel.
import {
  Decoration, ViewPlugin, WidgetType, StateField, StateEffect,
  EditorView, Annotation, diffChars,
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

// --- Annotation Registry: independent, immutable suggestion/comment tracking ---
// Each annotation has stable positions that map through document changes via mapPos.
const addAnnotation = StateEffect.define();
const removeAnnotation = StateEffect.define(); // by id
const setAnnotations = StateEffect.define();   // bulk load
const updateAnnotation = StateEffect.define(); // partial update { id, ...fields }
const isRevert = Annotation.define();          // tags revert transactions

export const annotationRegistry = StateField.define({
  create() { return new Map(); },
  update(registry, tr) {
    let updated = new Map(registry);

    // Process effects first (before position mapping)
    for (const e of tr.effects) {
      if (e.is(setAnnotations)) {
        updated = new Map();
        for (const a of e.value) updated.set(a.id, a);
        return updated;
      }
      if (e.is(addAnnotation)) updated.set(e.value.id, e.value);
      if (e.is(removeAnnotation)) updated.delete(e.value);
      if (e.is(updateAnnotation)) {
        const existing = updated.get(e.value.id);
        if (existing) updated.set(e.value.id, { ...existing, ...e.value });
      }
    }

    // Map positions through document changes
    if (tr.docChanged) {
      for (const [id, a] of updated) {
        if (a.currentFrom == null || a.currentTo == null) continue;
        const newFrom = tr.changes.mapPos(a.currentFrom, 1);
        const newTo = a.kind === 'suggestion' && a.type === 'deletion'
          ? newFrom
          : tr.changes.mapPos(a.currentTo, -1);
        if (newTo < newFrom) {
          updated.delete(id); // range collapsed — annotation overwritten
        } else {
          updated.set(id, { ...a, currentFrom: newFrom, currentTo: newTo });
        }
      }
    }

    return updated;
  },
});

export { addAnnotation, removeAnnotation, setAnnotations, updateAnnotation, isRevert };

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
// Uses diffChars for character-level precision, then merges nearby changes into
// coherent hunks (so "Christianity" → "Faith" is one replacement, not 5 tiny ones).
export function computeHunks(original, current) {
  const diffs = diffChars(original, current);

  // First pass: collect raw change segments with their positions
  const segments = [];
  let origOffset = 0;
  let currOffset = 0;

  for (const part of diffs) {
    if (!part.added && !part.removed) {
      segments.push({ type: 'same', value: part.value, origFrom: origOffset, currFrom: currOffset });
      origOffset += part.value.length;
      currOffset += part.value.length;
    } else if (part.removed) {
      segments.push({ type: 'del', value: part.value, origFrom: origOffset, currFrom: currOffset });
      origOffset += part.value.length;
    } else if (part.added) {
      segments.push({ type: 'ins', value: part.value, origFrom: origOffset, currFrom: currOffset });
      currOffset += part.value.length;
    }
  }

  // Second pass: merge adjacent/nearby changes into coherent hunks.
  // If unchanged text between two changes is less than 4 chars, merge them.
  const MERGE_THRESHOLD = 4;
  const groups = []; // Each group: { origText, newText, origFrom, origTo, currFrom, currTo }
  let currentGroup = null;

  for (const seg of segments) {
    if (seg.type === 'same') {
      if (currentGroup && seg.value.length < MERGE_THRESHOLD) {
        // Small gap — absorb into the current group
        currentGroup.origText += seg.value;
        currentGroup.newText += seg.value;
        currentGroup.origTo += seg.value.length;
        currentGroup.currTo += seg.value.length;
      } else {
        // Large gap — finalize current group
        if (currentGroup) groups.push(currentGroup);
        currentGroup = null;
      }
    } else if (seg.type === 'del') {
      if (!currentGroup) {
        currentGroup = { origText: '', newText: '', origFrom: seg.origFrom, origTo: seg.origFrom, currFrom: seg.currFrom, currTo: seg.currFrom };
      }
      currentGroup.origText += seg.value;
      currentGroup.origTo += seg.value.length;
    } else if (seg.type === 'ins') {
      if (!currentGroup) {
        currentGroup = { origText: '', newText: '', origFrom: seg.origFrom, origTo: seg.origFrom, currFrom: seg.currFrom, currTo: seg.currFrom };
      }
      currentGroup.newText += seg.value;
      currentGroup.currTo += seg.value.length;
    }
  }
  if (currentGroup) groups.push(currentGroup);

  // Convert groups to hunks
  const hunks = [];
  let hunkId = 0;
  for (const g of groups) {
    if (g.origText && g.newText) {
      hunks.push({
        id: 'hunk-' + (hunkId++),
        type: 'replacement',
        originalFrom: g.origFrom,
        originalTo: g.origTo,
        originalText: g.origText,
        newText: g.newText,
        currentFrom: g.currFrom,
        currentTo: g.currTo,
        currentPos: g.currFrom,
      });
    } else if (g.origText) {
      hunks.push({
        id: 'hunk-' + (hunkId++),
        type: 'deletion',
        originalFrom: g.origFrom,
        originalTo: g.origTo,
        originalText: g.origText,
        newText: '',
        currentPos: g.currFrom,
      });
    } else if (g.newText) {
      hunks.push({
        id: 'hunk-' + (hunkId++),
        type: 'insertion',
        originalFrom: g.origFrom,
        originalTo: g.origFrom,
        originalText: '',
        newText: g.newText,
        currentFrom: g.currFrom,
        currentTo: g.currTo,
      });
    }
  }

  return hunks;
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
  return [originalDocField, annotationRegistry, suggestionPlugin, suggestionTheme];
}

export function getCurrentHunks() {
  return currentHunks;
}

export { setOriginal };
