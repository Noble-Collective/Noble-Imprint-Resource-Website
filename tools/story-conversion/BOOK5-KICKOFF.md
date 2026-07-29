# Kickoff prompt — Book 5: "The Glory Due His Name"

Paste everything below the line into a fresh Claude Code session (run from `C:\Users\Steve\Dev`).

---

Convert the 5th Narrative Journey → Essentials book, **"The Glory Due His Name"** (Christian
**Devotion**), to the shared-content "final format," exactly as we did for books 1–4. **This book is
different: there is NO interior PDF and NO Opening / Recall / Further-Resources manuscript Docs — only
the 12 session Docs exist.** So the 12 sessions convert normally, but ALL four non-session files are
built from the **shared `@include` blocks** (already used by books 1–4) plus **heading / "Coming
soon." placeholders** for every book-specific slot (there is no source to fill them yet).

## READ FIRST (in this order)
1. `Noble-Imprint-Resource-Website/tools/story-conversion/CONVERSION.md` — esp. **§2b** (NEW-book
   checklist), **§2c** (the COMMONIZED Opening/Recall), **§2d** (the **matter-less book** pattern —
   this book), **§11** (book-2 worked example), **§12** (front-matter structure).
2. `Noble-Imprint-Resource-Website/tools/story-conversion/NARRATIVE-JOURNEY-CONVERSION-SUMMARY.md`
   — the **Book 5** section + the shared-element change log + the Book-4 log (matter build details).
3. Memory notes: `project_the_glory_due_his_name`, `project_the_bond_between_us` (book-4 build +
   scripts), `project_common_content_includes`, `feedback_trace_downstream_automation`,
   `feedback_no_regen_without_approval`, `feedback_present_options`, `feedback_no_library_content`,
   `feedback_always_push`, `feedback_no_deploy_without_approval`.

## REPOS
- Website + tooling: `C:\Users\Steve\Dev\Noble-Imprint-Resource-Website`
- Content (source of truth): `C:\Users\Steve\Dev\Noble-Imprint-Resources`
- Book folder (already exists as a Preview stub): `series/Narrative Journey Series/Essentials/The
  Glory Due His Name/` — has an empty `commonBook.md`, a `cover.svg`, a Preview `meta.json`, and a
  stale preview `sessions/session1.md` (remove at push). `series.order` = 5.

## BOOK-5 INPUTS
- **ID_PREFIX** = `TheGloryDueHisName`
- **Subtitle**: `A Narrative Journey of Christian Devotion` (confirmed — from book-4 PDF p.1 series list).
- **Theme note:** the sessions are baptism / water / table / sacrament themed (e.g. S1 Catechism =
  "Q: Upon what foundation does Christian baptism rest? A: Salvation," with a Luther *Smaller
  Catechism* quote). Key Elements (Key Passage / Scripture Memory / Catechism) **are present in each
  session Doc** — those convert normally.
- **Accent** = `#25a9ad` (teal) — **confirmed by Steve** (from `cover.svg`; no PDF). Set
  `meta.json` `"accent": "#25a9ad"`, all heading `color` levels = it, `"banner": "Pre-Release"`,
  `order` 5, `maxNavHeadingLevel` 3.
- **Creed = placeholder** — **confirmed by Steve**. No creed text exists (no PDF; each session Doc's
  "Creedal Statement" is an unfilled "Statement"). Use **`CREED_KEY = "DevotionCreed"`** and ship a
  placeholder block in `commonBook.md`:
  ```
  <DevotionCreed>
  Coming soon.
  </DevotionCreed>
  ```
  This is REQUIRED — `convert.py` emits `@include: DevotionCreed` for every session's Creedal
  Statement (and the Opening uses it), so the block must exist or the page throws. (Rename the key
  everywhere if the real creed is provided later — it's a placeholder name.)
- **`status`** — default **`public`** (book 4 was public); flip to `hidden` only if Steve says so.
- **Everything else that normally came from the PDF / matter Docs** (Introductory Quotes, Opening Key
  Elements, Growth-Evaluation rubric, Selected Passages / Recommended Reading, bibliography, reading
  plan) → **placeholders** (see STRATEGY).

### Session Google Doc IDs (curl `https://docs.google.com/document/d/<ID>/export?format=md`)
Folder: `drive.google.com/drive/folders/1KemhlhM2JSFPlUAJI_HbLvn12UzSRFOD`

| # | Title | Key Passage | Doc ID |
|---|-------|-------------|--------|
| 1 | The Water    | Genesis 6:1–9:17     | 16NDd1ugi1Ki6U9MB_vNFbGWtyQQSSvWimOsY5JBlUWQ |
| 2 | The Sea      | Exodus 13:17–15:21   | 1yBRhuKPOVgYvuAR1Zwmpx7rfbnCk292pglt6ZhUVUe0 |
| 3 | The River    | 2 Kings 5:1–27       | 1al4PeysMlQ-a917JMyZDTn5KS1Eh6hU7i9l9aIDzrKk |
| 4 | The Jordan   | Matthew 3:1–17       | 1JGtJm4OesGDg0Ug4KGOheszEogd8bcSlQTECuWIc76E |
| 5 | The Water ⚠  | Acts 8:1–40          | 1pDHBO6qTOJ0VzL6BS_l34-OwFDH0XuhzNeQ-L6ey7Vc |
| 6 | The Cleansing| Ezekiel 36:16–37:28  | 1RmnD7Ld0ICMqCWgF66-Mqww9Sb7M_umxpkhrFjWdnjY |
| 7 | The Valley   | Genesis 14:1–24      | 1eoeSLp0Tc2i9uSyY-EO4hSlmmD3gbjjXaB5MOSeoEaY |
| 8 | The Lamb     | Exodus 11:1–13:16    | 1_moEPZoL7m19Tdnj8VKQNAzGtGTz5AUx9Ceg82EQqv4 |
| 9 | The Mount    | 1 Kings 17:1–19:21   | 1aT1AqGcAtqV-YcoANYzd-sAngd85c7OEe84PRlGhHxU |
| 10| The Feeding  | John 6:1–71          | 1UEKkLtJJTWWpkJsyM18FtM-GkD3wNZX12Rhtcs29SvE |
| 11| The Supper   | Matthew 26:1–75      | 1yys9tsOGgAQ-LfNI6cJW0RV3kzrbprx2dc_-r_p2nkA |
| 12| The Banquet  | Revelation 19:1–21   | 1UgROjEsAT1oBKyHByeN26-JsfgXKyFmtJua_h0xFzec |

(A 13th Doc in the folder — `10A_x8GFKpQBmcjMVdgTNGUcNM1o7OIjuj7BG7G4KFh4`, H1 "Header 1" — is NOT a
session; ignore it.)

**⚠ DUPLICATE TITLE — S1 and S5 are BOTH "The Water" — LEAVE AS-IS for now (Steve, 2026-07-29).**
S1 = Genesis 6:1–9:17 (flood); S5 = Acts 8:1–40 (Philip / the Ethiopian's baptism). Per Steve, keep
both titled "The Water" for now → files `01-The-Water.md` and `05-The-Water.md`; the nav will show
**two identical "The Water" entries**. Don't rename either. **This is flagged in the per-book
conversion notes (SUMMARY doc, Book-5 section) to revisit later** (cf. book-3 S10 "The Temple"
mislabel).

Filenames: `01-The-Water`, `02-The-Sea`, `03-The-River`, `04-The-Jordan`, `05-The-Water`,
`06-The-Cleansing`, `07-The-Valley`, `08-The-Lamb`, `09-The-Mount`, `10-The-Feeding`, `11-The-Supper`,
`12-The-Banquet`, `00-Front-Matter`, `00-The-Opening`, `13-The-Recall`, `14-Further-Resources`.

## STRATEGY (matter-less book)
- **Sessions 1–12:** identical to books 1–4 — `convert.py` reuses ALL common elements (5 infographics,
  5 movement intros, section directions, shared question sets, creed include) via `@include`; grabs
  only the unique manuscript prose. Key Elements come from each session Doc. The **creed block must
  exist** (placeholder) since each session emits `@include: {CREED_KEY}`.
- **The 4 non-session files — shared `@include`s + placeholders:**
  - **Front Matter (§12):** `@include` `NarrativeJourneySeriesList` / `PublishingLicensing` /
    `SeriesIntroduction` / `SessionOverview`. Book-specific: Publishing title line (`_The Glory Due His
    Name: A Narrative Journey of Christian Devotion_, Pre-Release Edition`); Introductory Quotes →
    **placeholder** ("Coming soon." or a `## Introductory Quotes` heading with empty body — no PDF p.1).
  - **The Opening (§2c):** template off book 4's `00-The-Opening.md`; reuse ALL 16 `Opening_*` blocks
    + `Opening_SessionFrameworkInfographic`. Book-specific: creed include (placeholder block); Key
    Elements → `____`; **Core Content + Planning Calendar tables CAN be built from the 12 session
    titles + Key Passages** (above) — fill Session+passage, leave Focus/Teacher/Date blank; Key Idea /
    Discussion / Personal-Interest questions / Significant Quote / Project Preview / Example → "Coming
    soon." placeholders; Growth Outcomes + Imaginative Storytelling → keep the shared boilerplate
    (as books 3–4 did).
  - **The Recall (§2c):** template off book 4's `13-The-Recall.md`; reuse ALL 17 `Recall_*` blocks
    (Discussion Questions + Next Steps take `id="TheGloryDueHisNameRecall-…"`). Book-specific: Key
    Elements → `____`; Conclusion → "Coming soon."; Selected Passages / Recommended Reading → blank
    3-col tables (Session rows, empty Topic/Passages); Growth Evaluation → blank rubric skeleton (no
    PDF — mirror book-1/2's blank template, or a simple placeholder); Core-Project capstone subsection
    → "Coming soon."
  - **Further Resources:** **heading-only placeholder** (per-session `#### Session N: <title>` under
    Bibliography + Reading Plan) — same as books 1–3, since there's no Further Doc/PDF.
- **Do NOT run the book-4 extraction scripts** (`scratchpad/build_creed.py`, `build_matter.py`,
  `build_further.py`, `build_learningplan.py`) — they all read the PDF, which doesn't exist. Hand-build
  the matter by templating off book 4 with placeholders. (A tiny generator for the Core Content /
  Planning Calendar tables from the 12-session table above is fine.)

## DO (follow §2b + §2c + §2d)
1. **Back up** the prior book's `docs/` (`docs/_the-bond-between-us/`), then `curl` the **12 session
   Docs** into `docs/` as `session1.md … session12.md` (no opening/recall/further — they don't exist).
   Sanity-check sizes + H1s (watch the two "The Water" titles).
2. **Per-book script settings:** `convert.py` → `ID_PREFIX="TheGloryDueHisName"`,
   `CREED_KEY="DevotionCreed"`; `completeness.py` → `BOOK` path + `titles` map (The Water … The
   Banquet; note S1 and S5 are both `The Water`). (`convert_matter.py` not used.)
3. **`commonBook.md`** — the placeholder creed block `<DevotionCreed>Coming soon.</DevotionCreed>`
   (required so the per-session + Opening `@include: DevotionCreed` resolves).
4. **`meta.json`** — `"accent": "#25a9ad"`, all heading `color` levels = `#25a9ad`,
   `"banner": "Pre-Release"`, `"status": "public"`, `order` 5, `maxNavHeadingLevel` 3.
5. **Convert Session 1 (The Water) FIRST** as a calibration pass; let Steve review before 2–12.
6. **Matter:** build the 4 non-session files per STRATEGY (shared includes + placeholders; Core
   Content / Planning Calendar tables from the session lineup).
7. **Verify:** `completeness.py` (expect 12/12; watch for the Catechism-label + any first-letter-bold
   artifacts); structural sweep (5 infographics + 5 movement intros + 1 creed include per session; 0
   stray tags; 0 open `@include`); **resolve ALL `@include` keys with the REAL parser**
   (`resolveIncludes` + `parseCommonBlocks`) → 0 leftover; `renderMarkdown` spot-check. Node one-liners
   in §11 / the book-4 log.
8. **Deploy** (only after Steve's go-ahead): commit the CONTENT repo + `POST
   https://resources.noblecollective.org/api/refresh`. Content push is SAFE re: audio (auto-gen
   disabled). No website deploy unless you change `src/`. Remove the stale preview `session1.md`.

## GUARDRAILS
- **Session 1 calibration first**, review before 2–12.
- **Present options** before consequential/irreversible decisions; **no deploy without Steve's explicit
  go-ahead**; trace `.github/workflows` push/dispatch triggers before pushing (audiobook auto-gen is
  disabled — do NOT re-enable/regenerate).
- Keep `NARRATIVE-JOURNEY-CONVERSION-SUMMARY.md` + CONVERSION.md updated for anything you change in
  shared content or tooling. Don't touch other library content without asking.
- Standing decisions: **no per-session creed bold / active practice dot** unless Steve specifies; keep
  "Catechism" as the uniform bold Key-Elements label.

## DECISIONS (all confirmed by Steve 2026-07-29 — no need to ask again)
1. **Accent** = `#25a9ad` (teal, from cover.svg).
2. **Creed** = placeholder block `<DevotionCreed>Coming soon.</DevotionCreed>` in `commonBook.md`
   (`CREED_KEY = "DevotionCreed"`); real creed TBD later.
3. **Duplicate title** = leave BOTH S1 and S5 as "The Water" for now (flagged in the SUMMARY per-book
   notes to revisit); don't rename either.
4. **status** = `public` (matching book 4).

Only remaining ask before deploy is the standard **"review Session 1 calibration, then go-ahead to
convert 2–12 and to deploy."**
