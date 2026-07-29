# Gameplan — Improving "The Opening" across the Narrative Journey → Essentials books

_2026-07-29. Analysis of the three built Openings (The Story Behind It All, The Best Possible
Life, The Open Invitation) + the Bond Between Us interior pp. 20–35 (its Opening session), with
a plan to (A) share common content, (B) add the missing framework diagram, (C) convert two
sections to tables, and (D) fix inconsistencies. Mirrors the Recall refactor already shipped._

## Current state

All three Openings have a near-identical structure but are **100% inline — zero `@include`**
(same situation the Recall was in before its refactor). Structure:

```
# The Opening
## Overview
  ### Creedal Statement        (book 1 ONLY — books 2 & 3 omit it)
  ### Key Elements             (Key Passage / Scripture Memory / Catechism)
## (Book Overview:) Surveying the Landscape
  <directions>  ### Core Content  ### Key Idea  ### Personal Interest
## Faith Foundation: Exploring the Terrain
  <directions>  ### Discussion Questions  ### Significant Quote
## Learning Plan: Charting the Course
  <directions>  ### Session Framework  ### Planning Calendar
## Core Project: Synthesizing the Faith
  <directions>  ### Project Preview  ### Example Creed/Code  ### Imaginative Storytelling
## Faith Practice: Following the Way
  <directions>  ### Growth Outcomes  ### Focused Area  ### Community Prayer
```

A large fraction of the prose (all the italic section directions + several instructional
paragraphs) is **byte-identical across the books** — verified by reading books 1 & 2 side by side.

---

## A. Extract shared content → `commonSeries.md` `Opening_*` blocks

Same pattern as the Recall (`Recall_*` blocks). These are identical across books and should be
`@include`d. Proposed keys (≈19 blocks):

| Key | Content (identical across books) |
|---|---|
| `Opening_BookOverview_Directions` | "_Discipleship is a process of establishing believers…_" |
| `Opening_CoreContent_Directions` | "An outline of Christian teaching is like a map…" |
| `Opening_KeyIdea_Directions` | "Faithful disciples plant firm roots in the soil of biblical principles…" |
| `Opening_PersonalInterest_Directions` | "The essentials of the Christian faith are extremely relevant…" |
| `Opening_PersonalInterest_Questions` | the 2 interest questions (use `{id}`; near-identical, normalize) |
| `Opening_FaithFoundation_Directions` | "_God calls his people to move beyond a superficial understanding…_" |
| `Opening_Discussion_Directions` | "Disciples progress in the faith in the context of committed Christian community…" |
| `Opening_SignificantQuote_Directions` | "Christians learn from believers who live in different generations and cultures…" |
| `Opening_LearningPlan_Directions` | "_Formative biblical interpretation fosters Christian growth…_" |
| `Opening_SessionFramework_Intro` | "The Scriptures bear authority… In the Narrative Journey series, a common study framework… Review the five movements…" |
| `Opening_PlanningCalendar_Directions` | "Wisdom calls believers and the community to approach an ordered process…" |
| `Opening_CoreProject_Directions` | "_Genuine disciples integrate the truth of God's word…_" |
| `Opening_ProjectPreview_Criteria` | the 5 criteria bullets (short / memorable / usable / accurate / comprehensive) |
| `Opening_ImaginativeStorytelling_Directions` | "Believers in Jesus look forward to the future with hope…" |
| `Opening_FaithPractice_Directions` | "_Discipleship involves a lifetime of following Jesus…_" |
| `Opening_GrowthOutcomes_Directions` | "Setting growth goals helps to refine our Christian walk…" |
| `Opening_FocusedArea_Directions` | "Growth in the Christian life often happens one step at a time…" |
| `Opening_CommunityPrayer_Directions` | "We depend upon God's power to grow each step…" |

Headings stay in each book file (readability), exactly like the Recall.

**Stays book-specific (inline):** Key Elements (Scripture Memory/Catechism), the Introduction
essay + quotes, the Core Content session descriptions, the Key Idea statement, the 3 Discussion
Questions (they're theme-specific, unlike the Recall's identical ones), the Significant Quote,
the Project Preview noun ("creedal statement" / "code of godly living" / book-3 equivalent) and
its Example, the Imaginative-Storytelling prompts, and the 4 Growth Outcomes.

---

## B. New shared graphic — the Session Framework cycle diagram (biggest visual win)

Bond p.30 renders the five-movement hermeneutic as a **circular cycle diagram** (dotted arrows
around a ring; each movement = an icon + a two-line title + a small italic caption):

- **Biblical Interpretation — Hearing the Word** (open-book icon): "exploring the textual details of the biblical passage"
- **Theological Dialogue — Discussing the Plot** (people icon): "discerning timeless truths of the Christian faith"
- **Personal Reflection — Entering the Story** (compass icon): "practicing God's ways in our personal lives"
- **Ministry Practice — Rehearsing the Script** (quill icon): "edifying the church community with God's word"
- **Missional Outreach — Publicizing the Truth** (globe icon): "engaging the unbelieving world with gospel proclamation"

Our Openings currently only say "Review the five movements…" with **no visual**. This diagram is
**generic to the whole series** (identical in every book), so it should be **one shared block**,
e.g. `Opening_SessionFrameworkInfographic`, `@include`d in every Opening's Session Framework
section. Implementation options:
- **Preferred:** extend the existing `<Infographic>` renderer with a `type="cycle"` layout (a
  ring of nodes with connectors), reusing the Font Awesome icon plumbing already built for the 5
  session infographics. The five movements + captions already exist as data (movement intros /
  SessionOverview), so this is a rendering feature, not new content.
- Fallback: a hand-authored inline SVG block (like the `triquetra` / narrative-arc custom SVGs).

This is a website (`src/`) change (parser + CSS) plus one shared content block.

---

## C. Convert two sections to tables (Bond style; pairs with the accent header CSS already shipped)

1. **Core Content** (Bond p.26) → a **2-column table**: `Session (passage) | thematic description`,
   alternating row shading. Currently a bullet list in all 3 books. Book-specific content, shared
   table shape. Bond also adds a **sideways part-label** grouping the 12 into halves ("Family and
   Social Relationships" / "Church and Community Life"); our books have no such part-grouping yet —
   optional book-specific enhancement (needs author input for the group names).
2. **Planning Calendar** (Bond p.31) → a **3-column table**: `Biblical Passage | Teacher | Date`,
   with Teacher/Date cells **left empty** for the church to fill in. Currently a bare session
   bullet list. (Same treatment as the Recall passage/reading tables — accent header, empty cells.)

Both tables inherit the accent-colored header + row shading from the CSS change already deployed.

---

## D. Consistency / quality fixes found along the way

1. **Heading mismatch:** book 1 & book 3 use `## Survey the Landscape`; book 2 uses
   `## Book Overview: Surveying the Landscape` (matches Bond). Standardize all three to
   **"Book Overview: Surveying the Landscape"**.
2. **Creedal Statement in the Overview:** book 1 shows the full example creed under Overview →
   Creedal Statement; books 2 & 3 omit it. Decide one way for all three (Bond shows its covenant
   in the Opening, so *include* is the likely call — but it duplicates the "Example Creed" section,
   so possibly drop it from Overview instead). **Needs Steve's decision.**
3. **Book 2 stubs:** its **Significant Quote is empty** (directions but no quote), and its
   **Example Code is a stray `==We live==` placeholder**. Book 3's Significant Quote is likely
   empty too. Fill or flag.
4. **Book 2 source-Doc typos** (already logged): "aAn heir", "leads tointo", "Chrisitan".
5. **Project Preview wording drift:** book 2 mixes labels ("code of godly living" vs "community
   covenant" vs "creed" in the same section). Tidy per book.

---

## E. Suggested sequence (each step verified byte-identical / rendered, then deployed)

1. **Shared-block extraction (A):** add the ~19 `Opening_*` blocks to `commonSeries.md`, wire all
   3 books via `@include`, verify the resolved output is byte-identical to today (pure refactor).
2. **Tables (C):** convert Core Content + Planning Calendar to tables in all 3 books.
3. **Framework diagram (B):** build the `type="cycle"` infographic (website), add the shared
   `Opening_SessionFrameworkInfographic` block, wire into each Opening. Screenshot-verify vs Bond.
4. **Consistency fixes (D):** standardize headings, resolve the Creedal-Statement question, fill/
   flag book-2 stubs.
5. Update `NARRATIVE-JOURNEY-CONVERSION-SUMMARY.md` + memory.

Steps 1, 2, 4 are content-only (fast). Step 3 is the one `src/` + deploy piece.

---

## Open questions for Steve
- **B:** build the cycle diagram as a reusable `<Infographic type="cycle">` renderer (preferred),
  or a one-off inline SVG?
- **C:** add the sideways part-grouping labels to Core Content? (needs per-book group names)
- **D2:** keep or drop the example creed in the Overview (consistently across all 3)?

---

## Progress & status (2026-07-29)

- **A — shared extraction: DONE & LIVE** (content `9e4f97f`). 16 `Opening_*` blocks in
  `commonSeries.md`, `@include`d by all 3 books; heading standardized to "Book Overview:
  Surveying the Landscape"; verified pure refactor.
- **C — tables: DONE & LIVE** (content `86e2a90`). Core Content → `Session | Focus`;
  Planning Calendar → `Biblical Passage | Teacher | Date` (empty Teacher/Date). Also fixed
  book 3's Core-Content Session 3 missing-paren typo.
- **B — Five Movements cycle diagram: NOT SHIPPED (needs a focused build).** First attempt was
  an accent-card CSS cycle; it read as one of our gold infographic cards, not Bond's diagram.
  Reverted. Spec for the real build:
  - Match Bond p.30: **light/white** field, **accent** ring + icons + text (not a gold card);
    dark serif movement titles (bold name + subtitle) + small italic captions; **directional
    arrows** on the ring; the **icon circles sit ON the ring**, text radiates outward.
  - Recommended implementation: a **self-contained inline SVG** (ring + arrowhead markers +
    node circles) with the 5 movement labels/captions — OR an SVG backdrop (ring+arrows) with
    HTML icon-circles + text positioned over it (HTML text avoids SVG caption line-wrapping pain).
  - Gotchas learned: (1) a `<br>` inside an `<Item label="…">` breaks the `<Item([^>]*)>`
    parser (its `>` closes the tag) — don't put `>` in labels; (2) the wide-screen **menu**
    layout draws `.info-item::before/::after` (spine node + connector) that bleed into any other
    layout reusing `.info-item` — a `cycle` layout must suppress them.
  - Data (identical across books, series-generic): Biblical Interpretation / Hearing the Word —
    "exploring the textual details of the biblical passage"; Theological Dialogue / Discussing
    the Plot — "discerning timeless truths of the Christian faith"; Personal Reflection /
    Entering the Story — "practicing God's ways in our personal lives"; Ministry Practice /
    Rehearsing the Script — "edifying the church community with God's word"; Missional Outreach /
    Publicizing the Truth — "engaging the unbelieving world with gospel proclamation".
- **D — creed consistency: BLOCKED on content.** Book 1's Overview shows its example creed;
  books 2 & 3 can't match because their capstone examples aren't written (book 2's is the stub
  `==We live==`, book 3's is unwritten). Needs the real example text for 2 & 3, or a decision to
  drop the Overview creed from book 1 for consistency-by-removal.
