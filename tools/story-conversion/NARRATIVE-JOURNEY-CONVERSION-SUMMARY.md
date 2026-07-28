# Narrative Journey — Conversion Summary

High-level, cross-book status & callouts for the Narrative Journey → Essentials
conversion to the shared-content "final format." One section per book. For the detailed
pipeline/process, see `CONVERSION.md`.

- **Purpose of this doc:** a running list of what's missing/incomplete, source-manuscript
  typos found (reproduced faithfully — to be fixed in the Google Docs, not by the converter),
  and other editorial callouts/decisions worth tracking per book.
- **Convention:** "typos in source Docs" = present in the manuscript and reproduced verbatim;
  fix them at the source. "Editorial callouts" = decisions, placeholders, or omissions.

_Last updated: 2026-07-28 (book 3, The Open Invitation, converted & verified)._

---

## Shared / common-element change log (self-authored edits)

Every edit I made **on my own** to content shared across sessions/books (kept out of the
per-book lists). "Edit" = any deviation from a verbatim copy of the source: typo fixes,
reformatting, reflow, omissions, rewordings, structural choices. Source in parentheses.

### `commonSeries.md` → `<SeriesIntroduction>`  (source: Bond PDF, "Series Orientation", pp. 9–13)
- Typo fix: `Chrisitanity` → `Christianity` (¶1).
- Reworded cross-reference: `(see series summary on previous page)` → `(see series summary above)`
  (the table now sits inline above that sentence, not on a prior page).
- Hyphenation-artifact fix: `journal- like` → `journal-like`.
- Collapsed em-dash spacing everywhere: `— ` / ` —` → `—` (e.g. table taglines `belief— built`
  → `belief—built`).
- Normalized curly quotes/apostrophes to straight (`’ ‘` → `'`, `“ ”` → `"`).
- Rendered the all-books "series summary" as **three per-subseries blocks** (Foundations,
  Essentials, Pathways), each a 1-cell heading table (`Narrative Journey FOUNDATIONS` /
  `ESSENTIALS` / `PATHWAYS`) followed by a 2-column body table with **no header row** — the
  front-end merges each pair into one table (colspan heading, empty header stripped; same
  pattern as the Session Synopsis). First body row of each block = the subseries **tagline +
  descriptor** (from the PDF); remaining rows = one volume + its focus line.
  [revised 2026-07-28 per Steve — was a single 3-column table; the per-subseries descriptors
  are now INCLUDED, not dropped.]
- [2026-07-28, per Steve] Added a **6th Essentials volume** row — **The Kingdom Come** — tagline
  "Kindles the missional heartbeat of Christian witness—commissioned to declare the coming
  kingdom." (I authored the tagline from a passage Steve supplied; he chose this of 3 options.)
- [2026-07-28, per Steve] Updated intro ¶2's Essentials topic list: `…community, and devotion`
  → `…community, devotion, and witness` (to account for the new witness/mission volume).
- [2026-07-28, per Steve] Bolded `Session Overview` in the "fivefold, multimodal layout …
  (see **Session Overview** for more detail)" sentence.
- [2026-07-28, per Steve] Matched the Bond-PDF **body emphasis**: italicized every
  `Narrative Journey` in prose + descriptor rows (14×; table headings left plain), italicized
  the subseries names (`Foundations` / `Essentials` / `Pathways`) where ¶2 names them.
  NOT yet done: the volume titles are **bold** in the PDF's summary table — awaiting Steve's
  go-ahead to bold the table's title column.

### `commonSeries.md` → `<SessionOverview>`  (emphasis, 2026-07-28, per Steve)
- Bolded the in-prose movement-name references (all five: `**Biblical Interpretation: Hearing
  the Word**`, `**Theological Dialogue: Discussing the Plot**`, `**Personal Reflection:
  Entering the Story**`, `**Ministry Practice: Rehearsing the Script**`, `**Missional Outreach:
  Publicizing the Truth**`) and the word `**Introduction**`.
- Italicized `_formative hermeneutic_` and the `_Narrative Journey_` mention in the closing.

### `commonSeries.md` → `<NarrativeJourneySeriesList>` + `<PublishingLicensing>` (new, 2026-07-28, per Steve)
- **`<NarrativeJourneySeriesList>`** — the front-matter "A Narrative Journey Series" page (PDF
  p.1): subseries labels italic (`_Foundations_` / `_Essentials_` / `_Pathways_`) + a bullet
  list of each volume with its "A Narrative Journey of Christian ___" subtitle. Normalized
  `Behind it All`→`It All`. **Added The Kingdom Come** (not in the PDF) with a proposed subtitle
  `A Narrative Journey of Christian Witness` — confirm the subtitle.
- **`<PublishingLicensing>`** — shared copyright/licensing text supplied by Steve: first line
  `Series: A Narrative Journey`, then © 2026 / CC BY-SA / Noble Imprint+Collective / BSB public
  domain. **Corrected the license URL** `…/licenses/bysa/4.0/` → `…/licenses/by-sa/4.0/`
  (Steve's message had `bysa`; the working CC URL is `by-sa`) — confirm.

### Book front matter restructure (both Essentials books, 2026-07-28, per Steve)
- New top-of-front-matter order: `## Introductory Quotes` (empty placeholder) → `## A Narrative
  Journey Series` (@include NarrativeJourneySeriesList) → `## Publishing and Licensing`
  (`_<Title>_, Pre-Release Edition` + @include PublishingLicensing) → `## Series Introduction`
  → `## Session Overview`.
- **Removed** the old `## <Title>` / subtitle / "Narrative Journey Series · Essentials" title
  block and the old `## Copyright` block. ← the title-page block was dropped since the new
  order (series list + Publishing line) covers that identification; say if you want a title
  page kept.
- © year is now **2026** (was the `2024` placeholder).
- Corrected a volume title in the table: `The Story Behind it All` → `The Story Behind It All`.
- Typo fix (in the now-included Essentials descriptor): `Christiain belief` → `Christian belief`.
- Merged two paragraphs the PDF had split across a page break into single paragraphs: the
  "In general … enriched" + "the experience with additional …" paragraph, and the
  "records/journal …" paragraph (pp. 11–12).
- **Placement:** put the three summary blocks after ¶2 (the three-subseries paragraph); the PDF
  had the summary as a full-page insert in the middle of ¶3.
- Stripped running headers/footers/page numbers; collapsed multiple spaces to one.

### `commonSeries.md` → `<SessionOverview>`  (source: Bond PDF, pp. 15–18)
- Converted the five ALL-CAPS two-line movement headings to Title-Case H3s joined by a colon,
  e.g. `BIBLICAL INTERPRETATION` / `HEARING THE WORD` → `### Biblical Interpretation: Hearing the
  Word` (same for the other four movements).
- Merged the Missional Outreach paragraph split across pp. 17–18 into one.
- Fixed `(meta) narrative` → `(meta)narrative` (Missional Outreach body).
- Same global normalizations: curly→straight quotes, em-dash spacing, collapsed whitespace,
  stripped headers/footers/page numbers.

### `The Best Possible Life/commonBook.md` → `<TenCommandments>`  (source: old-copy PDF, p. 19)
- Stripped the divine-speech quotation marks from each line (clean creed lines). ← *your approved
  choice ("clean lines, no quote marks"), listed here for completeness.*
- Reconstructed each commandment (+ the preface and prologue) into one logical line from the
  PDF's wrapped lines — 12 lines total.
- Normalized curly quotes/apostrophes to straight.
- Attribution line I authored: `<< The Ten Commandments (Exodus 20:1–17)` — I used an en-dash in
  the range; the PDF wrote a hyphen (`20:1-17`).
- Added two trailing spaces per line (markdown hard line breaks), matching the ApostlesCreed block.

### History (superseded within this session, not in the committed content)
- I first built `<SeriesIntroduction>` / `<SessionOverview>` from **book 1's abbreviated front
  matter**, then **replaced** them with the authoritative Bond-PDF versions above once we found
  book 1's was incomplete. Only the Bond-PDF versions are committed.

---

## Flagged for inspection (found, NOT changed)

Things I noticed but deliberately left alone — for you to inspect/decide.

- **Book 1 front matter is now different on the LIVE public site.** Correcting it to the full
  authoritative Series Orientation changed a `status: public` book's output. Please review live.
- **Copyright year `2024`** is an unverified placeholder in BOTH books' front matter.
- **Further Resources (book 2):** its Google Doc still contains book 1's bibliography/reading
  plan; I shipped a heading-only placeholder rather than convert stale content.
- **"PSALM INTRODUCTION: Psalm 15, 128"** appears as an unfilled editorial line in book 2's
  The Opening (looks like an author placeholder, not final content).
- **Sessions 2–12 (book 2) were not line-by-line proofread** — only completeness-verified
  (100% word coverage). More source-Doc typos may exist beyond the ones listed per book.
- ~~Test Book churn~~ / ~~dropped subseries descriptors~~ — resolved: churn is harmless
  (no action needed); descriptors are now included in the three subseries tables.

---

## Book 1 — The Story Behind It All  (Christian Belief · Apostles' Creed)

**Status:** COMPLETE & deployed. 12 sessions + Front Matter / Opening / Recall / Further
Resources. `completeness.py` = 12/12 at 100%.

**Changed 2026-07-28 (LIVE):** `00-Front-Matter.md` was rewritten to `@include` the shared
`<SeriesIntroduction>` / `<SessionOverview>` blocks, replacing its inline (abbreviated) copy —
so book 1 now renders the full authoritative Series Orientation (incl. the all-books table).
Title + Copyright unchanged. Nothing else in book 1 was touched. (Edits to the shared blocks
themselves are in the "Shared / common-element change log" above.)

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

## Book 3 — The Open Invitation  (Christian Formation · Lord's Prayer)

**Status:** Converted & verified locally, 2026-07-28 (deploy pending Steve's go-ahead). Built the
final format IN PLACE in the existing `Essentials/The Open Invitation/` folder. `status: public`
(Steve's call — build public, not hidden), banner `Pre-Release`. The old preview `session1.md`
was removed.
- **12 sessions** (`01-The-Temple … 12-The-Sabbath`): converted, placed, verified — structural
  sweep clean (5 infographics + 5 movement intros + 1 LordsPrayer creed each; 0 stray tags; 0
  open includes; 13–15 inline `<Question>` per session). All 22 `@include` keys per session
  resolve via the REAL parser (0 leftover) and `renderMarkdown` cleanly.
- **`completeness.py`:** every session reports exactly **1 unmatched source word — "question"** —
  which is the intentional `Catechism Question → Catechism` label normalization (the word
  "Question" is dropped by design; see below). Otherwise 100% word coverage. (This is why the
  raw report says "CHECK", not "OK 100%", for all 12 — it is benign and fully explained.)
- **Creed:** the **Lord's Prayer** (Matthew 6:9–13), book-level in `commonBook.md` as
  `<LordsPrayer>`. Format = **Steve's Option A**: keeps the scriptural lead-in "Pray then like
  this:" as the first line + one petition per line (11 lines), quotation marks stripped, hard
  line breaks, attribution `<< The Lord's Prayer (Matthew 6:9–13)`. Only the creed text came
  from the interior PDF (`The Open Invitation_Interior_v18 (1).pdf`, p.18/19).
- **Accent:** `#be9d26` (gold) — verified present in the PDF's colored text; all heading colors
  set to it, `"accent"` key added.
- **Front Matter:** built in the §12 structure — `@include`s the shared
  `NarrativeJourneySeriesList` / `PublishingLicensing` / `SeriesIntroduction` / `SessionOverview`;
  only the Publishing title line + Introductory Quotes are inline/book-specific.
- **The Opening:** genuine book-3 content (all 12 session titles, formation/Lord's-Prayer theme);
  converted & placed.

**Missing / incomplete:**
- **The Recall AND Further Resources:** shipped as **heading-only placeholders** (empty bodies) —
  ⚠️ **both** their Google Docs still contain **book 1's** content (The Recall reviews Job/
  Creation/Sin with a "foundation of the Christian life? Faith" catechism; Further Resources is
  book 1's bibliography + 48-week reading plan for The Battle…The Finale). Neither is this book's
  material. Per Steve (2026-07-28): ship heading-only placeholders pending updated book-3 Docs.
  `13-The-Recall.md` = generic Recall framework headings; `14-Further-Resources.md` = per-session
  `#### Session N: <title>` subheadings under Bibliography + Reading Plan. Provide real book-3
  Recall/Further Docs to fill these.
- **Passage Outlines:** headings present, content empty in the manuscripts (all sessions).

**Book-specific conversion notes (per Steve — log anything like these here):**
- **S10 Doc H1 mislabel:** the Session 10 Google-Doc's H1 read "Session 10: **The Temple**" (a
  copy-paste of Session 1's title); its content is unmistakably **The Scroll** (Luke 4:14–44,
  "Unrolling the Scroll"). Corrected the H1 to "The Scroll" at conversion (edited the local
  `docs/session10.md` export). **Fix this in the source Google Doc** or a re-export reverts it.
- **Catechism label normalized:** all 12 Docs write the Key-Elements run-in label as
  "**Catechism Question**"; per Steve the bold term should be uniform across books, so `convert.py`
  now normalizes any `Catechism…` label to just "**Catechism**" (drops "Question"). This is the
  sole `completeness.py` word delta noted above. (The previous books already used "Catechism".)

**Editorial callouts:**
- **Introductory Quotes reused from book 2:** this book's PDF page 1 has the *same* two epigraphs
  as The Best Possible Life (Augustine, _Confessions_ + 1 Peter 2:11–12). Per Steve, reuse them —
  but kept **inline in this book's `00-Front-Matter.md`** (NOT extracted to a shared/common file),
  like the other books. Confirm later whether the identical epigraph page was intentional or a
  template copy.
- Per-session creed bold + active practice dot: **none** on any of the 12 (series convention).
- S1 "Reflective Walk" practice title was unstyled in the Doc; the converter promotes it to a
  `####` heading (existing rule).

**Typos in source Docs (reproduced faithfully — fix in the Google Docs):**
> ⚠️ Incidental findings, not a full proofread. Session 1 was reviewed closely; sessions 2–12 and
> the matter were completeness-verified (100% word coverage) but not line-by-line proofed.
- The Opening: **heading "Faith Foundation: ExploreExploring the Terrain"** — "Explore"/"Exploring"
  concatenated in the Doc (a revision artifact). **CORRECTED** in the converted file + local
  `docs/opening.md` export to "Faith Foundation: Exploring the Terrain" to match the identical
  framework heading in books 1 & 2 (per Steve). The source Google Doc still has the typo — fix it
  there too, or a re-export reintroduces it. (This framework heading is shared-in-structure across
  all books, so the sibling books are the authority for its correct form.) "Mark 6:30-56" is
  missing its closing paren ("(Mark 6:30-56 —" in the Core-Content
  list); a double space in "move us  more Godward"; the Lord's Prayer is cited as
  "Matthew 6:9-14" in the Opening prose (the creed page and elsewhere use 6:9-13).

**Shared / common content:** NOTHING in `commonSeries.md` (or any cross-book shared block) was
changed for this book — all shared blocks (5 infographics, 5 movement intros, question sets,
Series Introduction / Session Overview / series list / Publishing & Licensing) were reused
verbatim via `@include`. Hence no new entries in the shared change log above.

---

## Cross-book / tooling notes
- Converter fixes made during book 2 that also help book 1: `split_attr` now handles author
  names with leading initials ("J. C. Ryle") and a closing quote/paren between terminal
  punctuation and a scripture ref (`…willing." Isaiah 30:15`).
- Converter change made during book 3 (benefits all books): the Key-Elements bullet handler now
  normalizes any `Catechism…` run-in label to just "**Catechism**" so the bold term is uniform
  across books (per Steve). Books 1–2 already wrote "Catechism"; book 3's Docs wrote "Catechism
  Question".
- Shared content (5 infographics, 5 movement intros, section directions, shared question
  sets) lives once in `Narrative Journey Series/commonSeries.md` and is `@include`d by every
  book — nothing is recreated per book. Each book's creed is book-level in its `commonBook.md`.
- [2026-07-28, per Steve] **Website rendering change** (`src/renderer/parser.js` +
  `src/public/css/style.css`, cache-buster `v=79`): external `http(s)` links in prose now
  render underlined + in the book accent color (matching `.bible-ref`) and open in a new tab
  (`target="_blank" rel="noopener noreferrer"`). Applies site-wide; benign/additive.
- [2026-07-28, per Steve] **Book-specific front-matter content** (NOT shared): Publishing &
  Licensing line uses the full title + subtitle (`_<Title>: A Narrative Journey of Christian
  <Domain>_, Pre-Release Edition`); Introductory Quotes populated per book from each book's
  interior PDF (Story: Chesterton/Tolkien/Lewis; Best: Augustine/1 Peter 2:11–12).
