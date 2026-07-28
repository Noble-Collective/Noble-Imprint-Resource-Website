# Story-Conversion Process & Notes

Running doc for converting Google-Doc session manuscripts into the custom session
markdown used by the Noble Imprint website/app. Built for **"The Story Behind It
All"** (Narrative Journey Series → Essentials); the same pipeline is meant
to be reused for the rest of the series.

_Last updated: 2026-07-28 — book 1 ("The Story Behind It All") complete & live; book 2
("The Best Possible Life") started — Session 1 converted & verified as a calibration pass
(see §11)._

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

## 2b. Converting a NEW book (checklist)

The pipeline is reusable across the whole Narrative Journey series. For each new book:
1. Get the Google Doc IDs (sessions + Opening/Recall/Further if the book has them) from Steve.
2. `curl` each into `docs/` (see §2 step 1): `session1.md … sessionN.md`, and `opening.md`,
   `recall.md`, `further.md` for the matter pages.
3. **Set the PER-BOOK values** (the only book-specific edits):
   - `convert.py` → `ID_PREFIX` (top of file): the question-id prefix, e.g. `"TheBestPossibleLife"`.
   - `convert_matter.py` → `ID_PREFIX` (top of file): same prefix.
   - `completeness.py` → `BOOK` path and the `titles` map (filename ↔ session) + session
     count/`range`, to match the new book's sessions.
4. Run `python convert.py <N>` per session; place outputs as `NN-Title.md` in the book's
   `sessions/` (zero-padded, descriptive — the nav strips the `NN-` prefix; see §5).
5. Run `python convert_matter.py` for Opening/Recall/Further. **Front Matter is hand-adapted**
   from the Bond PDF (the Series Introduction + Session Overview are generic — change only
   title/subtitle/CC-BY-SA copyright/book-specific lines; see §10 + `MATTER_DECISIONS.md`).
6. Verify (§6): structural render check + `python completeness.py` (expect ~100% word-for-word) +
   eyeball key regions.
7. Deploy: commit the resources repo + `POST /api/refresh`. The website only needs a deploy if
   you changed parser/CSS (usually not — the include engine, `<Accent>`, infographics, and the
   session template are already shared/deployed).

What's ALREADY shared (nothing to redo per book): the 5 infographics + the five movement intros,
section directions, and shared question sets all live in `commonSeries.md` and are pulled by
`@include`. Steve's standing decisions in §4 apply. Note: `ID_PREFIX` currently defaults to
`"TheStory"` (the "Final" tag was dropped) — change it for each new book.

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
  written to `commonSeries.md` as `<SeriesIntroduction>` (full prose + a markdown **all-books
  summary table** for all 3 subseries / 10 volumes) and `<SessionOverview>` (full fivefold
  movements). Both books' `00-Front-Matter.md` now just `@include` these; only title/subtitle
  + Copyright stay inline (no per-book "this volume" paragraph — the table covers every book).
  **Book 1's front matter was ALSO corrected** and wired to the same includes → its output now
  renders the full authoritative version (this changes the live book 1 front matter, as
  approved). Fixes applied to the PDF text: `Chrisitanity`→`Christianity`, `Christiain`→
  `Christian`, `journal- like`→`journal-like`, `(meta) narrative`→`(meta)narrative`, em-dash
  spacing collapsed, `The Story Behind it All`→`…It All`, and `(see series summary on previous
  page)`→`(…above)`. Dropped from the table: the three per-subseries descriptor paragraphs
  (redundant with intro ¶2). Copyright year still the `2024` placeholder.

**Validation (2026-07-28):** all 24 `@include` keys used across the book resolve to defined
blocks (`commonSeries.md` + this book's `commonBook.md`); no `bold=`/`active=` params used
(no param-resolution risk). Full inventory present: `00-Front-Matter`, `00-The-Opening`,
`01-The-Way … 12-The-Contest`, `13-The-Recall`, `14-Further-Resources`.

**Verification note:** `completeness.py` covers only the 12 sessions (not matter). Sessions
were checked with the structural sweep + completeness; matter pages were eyeballed. Live
visual review pending push (book is `status: hidden`, admin-only).

**Nothing pushed yet** — all changes local, per Steve's "convert all, then push all together."
Source-typo flag from S1 also stands: synopsis "Redemption" row reads `rest (1:93:1)` (should
be `1:9; 3:1`) — fix in the Google Doc.
