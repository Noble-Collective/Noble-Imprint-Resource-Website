// Noble Imprint — Suggestion & Comment Tracking Extension (v3 — Registry-based)
//
// Architecture:
// - annotationRegistry StateField: single source of truth for all saved suggestions + comments
// - Positions tracked via CM6 mapPos — survive any document change
// - Diff engine (computeHunks) only used for detecting NEW unsaved edits
// - Decorations built from BOTH registry (saved) and diff (unsaved drafts)
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

// --- Annotation Registry: unified tracking for suggestions + comments ---
const addAnnotation = StateEffect.define();
const removeAnnotation = StateEffect.define(); // by id
const setAnnotations = StateEffect.define();   // bulk load
const updateAnnotation = StateEffect.define(); // partial update { id, ...fields }
const isRevert = Annotation.define();          // tags revert transactions

export const annotationRegistry = StateField.define({
  create() { return new Map(); },
  update(registry, tr) {
    let updated = new Map(registry);

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
        const newTo = (a.kind === 'suggestion' && a.type === 'deletion')
          ? newFrom
          : tr.changes.mapPos(a.currentTo, -1);
        if (newTo < newFrom) {
          updated.delete(id);
        } else {
          updated.set(id, { ...a, currentFrom: newFrom, currentTo: newTo });
        }
      }
    }

    return updated;
  },
});

export { addAnnotation, removeAnnotation, setAnnotations, updateAnnotation, isRevert };

// --- Get all annotations from the registry (for external use) ---
export function getRegistryAnnotations(view) {
  return view.state.field(annotationRegistry);
}

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
  const diffs = diffChars(original, current);

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

  const MERGE_THRESHOLD = 4;
  const groups = [];
  let currentGroup = null;

  for (const seg of segments) {
    if (seg.type === 'same') {
      if (currentGroup && seg.value.length < MERGE_THRESHOLD && /^\w+$/.test(seg.value)) {
        currentGroup.origText += seg.value;
        currentGroup.newText += seg.value;
        currentGroup.origTo += seg.value.length;
        currentGroup.currTo += seg.value.length;
      } else {
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

  // Post-process: fix diffChars character-level artifacts.
  // diffChars splits single word replacements into fragments when the original
  // and replacement share characters (e.g., "complete"→"compete" becomes
  // delete "l" instead of replace "complete"→"compete").

  // Step 1: Merge adjacent groups separated by word-internal gaps.
  for (let i = groups.length - 1; i > 0; i--) {
    const prev = groups[i - 1];
    const curr = groups[i];
    const origGap = original.substring(prev.origTo, curr.origFrom);
    if (origGap.length > 0 && origGap.length <= 30 && /^\w+$/.test(origGap)) {
      const currGap = current.substring(prev.currTo, curr.currFrom);
      prev.origText += origGap + curr.origText;
      prev.origTo = curr.origTo;
      prev.newText += currGap + curr.newText;
      prev.currTo = curr.currTo;
      groups.splice(i, 1);
    }
  }

  // Step 2: Extend groups to word boundaries. When a group ends mid-word,
  // the trailing shared characters were absorbed into the unchanged suffix
  // by diffChars. Extend forward to include the rest of the word in both
  // original and current documents. Skip pure insertions (empty origText)
  // — they don't have original text to extend.
  for (const g of groups) {
    if (!g.origText && !g.newText) continue; // empty group
    if (!g.origText) continue; // pure insertion — no word boundary to extend
    let origExt = 0;
    while (g.origTo + origExt < original.length && /\w/.test(original[g.origTo + origExt])) origExt++;
    let currExt = 0;
    while (g.currTo + currExt < current.length && /\w/.test(current[g.currTo + currExt])) currExt++;
    if (origExt > 0 || currExt > 0) {
      g.origText += original.substring(g.origTo, g.origTo + origExt);
      g.origTo += origExt;
      g.newText += current.substring(g.currTo, g.currTo + currExt);
      g.currTo += currExt;
    }
  }

  const hunks = [];
  let hunkId = 0;
  for (const g of groups) {
    if (g.origText && g.newText) {
      hunks.push({ id: 'hunk-' + (hunkId++), type: 'replacement', originalFrom: g.origFrom, originalTo: g.origTo, originalText: g.origText, newText: g.newText, currentFrom: g.currFrom, currentTo: g.currTo, currentPos: g.currFrom });
    } else if (g.origText) {
      hunks.push({ id: 'hunk-' + (hunkId++), type: 'deletion', originalFrom: g.origFrom, originalTo: g.origTo, originalText: g.origText, newText: '', currentPos: g.currFrom });
    } else if (g.newText) {
      hunks.push({ id: 'hunk-' + (hunkId++), type: 'insertion', originalFrom: g.origFrom, originalTo: g.origFrom, originalText: '', newText: g.newText, currentFrom: g.currFrom, currentTo: g.currTo });
    }
  }

  return hunks;
}

// --- Build decorations from BOTH registry and diff hunks ---
function buildDecorations(view) {
  const decorations = [];
  const registry = view.state.field(annotationRegistry);
  const doc = view.state.doc;
  const docLen = doc.length;

  // 1. Registry decorations (saved suggestions + comments)
  for (const [, a] of registry) {
    if (a.currentFrom == null || a.currentTo == null) continue;
    if (a.currentFrom < 0 || a.currentTo > docLen) continue;

    if (a.kind === 'suggestion') {
      if (a.type === 'insertion' && a.currentFrom < a.currentTo) {
        decorations.push(Decoration.mark({ class: 'cm-suggestion-insert', attributes: { 'data-hunk-id': a.id } }).range(a.currentFrom, a.currentTo));
      } else if (a.type === 'deletion') {
        decorations.push(Decoration.widget({ widget: new DeletedTextWidget(a.originalText, a.id), side: -1 }).range(a.currentFrom));
      } else if (a.type === 'replacement' && a.currentFrom < a.currentTo) {
        decorations.push(Decoration.widget({ widget: new DeletedTextWidget(a.originalText, a.id), side: -1 }).range(a.currentFrom));
        decorations.push(Decoration.mark({ class: 'cm-suggestion-insert', attributes: { 'data-hunk-id': a.id } }).range(a.currentFrom, a.currentTo));
      }
    } else if (a.kind === 'comment') {
      if (a.currentFrom < a.currentTo) {
        decorations.push(Decoration.mark({ class: 'cm-comment-highlight', attributes: { 'data-comment-id': a.id } }).range(a.currentFrom, a.currentTo));
      }
    }
  }

  decorations.sort((a, b) => a.from - b.from);
  return Decoration.set(decorations, true);
}

// --- Diff engine: detect unsaved edits, build their decorations ---
function buildDraftDecorations(hunks) {
  const decorations = [];
  for (const hunk of hunks) {
    if (hunk.type === 'insertion') {
      decorations.push(Decoration.mark({ class: 'cm-suggestion-insert', attributes: { 'data-hunk-id': hunk.id } }).range(hunk.currentFrom, hunk.currentTo));
    } else if (hunk.type === 'deletion') {
      decorations.push(Decoration.widget({ widget: new DeletedTextWidget(hunk.originalText, hunk.id), side: -1 }).range(hunk.currentPos));
    } else if (hunk.type === 'replacement') {
      decorations.push(Decoration.widget({ widget: new DeletedTextWidget(hunk.originalText, hunk.id), side: -1 }).range(hunk.currentFrom));
      decorations.push(Decoration.mark({ class: 'cm-suggestion-insert', attributes: { 'data-hunk-id': hunk.id } }).range(hunk.currentFrom, hunk.currentTo));
    }
  }
  decorations.sort((a, b) => a.from - b.from);
  return Decoration.set(decorations, true);
}

// --- Registry decoration plugin: renders saved suggestions + comments ---
const registryDecoPlugin = ViewPlugin.fromClass(
  class {
    constructor(view) {
      this.decorations = buildDecorations(view);
    }
    update(update) {
      if (update.docChanged || update.transactions.some(tr =>
        tr.effects.some(e => e.is(addAnnotation) || e.is(removeAnnotation) || e.is(setAnnotations) || e.is(updateAnnotation))
      )) {
        this.decorations = buildDecorations(update.view);
      }
    }
  },
  { decorations: (v) => v.decorations }
);

// --- Diff engine plugin: renders unsaved draft edits ---
let currentHunks = [];
let debounceTimer = null;
let onHunksChanged = null;

export function setHunksChangedCallback(fn) {
  onHunksChanged = fn;
}

const draftPlugin = ViewPlugin.fromClass(
  class {
    constructor(view) {
      this.decorations = Decoration.none;
      this._lastOriginal = '';
    }
    update(update) {
      const original = update.view.state.field(originalDocField);
      const originalChanged = original !== this._lastOriginal;
      if (originalChanged) this._lastOriginal = original;
      const registryChanged = update.transactions.some(tr =>
        tr.effects.some(e => e.is(addAnnotation) || e.is(removeAnnotation) || e.is(setAnnotations) || e.is(updateAnnotation))
      );
      if (update.docChanged || originalChanged || registryChanged) {
        if (!original) {
          currentHunks = [];
          this.decorations = Decoration.none;
          if (onHunksChanged) onHunksChanged([]);
          return;
        }
        const current = update.view.state.doc.toString();
        if (current === original) {
          currentHunks = [];
          this.decorations = Decoration.none;
          if (onHunksChanged) onHunksChanged([]);
          return;
        }

        const allHunks = computeHunks(original, current);

        // Filter out hunks already in the registry (they have their own decorations
        // from registryDecoPlugin). Match by content AND position — content-only matching
        // causes identical edits at different positions to be incorrectly filtered out
        // (e.g., adding "s" to multiple words would only show the first one).
        const registry = update.view.state.field(annotationRegistry);
        const hunks = allHunks.filter(h => {
          const hFrom = h.type === 'deletion' ? h.currentPos : h.currentFrom;
          const hTo = h.type === 'deletion' ? h.currentPos : h.currentTo;
          for (const [, a] of registry) {
            if (a.kind !== 'suggestion') continue;
            const aFrom = a.currentFrom;
            const aTo = a.currentTo;
            // Exact match: same type, text, and position
            if (a.originalText === h.originalText && a.newText === h.newText && a.type === h.type) {
              if (Math.abs(hFrom - aFrom) <= 2 && Math.abs(hTo - aTo) <= 2) return false;
            }
            // Overlap match: draft insertion whose text is part of a registry entry's newText
            // (e.g., diff engine splits a replacement into insertion + unchanged,
            // or a server-submitted replacement decomposes differently than local diffChars)
            if (h.type === 'insertion' && a.newText && hFrom >= aFrom - 1 && hTo <= aTo + 1
                && a.newText.includes(h.newText)) return false;
            // Fuzzy match: same newText at a nearby position, regardless of type/originalText.
            // When resolveAnchor returns a slightly off position after re-anchoring, buildWorkingDoc
            // applies the change at the wrong spot. diffChars then decomposes it with a different
            // type (e.g., insertion vs replacement) or different originalText, but the newText stays
            // the same because that's what was written into the working doc.
            // Only for newText >= 3 chars — short strings like "s" or "**" are too common and
            // would cause false positives for identical edits at different positions.
            if (a.newText && a.newText.length >= 3 && a.newText === h.newText && Math.abs(hFrom - aFrom) <= 5) return false;
            // Positional containment: if the draft hunk falls within a registry entry's range,
            // it's a fragment of that entry's change decomposed differently by the diff engine.
            // This catches API-submitted replacements where diffChars sees deletions/insertions
            // instead of the full replacement stored in the registry.
            if (hFrom >= aFrom - 1 && hTo <= aTo + 1) return false;
          }
          return true;
        });

        console.log('[DRAFT] computeHunks returned', allHunks.length, 'total,', hunks.length, 'draft (filtered', allHunks.length - hunks.length, 'registry dupes):', hunks.map(h => h.type + ' "' + (h.originalText||'').slice(0,20) + '"→"' + (h.newText||'').slice(0,20) + '"'));
        currentHunks = hunks;
        this.decorations = buildDraftDecorations(hunks);

        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
          console.log('[DRAFT] debounce fired, currentHunks has', currentHunks.length, 'hunks');
          if (onHunksChanged) onHunksChanged(currentHunks);
        }, 300);
      }
    }
  },
  { decorations: (v) => v.decorations }
);

// --- Theme ---
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
  '.cm-comment-highlight': {
    background: 'rgba(251, 188, 4, 0.25)',
    borderBottom: '2px solid #fbbc04',
  },
});

// --- Export ---
export function suggestionExtension() {
  return [originalDocField, annotationRegistry, registryDecoPlugin, draftPlugin, suggestionTheme];
}

export function getCurrentHunks() {
  return currentHunks;
}

export { setOriginal };
