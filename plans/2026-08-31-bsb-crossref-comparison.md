# BSB Compare: add \r cross-reference (parallel-passage) comparison

**Date:** 2026-08-31
**Status:** DONE + deployed

## Why
The Compare-to-BSB tool checked verse text, `\s` headings, and `\f` footnotes — but NOT the
`\r` parallel-passage cross-reference lines (e.g. "(Psalm 38:1–22)" under a heading). Those
still said "Psalms" (plural) in our copy from the older BSB USFM edition we imported, and the
tool silently reported "identical" for them. Steve: "I'd like ALL compared" — the tool is the
source-of-truth validator, so it shouldn't skip a whole class of content. It reads our SFM
straight from the content repo (not an ingested DB), so `\r` is already in-hand — just parse it.

## What
- `bible-validation.js`: `extractCrossRefs(usfm)` → `{text, raw, ref}` (ref = section-start
  verse). `crossRefRaw()` reduces `\ref display|target\ref*` to display text, preserves Unicode
  punctuation, and trims cosmetic space just inside parens ("( Matthew" → "(Matthew") so the
  official's inconsistent spacing (e.g. MAL) doesn't surface as a false diff. `diffStructure`
  gains `opts.crossRefs` (default on) + `booksWithCrossRefDiffs` / `crossRefs` totals + per-book
  `crossRefs.onlyInOurs/onlyInOfficial`.
- `bible-sync.js`: `replaceCrossRefInUsfm` (match by normalized reduced text, write official raw,
  keep our plain-text style) + `usfm-crossref` handled in `applyChange` and `applyBatch`.
- `bible-compare.js`: enables crossRefs; structure step detail mentions cross-references; book
  slice lifted 40→66 (more books differ now).
- `admin.js` (v18): `structRows` handles a third "Cross-reference" kind (type `usfm-crossref`,
  Accept offered when paired); new "Books w/ cross-ref diffs" tile; per-book cross-ref rows;
  refresh-all includes `usfm-crossref`.

## Result (verified on real data, 2026-08-31)
41/66 books identical; **25 books** with cross-ref diffs, **90 items**. All legitimate:
mostly "Psalms N:N" → "Psalm N:N"; plus "Song" → "Song of Solomon" (×2) and em-dash → en-dash
chapter ranges (×2, Hebrews). No false diffs (MAL paren-space resolved). 88 unit tests pass;
headless UI check: tile=25, 90 Accept cards, no errors. WRITE path (Accept/Refresh) unexercised
by me — left for a human, same as the other structure applies.

## Not done (noted for later)
Still uncompared: `\d` superscriptions (psalm titles), `\ms`/`\mr` major-section headers,
`\qa` acrostic labels. Offered to Steve as a follow-up if he wants literally everything compared.
