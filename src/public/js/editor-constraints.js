// Noble Imprint — Selection & Edit Constraints for Suggest-Comment Users
// Restricts editing to within a single line and within the innermost markdown tag boundary.
// Prevents edits from spanning or breaking structural syntax.
import { EditorView, EditorState, StateField, StateEffect } from '/static/js/codemirror-bundle.js';

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
  const text = doc.toString();
  const zones = [];

  // Process each line
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

    // Parse the line into segments: tag markers and editable text
    const lineZones = parseLineZones(lineText, lineFrom);
    zones.push(...lineZones);
  }

  return zones;
}

// Parse a single line into editable zones, respecting nested tags.
// Returns array of { from, to } ranges representing editable text within tag boundaries.
function parseLineZones(lineText, lineFrom) {
  const zones = [];

  // First strip any line-level prefix (##, <<, >)
  let contentStart = 0;
  const headingMatch = lineText.match(/^(#{1,5})\s+/);
  const attrMatch = lineText.match(/^<<\s+/);
  const bqMatch = lineText.match(/^>\s*/);

  if (headingMatch) contentStart = headingMatch[0].length;
  else if (attrMatch) contentStart = attrMatch[0].length;
  else if (bqMatch && lineText.trim() !== '>') contentStart = bqMatch[0].length;

  const content = lineText.substring(contentStart);
  const absStart = lineFrom + contentStart;

  // Now parse the content for inline tags: <Question...>...</Question>, <Callout>...</Callout>,
  // **bold**, _italic_, and nested combinations.
  // Build a tree of tag ranges, then extract leaf editable zones.

  const tagRanges = []; // { from, to, contentFrom, contentTo } — absolute positions

  // Question blocks (can span lines but usually on one)
  let m;
  const questionRe = /<Question\s+id=[^>]+>/g;
  questionRe.lastIndex = 0;
  const fullLine = lineText;
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

  // If no tags on this line, the whole content area is one zone
  if (tagRanges.length === 0) {
    if (absStart < lineFrom + lineText.length) {
      zones.push({ from: absStart, to: lineFrom + lineText.length });
    }
    return zones;
  }

  // Sort tag ranges by position
  tagRanges.sort((a, b) => a.from - b.from);

  // Build zones: text between/outside tags, and content inside each tag
  let cursor = absStart;
  for (const tag of tagRanges) {
    // Text before this tag (if any, and if it's within our content area)
    if (tag.from > cursor && cursor >= absStart) {
      zones.push({ from: cursor, to: tag.from });
    }
    // Content inside the tag — but check for nested tags
    // For simplicity, add the content area as a zone. Nested tags within
    // the content will be handled by the innermost tag taking precedence.
    zones.push({ from: tag.contentFrom, to: tag.contentTo });
    cursor = tag.to;
  }

  // Text after the last tag
  if (cursor < lineFrom + lineText.length) {
    zones.push({ from: cursor, to: lineFrom + lineText.length });
  }

  // Remove zones that are fully contained within another zone (keep innermost only for nested tags)
  // Sort by size ascending so smaller (inner) zones come first
  zones.sort((a, b) => (a.to - a.from) - (b.to - b.from));
  const filtered = [];
  for (const zone of zones) {
    // Check if any already-added zone fully contains this one
    const contained = filtered.some(f => f.from <= zone.from && f.to >= zone.to && (f.from !== zone.from || f.to !== zone.to));
    if (!contained) {
      // Remove any previously-added zone that this one fully contains
      for (let i = filtered.length - 1; i >= 0; i--) {
        if (zone.from <= filtered[i].from && zone.to >= filtered[i].to) {
          filtered.splice(i, 1);
        }
      }
      filtered.push(zone);
    }
  }

  // Re-sort by position
  filtered.sort((a, b) => a.from - b.from);
  return filtered;
}

// --- Find the zone containing a position (with 2-char tolerance for atomic range boundaries) ---
function findZone(zones, pos) {
  // Exact match first
  for (const z of zones) {
    if (pos >= z.from && pos <= z.to) return z;
  }
  // Nearby match (cursor may land just outside a zone due to atomic ranges)
  for (const z of zones) {
    if (pos >= z.from - 2 && pos <= z.to + 2) return z;
  }
  return null;
}

// --- Selection constraint: clamp DRAG selections to zone boundaries ---
// Single clicks (cursor positioning) are always allowed.
// Only range selections (anchor !== head) are clamped.
const selectionConstraint = EditorState.transactionFilter.of((tr) => {
  if (tr.docChanged) return tr;
  if (!tr.selection) return tr;

  const sel = tr.selection.main;
  // Single click / cursor move — always allow
  if (sel.anchor === sel.head) return tr;

  const zones = tr.startState.field(editableZonesField);
  if (zones.length === 0) return tr;

  const anchorZone = findZone(zones, sel.anchor);
  if (!anchorZone) return tr; // Anchor outside any zone — don't interfere

  const headZone = findZone(zones, sel.head);
  // Both in same zone — allow
  if (headZone && anchorZone.from === headZone.from && anchorZone.to === headZone.to) return tr;

  // Clamp head to the anchor's zone
  const clampedHead = Math.max(anchorZone.from, Math.min(anchorZone.to, sel.head));
  if (clampedHead === sel.anchor) return tr; // Would collapse to cursor — just allow
  return [{ selection: { anchor: sel.anchor, head: clampedHead } }];
});

// --- Transaction filter: reject edits that span zone boundaries ---
const editFilter = EditorState.transactionFilter.of((tr) => {
  if (!tr.docChanged) return tr;

  const zones = tr.startState.field(editableZonesField);
  if (zones.length === 0) return tr;

  // Check each change in the transaction
  let dominated = false;
  tr.changes.iterChanges((fromA, toA, fromB, toB, inserted) => {
    // Find the zone for the change start position
    const zone = findZone(zones, fromA);
    if (!zone) {
      dominated = true; // Edit outside any zone — block it
      return;
    }
    // Check the change doesn't extend beyond the zone
    if (toA > zone.to) {
      dominated = true;
      return;
    }
  });

  // If edit spans zone boundaries, block it by returning empty transaction
  if (dominated) return [];
  return tr;
});

// --- Export: returns extensions for suggest-comment constraint mode ---
export function constraintExtension() {
  return [editableZonesField, selectionConstraint, editFilter];
}

export { setZones, computeEditableZones as recomputeZones };
