# Story-Conversion Process & Notes

Running doc for converting Google-Doc session manuscripts into the custom session
markdown used by the Noble Imprint website/app. Built for **"The Story Behind It
All"** (Narrative Journey Series → Essentials); the same pipeline is meant
to be reused for the rest of the series.

_Last updated: 2026-07-29 — **books 1–4 complete & live** (book 4 = "The Bond Between Us",
Community / A Christian Community Covenant, accent `#de6d36`, DEPLOYED + PUBLIC; the "home" book for
the genuine Recall + community Growth-Evaluation rubric extracted from its PDF p.408). The Opening AND
The Recall are **commonized**: identical framework text lives once in `commonSeries.md` as 16
`Opening_*` + 17 `Recall_*` blocks (plus a book-colored Five Movements SVG, Bond-style Core-Content /
Planning-Calendar / Selected-Passages / Recommended-Reading / Growth-Evaluation tables, and each
book's creed dropped into the Opening Overview). **⚠ `convert_matter.py` does NOT emit this commonized
matter** — it still produces the old flat format; book-4 matter was built by the reusable
`scratchpad/build_*.py` scripts (creed/matter/further/learning-plan, all reading the interior PDF).
See §2c, and **§2d for the "matter-less book" pattern (book 5 — no PDF, no Opening/Recall/Further
Docs).** Book 5 = "The Glory Due His Name" (Devotion, accent `#25a9ad`, placeholder `DevotionCreed`) —
**converted & verified locally 2026-07-29 (16 files, S1 completeness 100%, all @include resolve);
deploy pending Steve's go-ahead.** Kickoff in `BOOK5-KICKOFF.md`; per-book callouts (incl. the S2–S12
draft-appendix finding + S1 typos) in `NARRATIVE-JOURNEY-CONVERSION-SUMMARY.md`._

---

## 1. What lives here

```
tools/story-conversion/
  CONVERSION.md        ← this doc
  convert.py           ← Doc-markdown → session markdown (deterministic)
  completeness.py      ← word-for-word verification (source vs. output)
  docs/                ← raw Google-Doc exports, one per session (session1.md … session12.md)
```

`convert.py` reads `docs/session<N>.md` and writes `out/session<N>.md` (relative to
the script). `completeness.py` compares each `docs/session<N>.md` against the placed
book file.

## 2. The pipeline (end to end)

1. **Fetch** the manuscript as native markdown (byte-exact, preserves bold/headings/tables):
   ```
   curl -sL "https://docs.google.com/document/d/<DOC_ID>/export?format=md" -o docs/session<N>.md
   ```
   (The docs are link-shared "anyone with link can view", so no auth needed. This is
   far better than a PDF or a summarizer — no content is paraphrased or dropped.)
2. **Convert**: `python convert.py <N>` → `out/session<N>.md`. Watch the `WARN:` lines.
3. **Place** in the book as a zero-padded descriptive filename (see §5):
   `cp out/session<N>.md "<book>/sessions/NN-The-Xxx.md"`
4. **Verify** (see §6): structural render check + `python completeness.py` + eyeball screenshots.
5. **Deploy**: commit the resources repo. The website reads content live via the GitHub
   API, then `curl -s -X POST https://resources.noblecollective.org/api/refresh` to rebuild
   the content tree so new/renamed files show up immediately.

The website code change that this depends on — the `active="…"` include param — is in
the website repo (`src/renderer/parser.js`) and deploys via its own CI on push.

## 2b. Converting a NEW book (checklist) — CURRENT as of 2026-07-28

The pipeline is reusable across the whole Narrative Journey → Essentials series. Four books are
done (The Story Behind It All, The Best Possible Life, The Open Invitation, The Bond Between Us).
Remaining Essentials books: **The Glory Due His Name** (Devotion), **The Kingdom Come** (Witness).
Read §11 (book-2 log) for a worked session example and **§2c for the commonized front/back matter**
(the current state of the Opening/Recall). Book 4 (`BOOK4-KICKOFF.md`) added a reusable
`scratchpad/build_matter.py` that assembles the commonized Opening/Recall directly (pulls prose from
the Doc exports, rubric from the interior PDF) — a stopgap until `convert_matter.py` is upgraded.

**Inputs to get from Steve first:** which book; the 12 session Google-Doc IDs + the 3 matter
Doc IDs (Opening/Recall/Further); the book's **interior PDF** in `Downloads/` (used ONLY for:
the creed text, the accent color, and the page-1 Introductory Quotes — per Steve, no other
prose comes from the PDF); the book's creed (which catechism summary — e.g. Lord's Prayer for
The Open Invitation); and its accent hex.

Steps:
1. **Back up** the previous book's `docs/` (e.g. `docs/_the-best-possible-life/`), then `curl`
   the 15 new Docs into `docs/` as `session1.md…session12.md` + `opening.md recall.md further.md`
   (see §2 step 1). Sanity-check sizes (not sign-in HTML).
2. **Per-book script settings** (the only script edits): `convert.py` → `ID_PREFIX` +
   `CREED_KEY` (e.g. `"LordsPrayer"`); `convert_matter.py` → `ID_PREFIX`; `completeness.py` →
   `BOOK` path + `titles` map. (Question ids look like `{ID_PREFIX}Ses{N}-…`.)
3. **`commonBook.md`** (book-level): the book's creed block, `<CREED_KEY>…</CREED_KEY>`, built
   from the interior PDF. Generate it with a small script that reads the PDF → writes the file
   (keeps scripture text out of model output; an API content filter trips on decontextualized
   verse phrases). See `build_creed.py` in §11's history.
4. **`meta.json`**: `"accent"` = book hex; set all heading `color` levels to the accent (mirror
   book 1/2); `"banner": "Pre-Release"`; `"status"`: start `hidden` if you want to build before
   review, else `public`. `maxNavHeadingLevel: 3`.
5. `python convert.py <N>` per session → place as `NN-Title.md` in `sessions/` (zero-padded
   descriptive; nav strips the `NN-` prefix; see §5). Watch WARN lines (empty Passage Outline
   is expected/benign).
6. **Matter (Opening / Recall / Further) — see §2c.** The Opening & Recall are now COMMONIZED
   (shared `Opening_*` / `Recall_*` blocks + tables + SVG + creed-in-Overview). `convert_matter.py`
   still emits the OLD flat format, so the matter is currently built by **copying book 3's matter
   files as the template** and grabbing only the book-specific bits from the manuscript. **⚠ Verify
   the source Docs are actually THIS book's** — books 1–3 each had a stale Further-Resources (and
   book-3 had a stale Recall) Doc holding book-1 content; if a matter Doc is stale, ship a
   heading-only placeholder and flag it.
7. **Front Matter** — build `sessions/00-Front-Matter.md` in the CURRENT structure (see §12):
   `# Front Matter` → `## Introductory Quotes` (from interior PDF p.1) → `## A Narrative Journey
   Series` + `<!-- @include: NarrativeJourneySeriesList -->` → `## Publishing and Licensing`
   (`_<Full Title incl. subtitle>_, Pre-Release Edition` blank-line then
   `<!-- @include: PublishingLicensing -->`) → `## Series Introduction` +
   `<!-- @include: SeriesIntroduction -->` → `## Session Overview` +
   `<!-- @include: SessionOverview -->`.
8. **Verify:** `python completeness.py` (expect 12/12 100%); structural sweep (5 infographics,
   5 movement intros, 1 creed include, 0 literal `<Item>`/`<Infographic>`, 0 un-commented
   `@include`); resolve ALL `@include` keys with the REAL parser (require + `resolveIncludes`)
   and `renderMarkdown` a spot-check (tables merge, links, no throw). See the node one-liners in
   §11.
9. **Deploy:** commit the CONTENT repo + `POST https://resources.noblecollective.org/api/refresh`.
   Content-repo push is SAFE re: audio (audiobook auto-gen disabled). Expect to rebase over
   Playwright Test-Book churn commits (disjoint files). No website deploy needed unless you
   changed `src/` (parser/CSS).

**ALREADY shared — do NOT recreate (all in `commonSeries.md`, pulled via `@include`):** the 5
infographics; the 5 movement intros; section directions; the shared question sets
(`NarrativeElementsQuestion`, `StoryRetellQuestion`, `ApplicationQuestions`, `StrategyQuestions`
— take `id=`); **`SeriesIntroduction`** (full prose + the all-books summary as 3 merged
subseries tables); **`SessionOverview`** (full fivefold movements); **`NarrativeJourneySeriesList`**
(front-matter series list, already includes all books incl. The Kingdom Come); **`PublishingLicensing`**
(shared © 2026 / CC BY-SA / BSB copyright). The series intro/overview/list already list every
book, so nothing series-level changes per new book. Book-specific only: the creed
(`commonBook.md`), `meta.json`, Introductory Quotes, the Publishing title line, and session prose.

**Converter behavior to know (all in `convert.py`):** per-book `CREED_KEY` drives the creed
`@include`; `split_attr` handles author initials ("J. C. Ryle") and a closing quote/paren before
a scripture ref (`…willing." Isaiah 30:15`); an unstyled first line under Spiritual Practice is
promoted to a `####` title. Steve's standing decisions in §4 apply (no per-session creed bold /
active practice dot unless he specifies).

## 2c. Commonized front/back matter (The Opening & The Recall) — CURRENT as of 2026-07-29

The Opening and The Recall were **almost entirely identical framework text** across books 1–3
(only a handful of book-specific slots differ). That identical text now lives once in
`commonSeries.md` and is pulled into each book via `@include`. **This is the biggest change since
the book-2 log and it is NOT reflected in `convert_matter.py` — do the matter by templating off
book 3, not by running the matter converter.**

**What's shared (in `commonSeries.md`, pulled via `@include`) — do NOT recreate:**
- **The Opening — 16 `Opening_*` blocks:** `Opening_BookOverview_Directions`,
  `Opening_CoreContent_Directions`, `Opening_KeyIdea_Directions`, `Opening_PersonalInterest_Directions`,
  `Opening_FaithFoundation_Directions`, `Opening_Discussion_Directions`,
  `Opening_SignificantQuote_Directions`, `Opening_LearningPlan_Directions`,
  `Opening_SessionFramework_Intro`, `Opening_PlanningCalendar_Directions`,
  `Opening_CoreProject_Directions`, `Opening_ImaginativeStorytelling_Directions`,
  `Opening_FaithPractice_Directions`, `Opening_GrowthOutcomes_Directions`,
  `Opening_FocusedArea_Directions`, `Opening_CommunityPrayer_Directions` — plus
  **`Opening_SessionFrameworkInfographic`** (the self-contained **Five Movements cycle SVG**;
  it uses `style="color: var(--accent, …)"` + `currentColor` so it auto-takes each book's accent —
  nothing per-book to change).
- **The Recall — 17 `Recall_*` blocks:** `Recall_BookOverview_{Directions,KeyIdea,StoryRetell,NarrativeReview}`,
  `Recall_FaithFoundation_{Directions,DiscussionDirections,DiscussionQuestions,SignificantInsights}`,
  `Recall_LearningPlan_{Directions,SelectedPassages,RecommendedReading}`,
  `Recall_CoreProject_{Directions,JournalReflection}`,
  `Recall_FaithPractice_{Directions,GrowthEvaluation,NextSteps,CommunityPrayer}`.
  `Recall_FaithFoundation_DiscussionQuestions` and `Recall_FaithPractice_NextSteps` take an
  `id="{Book}Recall-…"` param (REQUIRED once `{id}` is present, or the page throws).

**What stays book-specific (inline in each book's `00-The-Opening.md` / `13-The-Recall.md`):**
- **Key Elements** (Key Passage / Scripture Memory / Catechism — from the interior PDF's Opening page).
- **The creed**, dropped into the Opening **Overview** (book-common — it lives in the book's
  `commonBook.md`, pulled via `<!-- @include: {CREED_KEY} -->`, NOT series-common).
- **Tables** (markdown, currently authored/placeholder per book):
  - Opening **Core Content** — 3 cols; scripture refs go on their **own line inside the cell**
    (`<br>(Ref)`); Bond-style.
  - Opening **Planning Calendar** — Bond-style table.
  - Recall **Selected Passages** — `Session | Topic | Passages`; Topic column intentionally
    **blank** (author fills later); leave unknown cells empty (no `_____`).
  - Recall **Recommended Reading** — `Session | Topic | Recommended Reading`; multiple books in a
    cell separated by **`<br>`**, not `;`.
  - Recall **Growth Evaluation** — wide 6-col rubric (`Objective | Exemplary | Mature | Developing
    | Emerging | Unsound`), 5 metric rows (Conviction/Commitment/Conduct/Community/Character);
    unknown per-book cells left as short `____` placeholders (see §11 history + the summary doc).
- **Conclusion / Project Preview / Example ___ / Core Project body** — usually `Coming soon.` or a
  short `____` placeholder until authored. **Never leave a standalone `__________` on its own line
  — it renders as an `<hr>`.**

**How to build book N's matter now (until `convert_matter.py` is upgraded):**
1. Copy book 3's `00-The-Opening.md` + `13-The-Recall.md` as the structural template (all the
   `@include`s, headings, and table skeletons are already correct and book-agnostic).
2. Replace the book-specific bits: Key Elements (from the PDF Opening page), the creed `@include`
   key (→ this book's `CREED_KEY`), the `id="{Book}Recall-…"` params, and the table
   contents/placeholders. Grab any genuinely book-specific Opening/Recall prose from the
   manuscript Docs.
3. **Flag copy-paste:** if a matter Doc's "unique" content looks lifted from books 1–3 (books
   1–3 all had at least one stale matter Doc), STOP and confirm with Steve before shipping;
   default to a heading-only placeholder for a stale Doc.
4. Further Resources: still convert via `convert_matter.py` OR ship a heading-only placeholder if
   its Doc is stale (all 3 prior books shipped Further as a placeholder).

**TODO (tooling debt):** upgrade `convert_matter.py` to emit this commonized structure directly
(inject the `Opening_*`/`Recall_*` includes at the right spots, build the tables, drop the creed
include into Overview, apply the placeholder conventions) so books 5–7 come out right in one pass.

### Book-4 build learnings (the reusable `scratchpad/build_*.py` scripts) — 2026-07-29

Book 4's matter was assembled by four small PDF-reading scripts (kept in
`tools/story-conversion/scratchpad/`). They pull prose/refs verbatim from the interior PDF/Doc
exports so nothing is transcribed by hand. Reuse them for any book that HAS a PDF:
- **`build_creed.py`** — reads the PDF creed page, writes `commonBook.md`'s `<CREED_KEY>` block
  (blockquote lines, markdown hard breaks, straight quotes, `<< Attribution`). Keeps verse/creed text
  out of model output (the book-2 content-filter lesson). Two stanzas → separate with a blank `>` line.
- **`build_matter.py`** — builds `00-Front-Matter.md` + `00-The-Opening.md` + `13-The-Recall.md` by
  templating off book 3/4 and pulling book-specific prose from the Doc exports (`docs/opening.md`,
  `docs/recall.md`) via `convert_matter.py`'s helpers (`clean`, `split_attr`, `paras`) + the
  Growth-Evaluation rubric from the PDF (`find_tables`). Does NOT run `convert_matter.py` for
  Opening/Recall.
- **`build_further.py`** — `14-Further-Resources.md`: bibliography (per-block reconstruction — **each
  PDF text block = one citation**, so italics can't cross-contaminate) with **book titles italicized
  from the PDF's own `*-Italic` font runs** (`span["flags"] & 2`); reading plan as **per-session
  5-row × 4-week-column tables** (transpose the 4 weeks × 5 daily readings). Fix source ref typos in
  a `clean_ref()` (e.g. `Book; 8:14`→`Book 8:14`, `…14: Romans`→`…14; Romans`).
- **`build_learningplan.py`** — fills the Recall **Selected Passages + Recommended Reading** tables
  from the PDF (Topic column IS in the PDF — populate it); Recommended-Reading books joined with
  `<br>`, titles italicized. Idempotent (regex-replaces the existing table).

**Website render support added for book 4** (`src/renderer/parser.js` + `style.css`, cache-buster now
`v=84`): the renderer auto-tags matter tables by their header so CSS can size them —
`.pc-table` (Planning Calendar, "Biblical Passage"), `.cc-table` (Opening Core Content,
"Session"+"Focus" → 32%/68%), `.lp-table` (Recall Selected Passages / Recommended Reading,
"Session"+"Topic" → first col `white-space:nowrap`), `.rp-table` (reading plan, "Week N" → fixed 25%
cols, wrapped in a `.rp-scroll` div that scrolls horizontally on ≤640px phones).

**Passage-ref reconciliation:** when a session's Bible ref disagrees across the session/Opening/Recall
Docs, check ALL occurrences in the PDF — the PDF is usually internally consistent except a lone typo;
align to its dominant value (Steve confirms). Never guess a range; it's an author call. Fix in the
output AND flag the Google Docs (a re-export reverts).

## 2d. The "matter-less" book (no PDF, no Opening/Recall/Further Docs) — book 5 pattern

Some books arrive as **only the 12 session Docs** — no interior PDF and no Opening/Recall/Further
manuscript Docs (book 5, "The Glory Due His Name"). Handle it like this:
- **Sessions 1–12:** convert exactly as normal (`convert.py`). Key Elements come from each session
  Doc. **The creed block must still exist** — `convert.py` emits `@include: {CREED_KEY}` for every
  session's Creedal Statement even when the Doc's creed body is an unfilled placeholder, so put a
  placeholder `<CREED_KEY>Coming soon.</CREED_KEY>` in `commonBook.md` (or the real creed if provided)
  or the page throws on an undefined key.
- **The 4 non-session files:** build from the shared `@include` blocks (Front Matter's 4 series
  includes; the 16 `Opening_*` + 17 `Recall_*` + Five-Movements SVG) exactly as books 3–4, and fill
  every book-specific slot with a **heading / "Coming soon." / `____` placeholder** — there's no source
  to fill them. EXCEPTION: the Opening **Core Content** and **Planning Calendar** tables can still be
  built from the 12 session **titles + Key Passages** (present in the session Docs); leave the Focus /
  Teacher / Date cells blank. Further Resources → heading-only placeholder (as books 1–3).
- **Inputs that normally come from the PDF must come from Steve:** accent hex (try `cover.svg` for a
  candidate), the creed, Introductory Quotes. Flag these up front.
- **Do NOT run the `build_*.py` scripts** — they read the PDF, which doesn't exist. Hand-build the
  matter by templating off book 4 with placeholders.

## 3. Doc IDs

| # | Title | Google Doc ID |
|---|-------|---------------|
| 1 | The Battle    | 1P9M1eioLfFPPUseCioqAx9WP6df9MHF46taUWLkvThY |
| 2 | The Beginning | 1Te82sflCD9wya7yJ3qDgdHxf6x8SGbDpHuRFr3NdAX0 |
| 3 | The Image     | 1w5qqANYHC9fDwNy9Yg6GAUorT9ZWfkqI2mQBSZLp1-g |
| 4 | The Fall      | 1mOZwW2lZzJhD0H5Sf38DkO75r8iHvGSt8pad-ZTby-o |
| 5 | The Promise   | 168lcFxTPo3mKx3Cp41rv_lHMbaT5e_rKH9NS9r2NBuY |
| 6 | The Coming    | 19cX2uo0QMjgBx0zCZNuhjI0wiE5iDp7n2XSskGkmsSI |
| 7 | The Cross     | 1DrR44ufQef48nFfi3omIZeg7Q6-IHGfAVS1Oyw5B0_s |
| 8 | The Spirit    | 1iKez_HQOZGxPaMnmfOLxTqx6xbDu6mnkbVxW_SL52Zg |
| 9 | The Change    | 1zl89oj2cTQolsEi0P29xTMGzsYIuTJSYGA3FrqhjNIw |
| 10 | The Church   | 1XuH7IXzxW24-iEqk_WMaVbjXcJnqYqfGb3cGfS_oYU8 |
| 11 | The Kingdom  | 1WHYd-Wyu-P1YdLO9IUvJ17Gw62_8ud_QpdAswfw2hDk |
| 12 | The Finale   | 1MeZh5hWGk16HeZhNvr0JyvN_LLAVOcY9FF5I8lQ2NOo |

## 4. How `convert.py` works

**Only unique prose comes from the manuscript.** All repeated scaffolding — the five
movement intros, the section directions, the shared Storycraft/Ministry/Mission question
sets, and the five infographics — lives once in `commonSeries.md` and is pulled in with
`<!-- @include: … -->`. The manuscripts themselves don't contain that scaffolding (they
literally say "Insert Movement template"), so the converter injects the includes at the
right structural spots and takes intro/questions/commentary/synopsis/practice text from
the doc.

Key design points:
- **Paragraph parser + heading state machine.** Google Doc heading *levels* are
  unreliable (e.g. session 2's "Conclusion" exported as `###`, and a body paragraph got
  styled as `###`). So commentary headings are recognized by their **text** ("Key Idea",
  "Passage Outline", "Biblical Narrative", "Biblical Principles", "Conclusion", "Session
  Synopsis", …) and re-leveled to the template, not trusted from the doc. An unknown
  heading that ends in sentence punctuation or contains ". " is treated as a stray
  paragraph (mis-styled body), not a title.
- **Inline cleanup** (`clean()`): unescape exporter backslashes (`\!` `\[` `\]` …),
  curly → straight quotes, `*italic*` → `_italic_` (bold `**…**` preserved), and strip
  1–2-char bold artifacts like `**u**ltimate` → "ultimate".
- **Questions**: `N. **Lead-in**: rest` → `<Question id=TheStoryFinalSes{N}-{Section}-Q{n}>N. <Accent>Lead-in:</Accent> rest</Question>`.
- **Run-in principle labels**: `*Label*.` (italic, sometimes with a stray bold period
  `*Label***.**`) → `<Accent>_Label._</Accent> …`.
- **Callouts**: a fully-bolded sentence inside a Biblical Commentary paragraph
  (`**…long sentence…**`, ≥12 chars with a space) → `<Callout>…</Callout>`.
- **Quotes**: a paragraph ending in a citation → `> quote` + `<< Attribution` on its own
  line. Handles scripture refs (incl. numbered books "2 Peter", multi-chapter ranges) and
  author works whether the doc wrote them italic (`*Work*`), quoted (`"Work"`), or plain —
  all normalized to `_Work_`.
- **Key Elements**: `* **Label**: value` → `- **Label** - value` (includes the Catechism line when present).
- **Session Synopsis**: the doc's single table becomes a 1-cell accent title table +
  a 2-column body table (the renderer merges them, Homestead-style).
- **Creed**: the whole creed body → `<!-- @include: ApostlesCreed -->`.

The rules were **calibrated against Session 1** — we had both its manuscript and its
hand-finished form, so the transforms were reverse-engineered to reproduce it exactly.

### Steve's standing decisions (applied to sessions 2–12)
- **No creed bold** and **no active practice dot** — do not infer either.
- **Passage Outline** heading is kept even when the manuscript leaves it empty.
- **Never fabricate** Spiritual Practice liturgy — but where the manuscript *has* practice
  content (only session 4 so far), include it.
- Session 1 keeps its authored `active="Lament"` and creed `bold="I believe in God the Father Almighty,"`.

## 5. Filenames, ordering & nav titles

Files are `NN-The-Xxx.md` (zero-padded): `01-The-Battle.md` … `12-The-Finale.md`.
- The site sorts sessions by `localeCompare` on the filename, so zero-padding gives 1→12.
- `sessionDisplayName()` strips the `NN-` prefix, so the sidebar shows clean titles
  ("The Battle" … "The Finale"). The page H1 still reads "Session N: The X" from the markdown.

## 6. Verification

- **Structural check** (per session): 5 infographics present, expected question count,
  no unresolved `@include`, no leftover `<Item>`/`<Infographic>` tags, active dot only
  where intended.
- **Completeness** (`python completeness.py`): reduces source and output to bare words and
  runs a `difflib` diff — every source word must appear, in order, in the output. Result:
  **all 12 sessions 100%.** The only non-matches are benign and explained (see §7).
- **Visual**: render the session with the site CSS + Font Awesome and screenshot key
  regions (top/creed/key-elements, a commentary principles block, the synopsis table,
  the infographics). All 12 reviewed.

## 7. Session-by-session notes (deviations & anything non-obvious)

- **S1 · The Battle** — Hand-authored in an earlier session, then refactored to use the
  shared infographic includes. Keeps `active="Lament"` + creed bold. Its Personal Lament
  practice text came from the print *template PDF* (it is **not** in the Google Doc). The
  Doc has a trailing duplicate heading-skeleton at the bottom (all headings, no body) —
  correctly omitted; this is why `completeness.py` shows ~143 "unmatched" source words for S1.
- **S2 · The Beginning** — `**u**ltimate **r**eality` first-letter-bold export artifact
  normalized to "ultimate reality" (the 4 "unmatched" words in the completeness report).
  One body paragraph ("God's creation is a revelation…") was mis-styled as `###` in the
  Doc and is rendered as body text. Empty Passage Outline & Spiritual Practice.
- **S3 · The Image** — Clean, script-only. Empty Passage Outline & Spiritual Practice.
- **S4 · The Fall** — The manuscript's Spiritual Practice section has real content: a
  **"Coming Clean"** confession practice with `Label | prompt` lines (Admitting Sin /
  Facing Brokenness / Pleading for Mercy). The first pass dropped it (I'd wrongly assumed
  all of 2–12 were empty there); the completeness check caught it. Now rendered as an
  accent `#### Coming Clean` heading + italic instructions + `<Accent>Label:</Accent>`
  prompts, above the shared infographic. `convert.py` now handles `Label | prompt` generally.
- **S5 · The Promise** — Clean. Multi-chapter Key Passage (Genesis 5:28–9:17) and a
  numbered-book Scripture Memory (2 Peter 1:4) both link correctly.
- **S6 · The Coming** — Clean.
- **S7 · The Cross** — Clean. Section-opener author work "Sermon XXIX" was quoted (not
  italic) in the Doc; normalized to `_Sermon XXIX_`.
- **S8 · The Spirit** — Clean.
- **S9 · The Change** — Clean.
- **S10 · The Church** — Longest session (Revelation letters). Clean.
- **S11 · The Kingdom** — Clean.
- **S12 · The Finale** — Clean. Synopsis has two rows both labeled "Future Hope"
  (overview row + principle row) — faithful to the manuscript.

## 8. Still open (Steve to decide)

- Creed **bold line** per session (currently none on 2–12).
- **Active practice dot** per session — intended as a bijection, each of the 12 practices
  getting one session (currently none on 2–12).
- **Passage Outlines** — headings present, content empty in the manuscripts.

## 9. Deployed state (2026-07-26)

- Website: `ea68dc5` (active= include param), earlier `b573c52` (infographic polish, css `v=75`).
- Content: `7e7acd4` (12 sessions + shared infographics), `84149a2` (S4 Coming Clean).
- Live (admin-only, hidden): `resources.noblecollective.org/narrative-journey-series/essentials/the-story-behind-it-all/<slug>`
  where slug is `01-the-battle` … `12-the-finale`.

## 10. Front & back matter (added 2026-07)

Four non-session files frame the 12 sessions, named to sort around them (the nav
strips the `NN-` prefix): `00-Front-Matter`, `00-The-Opening` (before session 1);
`13-The-Recall`, `14-Further-Resources` (after session 12).

- **The Opening / The Recall / Further Resources** — content from their Google-Doc
  manuscripts (all already self-structured to the Bond Between Us framework), converted
  by **`convert_matter.py`** (reads `docs/opening.md` `docs/recall.md` `docs/further.md`
  → `out/`). Creed → blockquote, Key Elements bullets, `<Question>` blocks, quotes →
  `> … <<`, session lists, bibliography (`#### Session N` + citations), reading plan
  (Week bullets), passages/reading tables split from the doc's run-on paragraphs.
- **Front Matter** — Series Introduction + Session Overview adapted from the Bond Between
  Us PDF (hand-written, not scripted); title/subtitle/CC-BY-SA copyright changed to this book.
- **Bond reference**: `The Bond Between Us_Interior_v15 (bleed).pdf` — front matter pages
  0–18, The Opening 19–34, The Recall 395–408, Further Resources 410–421.
- Decisions, adaptations, and open flags recorded in **`MATTER_DECISIONS.md`** (copyright
  year placeholder; omitted Community-specific epigraph/dedication; the Growth Evaluation
  rubric grid couldn't be recovered from the flattened Doc export).

## 11. Book 2 — "The Best Possible Life" (Narrative Journey → Essentials)

Second book through the pipeline (Christian **Living**, structured around the **Ten
Commandments** — the analog of book 1's Apostles' Creed). Reuses ALL shared series content
via `@include`; the standard `<Infographic>` design; the book-1 session file as the
structural framework.

**Steve's decisions (2026-07-28):**
- **Build IN PLACE, hidden.** Final format goes directly into the existing preview book
  `Essentials/The Best Possible Life/` (no separate "(Final)" staging folder — book 1's
  "(Final)" was a transitional copy that got consolidated into the main folder anyway).
  `meta.json` flipped `status: public → hidden`, `banner → "Draft"`.
- **Creed is book-specific.** This book's Creedal Statement = the **Ten Commandments**
  (Exodus 20:1–17), kept book-level in this book's `commonBook.md` as a `<TenCommandments>`
  block. Book 1 keeps its own `ApostlesCreed`; the creed was NOT promoted to series-level.
- **Accent `#00854a`** (green) — pulled from the old-copy PDF (it's the accent text + the
  dominant vector fill) and matches `cover.svg`. Heading colors also set to the green to
  mirror book 1's all-accent heading treatment. `meta.json` gains `"accent": "#00854a"`.
- **Only the creed is taken from the PDF** (`…/15I2Eh-…`, an OLD copy of the book). All prose
  content comes from the current Google Docs; no other content lifted from the PDF.

**Per-book settings applied:** `convert.py` `ID_PREFIX = "TheBestPossibleLife"` + new
`CREED_KEY = "TenCommandments"` (the creedal-statement handler now emits `{CREED_KEY}` so the
key is per-book); `convert_matter.py` `ID_PREFIX = "TheBestPossibleLife"`; `completeness.py`
`BOOK` → this book's `sessions/` + `titles` map (below). Question ids look like
`TheBestPossibleLifeSes1-Hearing-Q1`.

**Converter fix (benefits both books):** `split_attr` author-attribution regex now handles
author names with **leading initials** ("J. C. Ryle") and multi-word surnames — ported from
`convert_matter.py`. The old `[A-Z][^.]*?` couldn't span the periods in initials and
mis-split the intro quote (`…the Lord's people. J. C.` / `<< Ryle, …`). Now correct.

**commonBook.md creed:** generated by `scratchpad/build_creed.py` straight from the PDF
(page 18, 0-idx) so scripture text never round-trips through model output (an API content
filter was tripping on decontextualized commandment phrases). 12 logical lines (preface +
prologue + 10 commandments); divine-speech quote marks stripped for a clean creed rendering
that mirrors the `ApostlesCreed` block style; attribution `<< The Ten Commandments (Exodus
20:1–17)`.

**Google Doc IDs** (curl `…/document/d/<ID>/export?format=md`):

| # | Title | Google Doc ID |
|---|-------|---------------|
| 1 | The Way       | 16emoab4buG2g3C7thLpjv03JFlBQ9nPkF3g1mmzCksI |
| 2 | The Furnace   | 1IhjWk77wFYlijpZ0DfZAS8jqWAt2AMO85Z-e846BCrw |
| 3 | The Idol      | 1Ug_XIxgCmIZU1AlACHE8MEiThjrvVF_KyxjnK9YF_js |
| 4 | The Fire      | 1noDfufT6BiGwlrbLvVptwF5c_1RCnxZ9ng-79Xc23UA |
| 5 | The Land      | 17j14Z2QbduiFMC8yP7iQLDSL5-E3QyTv25jnhbwGBI0 |
| 6 | The Anointed  | 1IocJiZw_aCLjkmkEKc_AxaC5mvf5iLnfQ-FlH73O0CY |
| 7 | The Keeper    | 11v7DLJAq284cRYfeGdsd3VZiuvYqskplyKiErbEf06M |
| 8 | The Appeal    | 1unZwHlm6ruCUeCsbK7-Iq23q5Fykefha2dE0EVrrB_4 |
| 9 | The Vineyard  | 1jhMfvoZA-j4-HRZddi9HOi2-x3j3Hdrxl5zzztawlVU |
| 10 | The Voice    | 1_Pr8Wv2xV8MPQ9kn5kIa71ImzhVHNahMardvBLQ3siw |
| 11 | The Craving  | 1BePzo3f8GuE7k7BNzWmAVUkU_QnR_W11Pdwlts50dKU |
| 12 | The Contest  | 1qfvTk4BLSybEwujdRXoYKdZZ5y7jQVl0HmGOazUa-j4 |

Matter: Opening `1gKjWkHaAPbgDlUEsQltwNzIZyf5YDN9FLzFeCdiz4lA`, Recall
`1g6uVxLVUuSWhNIjtWezO1nZdnivb1OTIMr339LiAe_U`, Further
`1QrvHxIGr10JBOvb17XkVomXafKyoDd1Dhob_kfKnUk8`. Filenames mirror book 1:
`01-The-Way … 12-The-Contest`, `00-Front-Matter`, `00-The-Opening`, `13-The-Recall`,
`14-Further-Resources`. (Book-1 doc exports backed up to `docs/_the-story-behind-it-all/`.)

**ALL 12 sessions converted, placed & verified (2026-07-28):**
- `completeness.py` → **12/12 at 100%** (0 unmatched source words each).
- Structural sweep (every session): 5 infographics, 5 movement intros, 1 TenCommandments
  creed, 0 literal `<Item>`/`<Infographic>`/`ApostlesCreed`, 0 un-commented `@include`,
  13–16 inline `<Question>` (obs+disc+refl per session).
- Calibration decisions applied (Steve, 2026-07-28): creed renders as clean lines (no quote
  marks); the unstyled practice-title line (e.g. "Reflective Walk") is promoted to a `####`
  heading (new converter rule); **no** per-session creed bold and **no** active practice dot
  on any of the 12 (book-1 convention).
- Files `01-The-Way … 12-The-Contest`. Old preview `sessions/session1.md` still present
  (remove it at push time).

**Matter (2026-07-28):**
- **The Opening** & **The Recall** converted from their book-2 Google Docs and placed
  (`00-The-Opening.md`, `13-The-Recall.md`). Genuinely book-2 (Titus 2:11–12 / 2 Peter 1:5–8,
  book-2 session overviews). Faithful Doc typos left as-is for Steve to fix in the Docs:
  "aAn heir", "leads tointo", "Chrisitan", "brotherly kind- ness" (export hyphenation), and
  an unfilled "PSALM INTRODUCTION: Psalm 15, 128" line in the Opening.
- **Further Resources — heading-only placeholder placed** (Steve's call, 2026-07-28). Its
  Google Doc still holds **book 1's** bibliography + reading plan, so `14-Further-Resources.md`
  now carries just the relevant headings (Seeing the Design → Bibliography; Reading Plan) with
  per-session `#### Session N: <book-2 title>` subheadings and **empty bodies**, to be filled
  later from an updated book-2 Doc.
- **Front Matter — DONE + shared, REBUILT FROM THE BOND PDF** (Steve's call, 2026-07-28).
  We discovered book 1's published Series Orientation was an **abbreviated/altered** version
  (missing the generic all-books summary table + several paragraphs; trimmed Session-Overview
  movement descriptions). The authoritative, fully-generic text was re-extracted from
  `Downloads/The Bond Between Us_Interior_v15 (bleed).pdf` (the "Series Orientation": pages
  9–13 intro, 15–18 overview) via `scratchpad/extract_bond.py` + `build_series_common.py` and
  written to `commonSeries.md` as `<SeriesIntroduction>` (full prose + an **all-books summary**
  rendered as **three per-subseries merged-heading tables** — Foundations / Essentials /
  Pathways — each a 1-cell heading table + a 2-col body table the front-end merges, with the
  subseries tagline+descriptor as the first body row) and `<SessionOverview>` (full fivefold
  movements). Both books' `00-Front-Matter.md` now just `@include` these; only title/subtitle
  + Copyright stay inline (no per-book "this volume" paragraph — the table covers every book).
  **Book 1's front matter was ALSO corrected** and wired to the same includes → its output now
  renders the full authoritative version (this changes the live book 1 front matter, as
  approved). Fixes applied to the PDF text: `Chrisitanity`→`Christianity`, `Christiain`→
  `Christian`, `journal- like`→`journal-like`, `(meta) narrative`→`(meta)narrative`, em-dash
  spacing collapsed, `The Story Behind it All`→`…It All`, and `(see series summary on previous
  page)`→`(…above)`. The three per-subseries descriptor paragraphs + taglines ARE included
  (first body row of each subseries table). Copyright year still the `2024` placeholder.

**Validation (2026-07-28):** all 24 `@include` keys used across the book resolve to defined
blocks (`commonSeries.md` + this book's `commonBook.md`); no `bold=`/`active=` params used
(no param-resolution risk). Full inventory present: `00-Front-Matter`, `00-The-Opening`,
`01-The-Way … 12-The-Contest`, `13-The-Recall`, `14-Further-Resources`.

**Verification note:** `completeness.py` covers only the 12 sessions (not matter). Sessions
were checked with the structural sweep + completeness; matter pages were eyeballed. Live
visual review pending push (book is `status: hidden`, admin-only).

**DEPLOYED + PUBLIC (2026-07-28).** Book 2 is live and `status: public`; book 1 unchanged/public.
Source-typo flag from S1 stands: synopsis "Redemption" row reads `rest (1:93:1)` (should be
`1:9; 3:1`) — fix in the Google Doc. Later same-day changes (all live): front-matter restructure
(§12), shared Series Orientation rebuilt from the Bond PDF, `The Kingdom Come` added to the
series list/summary, PDF-emphasis pass (Narrative Journey italics, movement bolds), and the
external-link accent+new-tab render change. Full itemized log:
`NARRATIVE-JOURNEY-CONVERSION-SUMMARY.md`.

## 12. Current book front-matter structure (both done books, 2026-07-28)

Each book's `sessions/00-Front-Matter.md` (book-specific bits inline, everything else `@include`d
from `commonSeries.md`):

```
# Front Matter

## Introductory Quotes
<epigraphs from the interior PDF p.1 — book-specific — as `> quote` + `<< Author, _Work_`>

## A Narrative Journey Series

<!-- @include: NarrativeJourneySeriesList -->

## Publishing and Licensing

_<Full Title: A Narrative Journey of Christian X>_, Pre-Release Edition

<!-- @include: PublishingLicensing -->

## Series Introduction

<!-- @include: SeriesIntroduction -->

## Session Overview

<!-- @include: SessionOverview -->
```

- The old title-page block (`## <Title>` / subtitle / "Narrative Journey Series · Essentials")
  and the old `## Copyright` block were REMOVED. Publishing line uses the FULL title (with
  subtitle); it's a plain blank-line paragraph break before the include (NOT a hard break).
- Shared blocks live in `commonSeries.md`; each book's creed is in its own `commonBook.md`.
- Website render (deployed, `style.css v=79` + `parser.js`): external prose links take the book
  accent color + open in a new tab (`target="_blank"`).

## 13. Kickoff prompt for the NEXT book (paste into a fresh session)

> Convert the next Narrative Journey → Essentials book to the shared-content "final format,"
> exactly as we did for "The Story Behind It All" and "The Best Possible Life."
>
> READ FIRST: `Noble-Imprint-Resource-Website/tools/story-conversion/CONVERSION.md` (esp. §2b
> the NEW-book checklist, §11 the book-2 worked example, §12 the front-matter structure) and
> `NARRATIVE-JOURNEY-CONVERSION-SUMMARY.md` (per-book callouts + the shared-element change log);
> plus memory notes `project_the_best_possible_life`, `project_the_story_behind_it_all_final`,
> `project_common_content_includes`, and the feedback notes (`feedback_trace_downstream_automation`,
> `feedback_no_regen_without_approval`, `feedback_present_options`, `feedback_no_library_content`).
>
> REPOS: website+tooling `C:\Users\Steve\Dev\Noble-Imprint-Resource-Website`; content (source of
> truth) `C:\Users\Steve\Dev\Noble-Imprint-Resources`.
>
> BOOK: <name> (folder under `series/Narrative Journey Series/Essentials/`). Creed = <which
> catechism summary, e.g. the Lord's Prayer>. ID_PREFIX = "<NoSpacesTitle>".
>
> INPUTS I'll give you: the 12 session Google-Doc IDs + the 3 matter Doc IDs (Opening/Recall/
> Further); the interior PDF in Downloads (for the creed text, accent hex, and page-1
> Introductory Quotes — ONLY those come from the PDF); the accent hex if you want it fixed.
>
> DO: follow CONVERSION.md §2b end to end — back up the prior book's `docs/`, curl the 15 Docs,
> set the per-book values in the 3 scripts, build `commonBook.md` (creed) + `meta.json`
> (accent/headings/banner "Pre-Release"), convert + place all 12 sessions, do the matter
> **per §2c** (Opening & Recall are now COMMONIZED — template off book 3's `00-The-Opening.md` /
> `13-The-Recall.md`, reuse the 16 `Opening_*` + 17 `Recall_*` shared blocks + the Five Movements
> SVG via `@include`, keep only Key Elements / creed-in-Overview / the tables book-specific; do
> NOT run `convert_matter.py` for Opening/Recall, it still emits the old flat format), build the
> front matter in the §12 structure reusing ALL shared blocks via `@include` (do NOT recreate the
> infographics, movement intros, question sets, Series Introduction/Session Overview/series
> list/copyright). Render every session infographic with the standard shared `<Infographic>`.
> Verify: `completeness.py` 12/12 100% + structural sweep + resolve all `@include` keys with the
> real parser + a `renderMarkdown` spot-check. Then deploy: commit the CONTENT repo + `POST /api/refresh`.
>
> GUARDRAILS: convert Session 1 first as a calibration pass and let me review before doing 2–12;
> present options before consequential/irreversible decisions; keep the shared-element change log
> in `NARRATIVE-JOURNEY-CONVERSION-SUMMARY.md` updated for anything you change in common content;
> before pushing content, remember audiobook auto-gen is disabled — do NOT re-enable it or
> regenerate audio; don't touch other library content without asking. Standing decisions: no
> per-session creed bold / active practice dot unless I specify.
