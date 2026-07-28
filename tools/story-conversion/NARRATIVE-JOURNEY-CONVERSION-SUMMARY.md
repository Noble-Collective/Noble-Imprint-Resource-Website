# Narrative Journey — Conversion Summary

High-level, cross-book status & callouts for the Narrative Journey → Essentials
conversion to the shared-content "final format." One section per book. For the detailed
pipeline/process, see `CONVERSION.md`.

- **Purpose of this doc:** a running list of what's missing/incomplete, source-manuscript
  typos found (reproduced faithfully — to be fixed in the Google Docs, not by the converter),
  and other editorial callouts/decisions worth tracking per book.
- **Convention:** "typos in source Docs" = present in the manuscript and reproduced verbatim;
  fix them at the source. "Editorial callouts" = decisions, placeholders, or omissions.

_Last updated: 2026-07-28._

---

## Book 1 — The Story Behind It All  (Christian Belief · Apostles' Creed)

**Status:** COMPLETE & deployed. 12 sessions + Front Matter / Opening / Recall / Further
Resources. `completeness.py` = 12/12 at 100%.

**Missing / incomplete:**
- Passage Outlines: headings present, content empty in the manuscripts (all sessions).
- The Recall's Growth-Evaluation rubric grid could not be recovered from the flattened Doc
  export (per-level cells lost) — rendered as a 5-metric legend instead.

**Editorial callouts:**
- Copyright year is a placeholder (**2024**) — confirm the real year.
- Omitted a Community-specific epigraph/dedication from the front matter.
- S1 Catechism was **inferred** from the v07 print PDF (absent from the Google Doc).
- S1 "Personal Lament" spiritual-practice text came from the print **template PDF** (not in
  the Doc).
- Per-session creed bold + active practice dot: only S1 has them (`active="Lament"`, creed
  `bold=`); sessions 2–12 have none by decision.

**Typos in source Docs (reproduced faithfully):**
- S2: "**u**ltimate **r**eality" first-letter-bold export artifact (normalized to "ultimate
  reality").

---

## Book 2 — The Best Possible Life  (Christian Living · Ten Commandments)

**Status:** DEPLOYED (hidden), 2026-07-28. Built the final format IN PLACE, `status: hidden`,
banner `Pre-Release`. Content repo `ff7db09` pushed + `/api/refresh` OK; website tooling `2673dc3`.
- **12 sessions** (`01-The-Way … 12-The-Contest`): converted, placed, verified —
  `completeness.py` = **12/12 at 100%**; structural sweep clean (5 infographics + 5 movement
  intros + Ten Commandments creed each; 0 stray tags).
- **The Opening / The Recall:** converted from book-2 Google Docs & placed.
- **Creed:** the **Ten Commandments** (Exodus 20:1–17), book-level in `commonBook.md`.
- **Accent:** `#00854a` (green, from the old-copy PDF + cover).
- Old preview `session1.md` removed.

**Missing / incomplete:**
- **Further Resources:** shipped as a **heading-only placeholder** (book-2 session headings,
  empty bodies) — its Google Doc still holds book 1's bibliography/reading plan, so real
  content is pending an updated book-2 Doc.
- **Passage Outlines:** headings present, content empty in the manuscripts (all sessions).

**Front Matter:** DONE — rebuilt from the authoritative **Bond Between Us PDF** (the "Series
Orientation"), not from book 1. Now a fully-generic shared pair in `commonSeries.md`
(`<SeriesIntroduction>` incl. an all-books summary **table**, `<SessionOverview>`); both books
`@include` them; only title/copyright inline. Copyright year `2024` placeholder.

**⚠️ Book 1 correction (affects the LIVE book):** book 1's published Series Orientation was an
abbreviated/altered version — it had dropped the generic all-books summary table and several
paragraphs, and trimmed the Session-Overview movement descriptions. Book 1's `00-Front-Matter.md`
has now been **corrected** and wired to the same shared blocks, so its front matter renders the
full authoritative version. Review this live after push.

**Editorial callouts:**
- Per-session creed bold + active practice dot: **none** on any of the 12 (book-1 convention).
- S1 "Reflective Walk" practice title was unstyled in the Doc; converter now promotes such a
  line to a `####` heading.
- Copyright year placeholder (mirroring book 1's 2024) — confirm.

**Typos in source Docs (reproduced faithfully — fix in the Google Docs):**
> ⚠️ These are **incidental findings**, not a full proofread. Session 1 was reviewed closely
> and Session 5 surfaced via an attribution warning; sessions 2–4 and 6–12 were verified for
> completeness (100% word coverage) but **not** line-by-line proofed, so more source typos may
> exist. `completeness.py` confirms no words were dropped; it does not catch misspellings.
- S1 synopsis "Redemption" row: `rest (1:93:1)` → should be `1:9; 3:1`.
- The Opening: "aAn heir" (should be "An heir"); "leads tointo idolatry"; "Chrisitan" →
  "Christian"; an unfilled editorial line "PSALM INTRODUCTION: Psalm 15, 128".
- The Recall: "brotherly kind- ness" (export hyphenation artifact in the 2 Peter 1:5–8 quote).

**PDF typos corrected in the shared front-matter blocks** (fixed, not reproduced — the Bond
PDF is a build artifact, not a live source): `Chrisitanity`→`Christianity`, `Christiain`→
`Christian`, plus formatting artifacts `journal- like`, `(meta) narrative`, and the volume
title `The Story Behind it All`→`…It All`.

---

## Cross-book / tooling notes
- Converter fixes made during book 2 that also help book 1: `split_attr` now handles author
  names with leading initials ("J. C. Ryle") and a closing quote/paren between terminal
  punctuation and a scripture ref (`…willing." Isaiah 30:15`).
- Shared content (5 infographics, 5 movement intros, section directions, shared question
  sets) lives once in `Narrative Journey Series/commonSeries.md` and is `@include`d by every
  book — nothing is recreated per book. Each book's creed is book-level in its `commonBook.md`.
