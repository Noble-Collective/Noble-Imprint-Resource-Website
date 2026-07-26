# Story-Conversion Process & Notes

Running doc for converting Google-Doc session manuscripts into the custom session
markdown used by the Noble Imprint website/app. Built for **"The Story Behind It
All (Final)"** (Narrative Journey Series → Essentials); the same pipeline is meant
to be reused for the rest of the series.

_Last updated: 2026-07-26 — all 12 sessions built, verified, and live (book is `status: hidden`)._

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
- Live (admin-only, hidden): `resources.noblecollective.org/narrative-journey-series/essentials/the-story-behind-it-all-final/<slug>`
  where slug is `01-the-battle` … `12-the-finale`.
