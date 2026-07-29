# Kickoff prompt — Book 4: "The Bond Between Us"

Paste everything below the line into a fresh Claude Code session (run from `C:\Users\Steve\Dev`).

---

Convert the 4th Narrative Journey → Essentials book, **"The Bond Between Us"** (Christian
**Community**), to the shared-content "final format," exactly as we did for books 1–3 ("The Story
Behind It All," "The Best Possible Life," "The Open Invitation"). This is a turnkey pipeline — most
scaffolding is already shared; you're grabbing this book's unique prose and dropping in its
book-specific bits.

## READ FIRST (in this order)
1. `Noble-Imprint-Resource-Website/tools/story-conversion/CONVERSION.md` — esp. **§2b** (the
   NEW-book checklist), **§2c** (the COMMONIZED Opening/Recall — this is the big change since
   book 2 and is NOT in `convert_matter.py`), **§11** (book-2 worked example), **§12** (front-matter
   structure).
2. `Noble-Imprint-Resource-Website/tools/story-conversion/NARRATIVE-JOURNEY-CONVERSION-SUMMARY.md`
   — the **Book 4** section (all inputs, repeated below) + the shared-element change log.
3. Memory notes: `project_the_open_invitation` (if present) / `project_the_best_possible_life` /
   `project_the_story_behind_it_all_final`, `project_common_content_includes`,
   `feedback_trace_downstream_automation`, `feedback_no_regen_without_approval`,
   `feedback_present_options`, `feedback_no_library_content`, `feedback_always_push`,
   `feedback_no_deploy_without_approval`.

## REPOS
- Website + tooling: `C:\Users\Steve\Dev\Noble-Imprint-Resource-Website`
- Content (source of truth): `C:\Users\Steve\Dev\Noble-Imprint-Resources`
- Book folder to create: `series/Narrative Journey Series/Essentials/The Bond Between Us/`

## BOOK-4 INPUTS (all confirmed — no need to ask Steve for these)
- **ID_PREFIX** = `TheBondBetweenUs`
- **Creed** = **A Christian Community Covenant** — book-level in `commonBook.md` as
  `<CommunityCovenant>` (`CREED_KEY = "CommunityCovenant"`). Source: interior PDF p.19 (the analog
  of book 3's Lord's-Prayer creed page). Two stanzas:
  > We prize the family as a bedrock of faith formation, / we cherish marriage as a most holy and
  > most sacred union, / we value parents as frontline shepherds to disciple their children, / we
  > treasure friends as our own souls, / we engage society as godly citizens with redemptive
  > purpose, and / we embrace our lifework with a God-centered focus. / We confess the church as
  > Christ's family, a family called to: treat other members with genuine care, steward our
  > possessions for the common good, honor appointed leaders and participate in Christ's worldwide
  > body, engage the domains of the world with the truth of the gospel, and represent Christ to all
  > those who are far and near.

  Attribution `<< A Christian Community Covenant`. Build it with a small script that reads the PDF
  (keep the text out of model output — the book-2 content filter tripped on decontextualized creed
  lines). Mirror the `<TenCommandments>` / `<LordsPrayer>` block style (hard line breaks, straight
  quotes).
- **Accent** `#de6d36` (orange) — from the interior PDF. `meta.json`: `"accent": "#de6d36"`, set
  all heading `color` levels to it (mirror books 1–3), `"banner": "Pre-Release"`,
  `"maxNavHeadingLevel": 3`, `series.order` = 4. Ask Steve whether to start `status: hidden` or
  `public` (book 3 was built public).
- **Interior PDF**: `Downloads/The Bond Between Us_Interior_v15 (bleed).pdf`. Use it ONLY for: the
  creed text, the accent, the Opening Key Elements, and the page-1 Introductory Quotes. NOTE this
  is the SAME PDF the shared Series Introduction / Session Overview / Growth-Evaluation grid were
  extracted from — so book 4 is the "home" book for that shared content.
- **Opening Key Elements** (PDF p.20): Key Passage = *Preview*; Scripture Memory = "We … are one
  body in Christ, and individually members one of another." (**Romans 12:5**); Catechism —
  Q: "How are Christians to relate to one another?" A: **Community**.
- **Opening Introductory Quotes / Introduction epigraphs** (PDF pp.1, 21): 1 Timothy 3:14–15 +
  Charles Spurgeon, *Satanic Hindrances*.

### Google Doc IDs (curl `https://docs.google.com/document/d/<ID>/export?format=md`)
| # | Title | Doc ID |
|---|-------|--------|
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

Matter Docs: **Opening** `1u8_Sv1aqGhE7Zh0xcSpG6dzuHf5SXAzV2J3YBgqvQeM`, **Recall**
`1nhNvnyEoBgnsFDGnBDR-rxQGbKkxwEFPSur8LltdGUI`, **Further** `1EutVos8p72dHxXqSo5ACUvtIY0MarUQtH1eD0jyXlqo`.

Filenames: `01-The-Household … 12-The-Other`, `00-Front-Matter`, `00-The-Opening`,
`13-The-Recall`, `14-Further-Resources`.

## STRATEGY (Steve's, for this book)
- **Sessions 1–12:** reuse ALL common elements (5 infographics, 5 movement intros, section
  directions, shared question sets, the creed include) via `@include`; grab ONLY the unique
  manuscript prose (intro/commentary/synopsis/questions/practice). `convert.py` already does this.
- **Front matter / Opening / Recall — special handling:** copy the shared content first, then grab
  any genuinely book-specific bits from the manuscript. The Opening & Recall are **commonized** (see
  CONVERSION.md §2c) — template off book 3's `00-The-Opening.md` / `13-The-Recall.md` (all
  `@include`s + table skeletons are book-agnostic), then swap in book-4's Key Elements, the
  `CommunityCovenant` creed include in the Opening Overview, the `id="TheBondBetweenUsRecall-…"`
  params, and the table contents. **Do NOT run `convert_matter.py` for Opening/Recall** — it still
  emits the old flat format.
- **⚠ Flag copy-paste:** if any "unique" Opening/Recall/session content looks lifted from books
  1–3, STOP and check with Steve (every prior book had ≥1 stale matter Doc — book 1 & 2 & 3 all
  shipped Further Resources as a placeholder; book 3's Recall Doc was stale book-1 content too).
  Default to a heading-only placeholder for a stale Doc.

## DO (follow CONVERSION.md §2b + §2c end to end)
1. **Back up** the prior book's `docs/` (`docs/_the-open-invitation/`), then `curl` the 15 Docs
   into `docs/` as `session1.md … session12.md` + `opening.md recall.md further.md`. Sanity-check
   sizes (not sign-in HTML).
2. **Per-book script settings:** `convert.py` → `ID_PREFIX="TheBondBetweenUs"`,
   `CREED_KEY="CommunityCovenant"`; `convert_matter.py` → `ID_PREFIX` (only if you use it for
   Further); `completeness.py` → `BOOK` path + `titles` map (The Household … The Other).
3. **`commonBook.md`** — the `<CommunityCovenant>` creed (build from PDF via a small script).
4. **`meta.json`** — accent/headings/banner/order/status as above.
5. **Convert sessions:** `python convert.py <N>` per session → place as `NN-Title.md`. Watch WARN
   lines (empty Passage Outline is expected). **Do Session 1 (The Household) FIRST as a calibration
   pass and let Steve review before 2–12.**
6. **Matter (§2c):** template Opening & Recall off book 3; convert Further OR ship a heading-only
   placeholder if its Doc is stale. Front matter in the §12 structure (Introductory Quotes inline
   from PDF p.1; everything else `@include`d).
7. **Verify:** `python completeness.py` (expect 12/12 100% — book 3 shows 1 benign "question"
   delta from the Catechism-label normalization; watch for the same); structural sweep (5
   infographics + 5 movement intros + 1 CommunityCovenant creed per session; 0 literal
   `<Item>`/`<Infographic>`/other-creed tags; 0 un-commented `@include`); **resolve ALL `@include`
   keys with the REAL parser** (`require` `resolveIncludes` + `parseCommonBlocks`) → 0 leftover;
   `renderMarkdown` spot-check (tables merge, links, no throw). Node one-liners are in §11.
8. **Deploy** (only after Steve's go-ahead): commit the CONTENT repo + `POST
   https://resources.noblecollective.org/api/refresh`. Content-repo push is SAFE re: audio
   (audiobook auto-gen is disabled — do NOT re-enable or regenerate). Expect to rebase over
   Playwright Test-Book churn commits. No website deploy unless you changed `src/`.

## GUARDRAILS
- **Session 1 calibration first**, review before 2–12.
- **Present options** before consequential/irreversible decisions; **no deploy without Steve's
  explicit go-ahead**.
- Keep `NARRATIVE-JOURNEY-CONVERSION-SUMMARY.md` (per-book + shared change log) and CONVERSION.md
  updated for anything you change in shared content or tooling.
- Don't touch other library content without asking; don't re-enable/trigger audiobook generation.
- Standing decisions: **no per-session creed bold / active practice dot** unless Steve specifies;
  keep "Catechism" as the uniform bold Key-Elements label.

## OPTIONAL TOOLING UPGRADE (Steve's call)
Before or after book 4, consider upgrading `convert_matter.py` to emit the commonized Opening/Recall
directly (inject the `Opening_*`/`Recall_*` includes, build the tables, drop the creed include into
Overview, apply placeholder conventions) so books 5–7 come out right in one pass. Present it as an
option; don't do it silently.
