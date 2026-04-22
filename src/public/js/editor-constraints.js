// Noble Imprint — Selection & Edit Constraints for Suggest Mode (v2)
// Restricts editing to within a single line and within the innermost markdown tag boundary.
// Prevents edits from spanning or breaking structural syntax.
//
// v2: Uses transactionFilter for selection clamping (synchronous, no flicker)
// and changeFilter for edit protection (purpose-built API). No mouseup hacks.
import { EditorState, StateField, StateEffect, EditorSelection } from '/static/js/codemirror-bundle.js';

// --- Editable zones: computed from the document, shared with other extensions ---
// Each zone is { from, to } representing a contiguous range of editable text
// within a single tag/line boundary.

const setZones = StateEffect.define();

export const editableZonesField = StateField.define({
  create() { return []; },
  update(value, tr) {
    for (const e of tr.effects) {
      if (e.is(setZones)) return e.value;
    }
    return value;
  },
});

// --- Compute editable zones from the document ---
export function computeEditableZones(doc) {
  const zones = [];

  for (let i = 1; i <= doc.lines; i++) {
    const line = doc.line(i);
    const lineText = line.text;
    const lineFrom = line.from;

    // Skip empty lines
    if (lineText.trim().length === 0) continue;

    // Skip <br> lines
    if (/^<br\s*\/?>$/.test(lineText.trim())) continue;

    // Skip <image> lines
    if (/^<image\s+(.+?)>$/.test(lineText)) continue;

    const lineZones = parseLineZones(lineText, lineFrom);
    zones.push(...lineZones);
  }

  return zones;
}

// Parse a single line into editable zones, respecting nested tags.
function parseLineZones(lineText, lineFrom) {
  const zones = [];

  // Strip line-level prefix (##, <<, >)
  let contentStart = 0;
  const headingMatch = lineText.match(/^(#{1,6})\s+/);
  const attrMatch = lineText.match(/^<<\s+/);
  const bqMatch = lineText.match(/^>\s*/);

  if (headingMatch) contentStart = headingMatch[0].length;
  else if (attrMatch) contentStart = attrMatch[0].length;
  else if (bqMatch && lineText.trim() !== '>') contentStart = bqMatch[0].length;

  const absStart = lineFrom + contentStart;

  // Parse inline tags
  const tagRanges = [];
  let m;
  const fullLine = lineText;

  // Question blocks
  const questionRe = /<Question\s+id=[^>]+>/g;
  while ((m = questionRe.exec(fullLine)) !== null) {
    const openEnd = m.index + m[0].length;
    const closeIdx = fullLine.indexOf('</Question>', openEnd);
    if (closeIdx >= 0) {
      tagRanges.push({
        from: lineFrom + m.index,
        to: lineFrom + closeIdx + '</Question>'.length,
        contentFrom: lineFrom + openEnd,
        contentTo: lineFrom + closeIdx,
      });
    }
  }

  // Callout blocks
  const calloutRe = /<Callout>/g;
  while ((m = calloutRe.exec(fullLine)) !== null) {
    const openEnd = m.index + '<Callout>'.length;
    const closeIdx = fullLine.indexOf('</Callout>', openEnd);
    if (closeIdx >= 0) {
      tagRanges.push({
        from: lineFrom + m.index,
        to: lineFrom + closeIdx + '</Callout>'.length,
        contentFrom: lineFrom + openEnd,
        contentTo: lineFrom + closeIdx,
      });
    }
  }

  // Bold: **...**
  const boldRe = /\*\*(.+?)\*\*/g;
  while ((m = boldRe.exec(fullLine)) !== null) {
    tagRanges.push({
      from: lineFrom + m.index,
      to: lineFrom + m.index + m[0].length,
      contentFrom: lineFrom + m.index + 2,
      contentTo: lineFrom + m.index + m[0].length - 2,
    });
  }

  // Italic: _..._
  const italicRe = /(?<![a-zA-Z0-9])_(.+?)_(?![a-zA-Z0-9])/g;
  while ((m = italicRe.exec(fullLine)) !== null) {
    tagRanges.push({
      from: lineFrom + m.index,
      to: lineFrom + m.index + m[0].length,
      contentFrom: lineFrom + m.index + 1,
      contentTo: lineFrom + m.index + m[0].length - 1,
    });
  }

  // Italic: *...* (single asterisk, not bold **)
  const italicStarRe = /(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g;
  while ((m = italicStarRe.exec(fullLine)) !== null) {
    tagRanges.push({
      from: lineFrom + m.index,
      to: lineFrom + m.index + m[0].length,
      contentFrom: lineFrom + m.index + 1,
      contentTo: lineFrom + m.index + m[0].length - 1,
    });
  }

  // If no tags, the whole content area is one zone
  if (tagRanges.length === 0) {
    if (absStart < lineFrom + lineText.length) {
      zones.push({ from: absStart, to: lineFrom + lineText.length });
    }
    return zones;
  }

  // Sort tag ranges by position
  tagRanges.sort((a, b) => a.from - b.from);

  // Build zones from text between/inside tags
  let cursor = absStart;
  for (const tag of tagRanges) {
    if (tag.from > cursor && cursor >= absStart) {
      zones.push({ from: cursor, to: tag.from });
    }
    zones.push({ from: tag.contentFrom, to: tag.contentTo });
    cursor = tag.to;
  }

  // Text after the last tag
  if (cursor < lineFrom + lineText.length) {
    zones.push({ from: cursor, to: lineFrom + lineText.length });
  }

  // Remove zones fully contained within another (keep innermost for nested tags)
  zones.sort((a, b) => (a.to - a.from) - (b.to - b.from));
  const filtered = [];
  for (const zone of zones) {
    const contained = filtered.some(f => f.from <= zone.from && f.to >= zone.to && (f.from !== zone.from || f.to !== zone.to));
    if (!contained) {
      for (let i = filtered.length - 1; i >= 0; i--) {
        if (zone.from <= filtered[i].from && zone.to >= filtered[i].to) {
          filtered.splice(i, 1);
        }
      }
      filtered.push(zone);
    }
  }

  filtered.sort((a, b) => a.from - b.from);
  return filtered;
}

// --- Find the zone containing a position ---
function findZone(zones, pos) {
  for (const z of zones) {
    if (pos >= z.from && pos <= z.to) return z;
  }
  return null;
}

// --- Selection clamping via transactionFilter (synchronous, no flicker) ---
let _clampCount = 0;
const selectionClamp = EditorState.transactionFilter.of((tr) => {
  if (!tr.newSelection) return tr;

  const zones = tr.startState.field(editableZonesField);
  if (zones.length === 0) return tr;

  // Safety: detect runaway filter loops (shouldn't happen, but protects Safari)
  _clampCount++;
  if (_clampCount > 100) {
    console.warn('[CLAMP] runaway detected — breaking out');
    _clampCount = 0;
    return tr;
  }
  setTimeout(() => { _clampCount = 0; }, 0);

  const sel = tr.newSelection.main;

  // Only clamp range selections (not cursor placement)
  if (sel.anchor === sel.head) return tr;

  const anchorZone = findZone(zones, sel.anchor);
  if (!anchorZone) return tr;

  // If head is already in the same zone, no clamping needed
  if (sel.head >= anchorZone.from && sel.head <= anchorZone.to) return tr;

  // Clamp head to anchor's zone boundaries
  const clampedHead = Math.max(anchorZone.from, Math.min(anchorZone.to, sel.head));
  if (clampedHead === sel.anchor) return tr; // Would collapse to cursor

  // Return a single spec with the clamped selection (avoids the overhead of
  // returning [tr, {selection}] which can cause stutter on rapid mouse events)
  return { selection: EditorSelection.single(sel.anchor, clampedHead), scrollIntoView: tr.scrollIntoView };
});

// --- Edit protection via transactionFilter ---
// Blocks transactions where any change falls outside editable zones.
const editProtection = EditorState.transactionFilter.of((tr) => {
  if (!tr.docChanged) return tr;

  const zones = tr.startState.field(editableZonesField);
  if (zones.length === 0) return tr;

  let blocked = false;
  tr.changes.iterChanges((fromA, toA) => {
    const zone = findZone(zones, fromA);
    if (!zone) { blocked = true; return; }
    if (toA > zone.to) { blocked = true; return; }
  });

  if (blocked) return [];
  return tr;
});

// --- Export ---
export function constraintExtension() {
  return [editableZonesField, selectionClamp, editProtection];
}

export { setZones, computeEditableZones as recomputeZones };
