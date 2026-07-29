# Narrative Journey — Conversion Summary

High-level, cross-book status & callouts for the Narrative Journey → Essentials
conversion to the shared-content "final format." One section per book. For the detailed
pipeline/process, see `CONVERSION.md`.

- **Purpose of this doc:** a running list of what's missing/incomplete, source-manuscript
  typos found (reproduced faithfully — to be fixed in the Google Docs, not by the converter),
  and other editorial callouts/decisions worth tracking per book.
- **Convention:** "typos in source Docs" = present in the manuscript and reproduced verbatim;
  fix them at the source. "Editorial callouts" = decisions, placeholders, or omissions.

_Last updated: 2026-07-29 (The Opening shared-content refactor — 16 `Opening_*` blocks, the
book-colored Five Movements SVG, Bond-style Core-Content / Planning-Calendar tables, each book's
creed dropped into the Opening Overview; applied across books 1–3. Follows the 2026-07-28 book-3
conversion + The Recall 17-block refactor. Book 4 "The Bond Between Us" inputs gathered — see its
section below.)_

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

### `commonSeries.md` → The Recall shared framework (2026-07-28, per Steve)
The Recall (`13-The-Recall.md`) previously duplicated ~44% identical framework text inline across
books 1 & 2 with **zero** `@include` use. Extracted the identical framework into **17 new
`commonSeries.md` blocks** and wired books 1 & 2 to `@include` them (headings stay inline for
readability; book-specific parts — Conclusion, Key Elements, the Selected Passages / Recommended
Reading lists, Creedal Confession/Code of Conduct, and the Growth-Evaluation rubric — stay inline).
Verified a **pure refactor**: resolved output byte-identical (book 1) / content-identical (book 2)
to the originals. Blocks (underscore-keyed — see the parser change in tooling notes):
`Recall_BookOverview_{Directions,KeyIdea,StoryRetell,NarrativeReview}`,
`Recall_FaithFoundation_{Directions,DiscussionDirections,DiscussionQuestions,SignificantInsights}`,
`Recall_LearningPlan_{Directions,SelectedPassages,RecommendedReading}`,
`Recall_CoreProject_{Directions,JournalReflection}`,
`Recall_FaithPractice_{Directions,GrowthEvaluation,NextSteps,CommunityPrayer}`.
- **`Recall_FaithFoundation_DiscussionQuestions`** holds the 4 review questions with `{id}-Qn`;
  each book passes `id="{Book}Recall-Discussion"` (question text was identical across books; only
  ids differed).
- **`Recall_FaithPractice_NextSteps`** — the flat "Individual Family Church World" line was turned
  into **4 id-tagged `<Question id={id}-Qn>` blocks** (Individual/Family/Church/World); each book
  passes `id="{Book}Recall-NextSteps"`. (Once `{id}` is present the parser REQUIRES the param, so
  BOTH books' includes must pass an id or the page throws.)
- **`Recall_FaithPractice_GrowthEvaluation`** was later **trimmed to just the intro directions**
  (the 5-metric objective list moved into each book's rubric table — see below).

### The Recall — Growth-Evaluation rubric tables (2026-07-28, per Steve)
**Finding:** the Growth-Evaluation rubric had been stored as 5 flattened by-level paragraphs and
was **mis-themed**. Recovered the canonical grid from **The Bond Between Us PDF p.408**
(`find_tables`): rows = 5 metrics (Conviction/Commitment/Conduct/Community/Character) + an
objective, columns = Exemplary/Mature/Developing/Emerging/Unsound, cells = 25 descriptions.
- **Book 1 (The Story Behind It All):** its 4 columns Mature/Developing/Emerging/Unsound were
  genuinely belief-themed (reconstructed into grid cells by segmenting the flattened paragraphs);
  but its **Exemplary column had been overwritten with The Bond Between Us's community text**.
  Rebuilt as a markdown **table**; the Exemplary column is left as fill-in placeholders
  (`deep understanding of __________`, etc.) rather than fabricated. Metric names moved into the
  row labels (`**Conviction:** establish a mature Christian understanding of core Christian belief`).
- **Book 2 (The Best Possible Life):** its manuscript rubric was a **byte-for-byte copy of book 1's
  belief text** (a carry-over error), NOT living content. Per Steve, built book 2's table as the
  **common skeleton across the Bond (community) and Story (belief) grids** — every book-specific
  slot blanked as `__________` (a fill-in template), keeping only the frame common to both (levels,
  metric objectives, connectives like "grounded in core biblical teaching as a countercultural
  worldview"). Book 2's living-specific wording is to be filled into the 42 blanks later.
- Both rubric tables render as a wide 6-column HTML table (horizontal scroll on mobile).

### `commonSeries.md` → The Opening shared framework (2026-07-29, per Steve)
The Opening (`00-The-Opening.md`) duplicated the same directions/framework text inline across
books 1–3 (same pattern as The Recall). Extracted the identical framework into **16 new
`commonSeries.md` blocks** and wired books 1–3 to `@include` them (headings stay inline):
`Opening_BookOverview_Directions`, `Opening_CoreContent_Directions`, `Opening_KeyIdea_Directions`,
`Opening_PersonalInterest_Directions`, `Opening_FaithFoundation_Directions`,
`Opening_Discussion_Directions`, `Opening_SignificantQuote_Directions`,
`Opening_LearningPlan_Directions`, `Opening_SessionFramework_Intro`,
`Opening_PlanningCalendar_Directions`, `Opening_CoreProject_Directions`,
`Opening_ImaginativeStorytelling_Directions`, `Opening_FaithPractice_Directions`,
`Opening_GrowthOutcomes_Directions`, `Opening_FocusedArea_Directions`,
`Opening_CommunityPrayer_Directions`. Book-specific parts stay inline: Key Elements, the tables,
and the creed (see below).
- **`Opening_SessionFrameworkInfographic` — the Five Movements cycle SVG.** Built a self-contained
  inline SVG (5 nodes on a dashed ring with clockwise arrows; icons book/users/compass/feather/globe;
  bold dark titles + gray italic captions) modeled on the Bond PDF p.30 diagram. It uses
  `style="color: var(--accent, #8D4449)"` + `currentColor`, so it **auto-renders in each book's
  accent color** — nothing per-book. (Superseded an earlier accent-card attempt that Steve
  rejected as not matching the PDF; also an over-grab of book-specific prompts was reverted.)
- **Core Content → Bond-style table** (all 3 books): scripture refs moved onto their **own line
  inside the cell** (`<br>(Ref)`) per Steve. **Planning Calendar → Bond-style table** too.
- **Creed dropped into the Opening Overview** (books 2 & 3; book 1 already had its creed): each
  book's creed is **book-common** (`commonBook.md`, pulled via `@include: {CREED_KEY}`), NOT
  series-common — confirmed with Steve. Book 3's Project Preview → `Coming soon.`, "Example Creed"
  → "Example ____", the Lord's-Prayer placeholder → `Coming soon.`, and the Recall Conclusion →
  `Coming soon.` (Steve's edits, 2026-07-29).
- Verified a pure refactor (resolved output content-identical to the pre-refactor Openings apart
  from the intended table/creed/SVG additions).

### `src/renderer/parser.js` + `style.css` → Opening/Recall render support (2026-07-29)
- **Single-chapter Bible refs now link** (Jude / Philemon / 2 John / 3 John / Obadiah): a new pass
  emits `data-ref="Jude 1:3"` (implicit chapter 1) so the verse popup's `Book Chapter:Verse` API
  lookup resolves. (Fixed a "verse not found" on "Jude 3" in book 1's Scripture Memory.)
- **`.pc-table`** class auto-tagged onto tables whose first header is "Biblical Passage"
  (Planning Calendar), giving fixed column widths (Biblical Passage narrower, Teacher wider) per
  Steve. **Table header rows now use the darker accent** (`.session-content th` / `.reading-content
  th` bg `#f5f3ef`→`#eae6df`; `.accent-themed th` accent-tinted) so plain tables (Growth Evaluation)
  match the merged-heading tables. CSS cache-buster bumped to `v=81`.

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
- **"PSALM INTRODUCTION: Psalm 15, 128"** was an unfilled editorial line (author placeholder, not
  final content) in book 2's The Opening. **REMOVED** from the deployed
  `The Best Possible Life/sessions/00-The-Opening.md` (2026-07-28, per Steve). It only appeared in
  book 2 (nothing similar in books 1 or 3). The source Google Doc still has the line — delete it
  there too, or a re-export/re-conversion of book 2's Opening reintroduces it.
- **Sessions 2–12 (book 2) were not line-by-line proofread** — only completeness-verified
  (100% word coverage). More source-Doc typos may exist beyond the ones listed per book.
- **Recall Growth-Evaluation rubric has unfilled blanks (LIVE, both books).** Book 1's Exemplary
  column = 5 fill-in placeholders (`deep understanding of __________`, etc.) — its real Exemplary
  content was the mis-pasted Bond community text and was never recovered. Book 2's whole rubric =
  a 42-blank common skeleton awaiting its living-specific wording. Both are intentional fill-in
  templates on live pages; fill them when the real per-book cell text is available.
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
  "Christian". (The unfilled editorial line "PSALM INTRODUCTION: Psalm 15, 128" was REMOVED from
  the deployed file — see the "Flagged for inspection" section; still present in the source Doc.)
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

## Book 4 — The Bond Between Us  (Christian Community · A Christian Community Covenant)

**Status:** **DEPLOYED + PUBLIC 2026-07-29** (content repo `2aa69f1`, pushed to main →
notify-website.yml auto-refresh + manual `/api/refresh`; all 16 pages live 200). Built the final
shared-content format IN PLACE in `Essentials/The Bond Between Us/` (`status: public`, banner
`Pre-Release`, accent `#de6d36`, `order` 4). Old preview `session1.md` (was book-3 "The Temple")
removed.
- **12 sessions** (`01-The-Household … 12-The-Other`): `completeness.py` 11/12 at 100%; **S6** shows
  a benign 2-word delta — the source Doc heading is `**Observ**ation Questions` (first-letters-bold
  export artifact); the converter normalized it correctly to "Observation Questions" (same category
  as book-2 S2's `**u**ltimate`). Structural sweep clean (5 infographics + 5 movement intros + 1
  `CommunityCovenant` creed each; 0 stray tags; 12–18 `<Question>`).
- **Creed:** `<CommunityCovenant>` in `commonBook.md`, built from interior PDF p.20 via
  `scratchpad/build_creed.py` (two stanzas separated by a blank blockquote line, hard breaks,
  attribution `<< A Christian Community Covenant`).
- **The Opening & The Recall:** commonized per §2c (templated off book 3; all `Opening_*`/`Recall_*`
  includes + Five Movements SVG reused). Book 4 is the **home book** for genuine matter — first
  genuine Recall since book 2, and the **FIRST fully-populated community Growth-Evaluation rubric**
  (extracted from PDF p.408 via `scratchpad/build_matter.py`, 5 metrics × 5 levels, all
  relationship-themed; books 1–2 shipped blanks/skeletons).
- **Front Matter:** §12 structure; Introductory Quotes = **PDF p.1** (Augustine / Pascal / Donne /
  Baxter — all community-themed). ⚠ The kickoff/§13 said "1 Tim 3:14–15 + Spurgeon" for the
  front-matter quotes, but that pair is actually the **Opening's intro epigraphs (PDF p.21)**; used
  there. Publishing line "The Bond Between Us: A Narrative Journey of Christian Community".
- **Verification:** all 16 files resolve every `@include` + `renderMarkdown` via the REAL parser (0
  leftovers, 0 throws). Built via `scratchpad/build_matter.py` (pulls prose verbatim from Doc
  exports, rubric from PDF) — `convert_matter.py` was NOT run for Opening/Recall (still old format).

**Missing / incomplete (LIVE placeholders):**
- **Further Resources — heading-only placeholder** (Steve's call): its Doc's Reading Plan is stale
  **book-1** content (The Battle…Finale, 48-week Job/Genesis/Revelation). The Doc's **bibliography IS
  genuine book-4** (real per-session commentaries) and is available to convert later.
- **Opening Project Preview** → "Coming soon."; **Growth Outcomes + Imaginative Storytelling** left as
  the belief/truth-themed boilerplate (identical to what book 3 shipped) — flag for community-specific
  authoring.
- **Recall Core Project** — the Doc had an unauthored "Community Covenant: instructions" capstone
  subsection; kept book-3 structure (Journal Reflection include only). Recall Catechism set to the
  community Q/A (Doc had none).
- **Passage Outlines:** headings present, content empty in the manuscripts (all sessions).

**Corrected stale carryover:** Opening **Planning Calendar** was stale **book-1** sessions
(The Battle…Finale) → rebuilt from the genuine Core Content (book-4 sessions/passages). Opening
**Example Covenant** = PDF **p.33** text ("write your own community covenant" — the Doc's version said
stale "mission manifesto") + the `CommunityCovenant` include (Steve's call to drop in the real
example).

**Typos in source Docs (reproduced faithfully — fix in the Google Docs):**
- S1: "not be afriad" → **CORRECTED** to "afraid" (Steve's call, in both output + `docs/session1.md`);
  synopsis ref "18:12 15" → **CORRECTED** to "18:12–15". Source Doc still has both — fix there too.
- S6: heading `**Observ**ation Questions` first-letters-bold export artifact (converter normalized).
- Recall conclusion: passage refs disagree with the Opening/sessions — "Nehemiah 1:1–7:73" (Opening
  uses 1:1–7:4) and "Acts 16:11–17:33" for Session 11 (Opening uses 16:11–18:17).

**Shared / common content:** NOTHING in `commonSeries.md` was changed for this book — all shared
blocks (infographics, movement intros, question sets, Opening_*/Recall_*, Series Introduction /
Session Overview / series list / Publishing) reused verbatim via `@include`. No new shared change-log
entries. (Original build inputs preserved below.)

**Inputs (confirmed):**
- **Accent** `#de6d36` (orange) — from the interior PDF. Set all heading colors to it (mirror
  books 1–3); `meta.json` `"accent"`, `"banner": "Pre-Release"`.
- **Creed** = **A Christian Community Covenant** (interior PDF p.19 — the analog of book 3's
  Lord's-Prayer creed page). `CREED_KEY = "CommunityCovenant"`, book-level in `commonBook.md` as
  `<CommunityCovenant>`. Two stanzas (a 6-line "We prize…" stanza + a "We confess the church as
  Christ's family, a family called to:" stanza with 5 clauses). Attribution
  `<< A Christian Community Covenant`. Build it from the PDF with a small script (keep verse/creed
  text out of model output, per the book-2 content-filter lesson).
- **The Opening Key Elements** (PDF p.20): Key Passage = *Preview*; Scripture Memory = "We … are
  one body in Christ, and individually members one of another." (Romans 12:5); Catechism Q: "How
  are Christians to relate to one another?" A: **Community**.
- **The Opening Introductory Quotes / Introduction** (PDF pp.1, 21): epigraphs 1 Timothy 3:14–15 +
  Charles Spurgeon, *Satanic Hindrances*. (Front-matter Introductory Quotes come from PDF p.1.)
- `ID_PREFIX = "TheBondBetweenUs"`.
- **Interior PDF**: `The Bond Between Us_Interior_v15 (bleed).pdf` in `Downloads/` — this is the
  SAME PDF that the shared Series Introduction / Session Overview / Growth-Evaluation grid were
  extracted from, so book 4 is the "home" book for that shared content (expect a strong match).

**Google Doc IDs** (curl `…/document/d/<ID>/export?format=md`; folder
`drive.google.com/drive/folders/19rQmEYkWAdO-rS1I0nowZalAKSn7Aijl`):

| # | Title | Google Doc ID |
|---|-------|---------------|
| 1 | The Household | 1qeRqtUciqb7XpIS9WUA1G3sDdbVhbCK2K-C6PjCJw08 |
| 2 | The Union     | 1McymF6omw8Vwo3OFHyLGPcTXt6b377xsHWkafUg8d-M |
| 3 | The Offspring | 1H3EtUrhcRjOcYQT4UXQ1chI2S9d6fJrP5LM2r-NdB2k |
| 4 | The Bond      | 1QusIwP5Eim_4ycJpzP35Hy5o9Oe-AZS15n7hP9LO9V4 |
| 5 | The Public    | 1Vpf6G0ZLiWNp7F8SPVUAtlb9NwlWlHZ_LHF_EXI1Xqk |
| 6 | The Work      | 1TeedWNJiI81z6bK8IKlm2Qn1OKweCfmS6R54qg-tjxs |
| 7 | The Church    | 1ZraeTRZSI2lGw7r5VPXK6ig_Qml3Vru4i5_9saZWy3A |
| 8 | The Community | 1OERhiXPpYAmRQ4JHN5Iqk1xV1mntJQvEPYPmm5X83mQ |
| 9 | The Commons   | 1wRrHrC_Yy2SjO4sloSTB3jGv9cilYFgS0l7-3Jvxvlo |
| 10 | The Network  | 1jtasHb7_q7Jblgbd6UFc4iRVzifQ8FXNeVdl8uSY-YM |
| 11 | The Worlds   | 1b0izW46my27a_AnoTyQEcLYeXSdc49sXpLGZd2I0th4 |
| 12 | The Other    | 1qGR-uhet3p1F5HAB4oY51LBc48LdE-Tb8M1Uk0ZRq5Q |

Matter: Opening `1u8_Sv1aqGhE7Zh0xcSpG6dzuHf5SXAzV2J3YBgqvQeM`, Recall
`1nhNvnyEoBgnsFDGnBDR-rxQGbKkxwEFPSur8LltdGUI`, Further
`1EutVos8p72dHxXqSo5ACUvtIY0MarUQtH1eD0jyXlqo`. Filenames: `01-The-Household … 12-The-Other`,
`00-Front-Matter`, `00-The-Opening`, `13-The-Recall`, `14-Further-Resources`.

**Watch for (per Steve's book-4 strategy):** sessions 1–12 reuse ALL common elements + grab only
unique manuscript prose; front matter / Opening / Recall get special handling (copy the shared
content, grab any unique bits from the manuscript) — and **if any "unique" content looks
copy-pasted from books 1–3, flag it and check with Steve** before shipping (every prior book had
at least one stale matter Doc). Convert **Session 1 (The Household) first as a calibration pass**
for Steve's review before doing 2–12.

**Matter polish pass (2026-07-29, deploys 2–5 — all live):**
- **Recall Learning Plan tables filled from PDF pp.404–405** — Selected Passages + Recommended
  Reading, with the **Topic column populated** (Family…Outsiders); Recommended-Reading books joined
  with `<br>`.
- **All book titles italicized** (Recall Recommended Reading + Further bibliography) from the PDF's
  own `AGaramondPro-Italic` font runs, reconstructed **per PDF block** (each block = one citation, so
  no cross-entry collision); the one title the PDF left plain (S6 Banks) italicized for consistency.
- **Further Resources reading plan = per-session 5-row × 4-week-column tables** (transposed from the
  PDF's 4-week × 5-day grid), fixed 25% columns, horizontal-scroll on ≤640px phones.
- **Passage-ref reconciliation** (checked every PDF occurrence): S6 The Work = **Nehemiah 1:1–7:4**
  (Recall conclusion's "7:73" was a lone PDF typo); S11 The Worlds = **Acts 16:6–18:17** everywhere
  (per Steve; Opening said 16:11, Recall said 16:11–17:33). Reading-plan ref typos fixed:
  `Ecclesiastes; 8:14`→`Ecclesiastes 8:14`, `Nehemiah; 5:1`→`Nehemiah 5:1`, `Ezekiel 6:1–14: Romans`
  →`…; Romans`, `6:1–22 Genesis`→`6:1–22; Genesis`. **Book 3 Recall Catechism** set to copy its
  Opening ("Faith") instead of `____`.
- **Still open (source Docs):** the Opening/Recall Google Docs still carry the old passage refs
  (`16:11`, `7:73`, `17:33`) + `Philppians` — fix at source or a re-export reverts. S4 Selected
  Passages had `Philppians` (fixed in output). Growth Outcomes / Imaginative Storytelling remain the
  belief-themed boilerplate (matches book 3 — flag for community authoring).

---

## Book 5 — The Glory Due His Name  (Christian Devotion)

**Status:** **DEPLOYED + PUBLIC 2026-07-29** (content repo `edf5184`, pushed to main →
notify-website.yml auto-refresh + manual `/api/refresh` OK; all 16 pages live 200, accent `#25a9ad`
rendering, `DevotionCreed` placeholder shows "Coming soon.", 0 unresolved `@include`). Built the
final shared-content format IN PLACE in `Essentials/The Glory Due His Name/` (`status: public`, banner
`Pre-Release`, accent `#25a9ad`, `order` 5). Stale preview `session1.md` (+ a `.DS_Store`) removed.
(Website-repo tooling changes — `convert.py`/`completeness.py` fixes + these docs — are saved on disk
but NOT pushed: no `src/` change, so no Cloud Run redeploy per the standing guardrail.)
`series.order` = 5. **This is the "matter-less" book (see CONVERSION.md §2d): NO interior PDF and NO
Opening/Recall/Further Docs — only the 12 session Docs.**

- **12 sessions** (`01-The-Water … 12-The-Banquet`): converted with **zero WARN lines**;
  `completeness.py` = **S1 100% (0 unmatched)**. S2–S12 each show a large end-block "unmatched" delta
  that is **entirely an author draft appendix** (see the ⚠ finding below), NOT dropped finished
  content — the finished bodies matched 100% up to the appendix boundary (verified: every gap is one
  contiguous end-region; S1, which has no appendix, is a clean 100%). Structural sweep clean on all 12
  (5 infographics + 5 movement intros + 1 `DevotionCreed` creed each; 0 stray `<Item>`/`<Infographic>`;
  0 open `@include`; 0 `active=`/`bold=`; 12–20 inline `<Question>`).
- **All 16 files** resolve every `@include` via the REAL parser (`resolveIncludes` +
  `parseCommonBlocks`, series+book blocks) — **303 directives, 0 undefined, 0 leftover** — and
  `renderMarkdown` cleanly (0 throws, 0 stray custom tags). `DevotionCreed` placeholder resolves to
  "Coming soon."
- **Creed:** placeholder `<DevotionCreed>Coming soon.</DevotionCreed>` in `commonBook.md`
  (`CREED_KEY="DevotionCreed"`, real creed TBD — each session Doc's Creedal Statement is an unfilled
  "Statement"). **Rename the key everywhere if a real creed is provided later.**
- **Accent:** `#25a9ad` (teal, from `cover.svg`); all six heading `color` levels set to it + `accent` key.
- **Front Matter:** §12 structure; Introductory Quotes = **"Coming soon."** (no PDF p.1). Publishing
  line "The Glory Due His Name: A Narrative Journey of Christian Devotion".
- **The Opening / The Recall:** commonized per §2c (templated off book 3's placeholder matter; all
  `Opening_*`/`Recall_*` includes + Five Movements SVG reused). Book-specific slots are placeholders:
  Opening/Recall Key Elements (`Key Passage` = Preview/Review; Scripture Memory + Catechism = `____`),
  Introduction/Conclusion/Key Idea/Discussion/Personal-Interest/Significant Quote/Project Preview/
  Example Creed → "Coming soon."; Growth Outcomes + Imaginative Storytelling kept as the shared
  belief-themed boilerplate (as books 3–4); Recall Growth-Evaluation = book-3's generic `____` rubric
  skeleton; Selected Passages / Recommended Reading = blank 3-col tables (Session rows only). Recall
  Core-Project capstone → placeholder `### Devotion Creed` "Coming soon." **Opening Core Content +
  Planning Calendar tables ARE built** from the 12 session titles + Key Passages (Focus/Teacher/Date
  blank).
- **Further Resources:** heading-only placeholder (per-session `#### Session N: <title>` under
  Bibliography + Reading Plan), as books 1–3.

**Decisions (Steve, 2026-07-29):** accent `#25a9ad`; creed = placeholder `DevotionCreed`;
`status: public`; **leave both "The Water" sessions as-is** (see standing flag below).

**⚠ STANDING FLAG — S1 and S5 are BOTH titled "The Water"** (S1 = Genesis 6:1–9:17 flood; S5 = Acts
8:1–40 baptism). Per Steve (2026-07-29): **left both as "The Water"** → files `01-The-Water.md` +
`05-The-Water.md`; the nav shows two identical "The Water" entries. Not renamed — flagged here to
revisit later (cf. book-3 S10 "The Temple" mislabel). A 13th folder Doc ("Header 1") is not a
session — ignored.

**⚠ SESSION DRAFT APPENDICES (dropped by the converter — real prose NOT on the live pages).**
Every session Doc **2–12** (NOT S1) carries an author working-notes appendix **below the finished
session** (after "Insert Movement 5 template."), which the converter drops (`skip_to_h2` runs to EOF —
same behavior as book-1 S1's trailing heading-skeleton, §7). This is why `completeness.py` reports
600–1,650 "unmatched" source words per session — all benign, all in the appendix. Contents per
session (varies): **"Long Story Short (400-word retell; 200-word summary)" → "The Story Retold:
<title>"** (a ~400-word sample retelling — Storycraft material; the finished session uses the shared
`StoryRetellQuestion` prompt instead), **"Thinking It Through"** (reflection prose), **"Seeing the
Design"** (the biblical-book-context boilerplate), plus stray fragments ("Genesis", "??", "Extras",
"Dire"). Some go further: **S6** "Future Vision"; **S7/S8/S9** draft *outlines* with authoring specs
(**"Spiritual Practice (180 words; 1 quote, 1 verse)"** with draft practice content like "Pledge of
Allegiance" / "Free At Last" — note the finished Spiritual Practice sections are EMPTY, so if any of
this is intended liturgy it needs to be moved up per Steve's standing "include practice content where
the manuscript has it" rule); **S9** draft movement outlines (Providential Provision / Corporate
Ministry / Witness the Text); **S11/S12** a partial **"Bibliography"** (2–3 citations) + "Extras" /
"The Recall". **Decision default: dropped + flagged (reversible — the prose stays in the source Docs).
Revisit whether the retellings, the S7/S8 practice drafts, or the S11/S12 bibliography should be
promoted into the finished sessions.**

**Typos in source Docs (reproduced faithfully — fix in the Google Docs, not the converter):**
> ⚠️ Incidental findings. Session 1 reviewed closely; S2–S12 completeness-verified (100% of finished
> body) but not line-by-line proofed, so more may exist.
- **S1 (The Water):** intro (1 Peter 3:18–22) "the pledge **off** a clear conscience" → *of*; Passage
  Outline #5 "Waters **Receed**" → *Recede*; commentary "God promised to never again **to** destroy
  humanity" (double *to*); `in Noah's day— **be** fruitful and multiply"` (missing opening quote before
  *be*); synopsis "Faithfulness" row "**blamlessness**" → *blamelessness*; commentary "A Divine Deluge"
  `…flood of waters came upon the earth**"**` (stray closing quote, no opening); synopsis "Faith and
  Trust in God" row cites **(9:21)** for "saves people from divine judgment and curse" (9:21 is Noah's
  drunkenness — looks like a wrong ref, left as-is, author call).

## Cross-book / tooling notes
- Converter fixes made during book 2 that also help book 1: `split_attr` now handles author
  names with leading initials ("J. C. Ryle") and a closing quote/paren between terminal
  punctuation and a scripture ref (`…willing." Isaiah 30:15`).
- Converter change made during book 3 (benefits all books): the Key-Elements bullet handler now
  normalizes any `Catechism…` run-in label to just "**Catechism**" so the bold term is uniform
  across books (per Steve). Books 1–2 already wrote "Catechism"; book 3's Docs wrote "Catechism
  Question".
- **Converter changes made during book 5 (benefit all books):** (1) `convert_question` now also
  matches the **colon-inside-bold** run-in label form `**Label:**` (not just `**Label**:`) and
  normalizes both to `<Accent>Label:</Accent>` — book-5 Docs S4–S8 mixed the two forms within a
  session, so ~23 questions were rendering as plain bold instead of the accent house style. (2) The
  Spiritual-Practice loop now skips a **bare empty-heading artifact** (a stray `###` with no text) —
  book-5 Docs S3–S12 each left an empty `### ` heading between Spiritual Practice and Ministry
  Practice, which the "promote first plain line to a `####` title" rule was turning into a broken
  `#### ###` heading. Both are pure normalizations (no effect on the already-correct books 1–4:
  their Docs use the colon-outside form and have no empty-heading artifacts — re-running them is a
  no-op).
- [2026-07-28, per Steve] **Website parser change — `@include` block keys may now contain
  underscores/dashes.** Extended the key charset `[A-Za-z][A-Za-z0-9]*` → `[A-Za-z][A-Za-z0-9_-]*`
  in all four regexes (`resolveIncludes` + `resolveIncludesTracked` directive parsers in
  `src/renderer/parser.js`; `parseCommonBlocks` + `parseCommonBlocksTracked` block-tag parsers in
  `src/server/content.js`), so keys can be grounded in their section hierarchy for readability
  (e.g. `Recall_BookOverview_KeyIdea`). Backward-compatible (existing alphanumeric keys unaffected);
  added a unit test in `tests/unit/segment-map.test.js`. Deployed (website `5e20cc1`). This
  unblocked the underscore-keyed Recall blocks above.
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
