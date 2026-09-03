# Content Rendering Guide for App Developers

This document describes the custom Markdown syntaxes used in Noble Imprint book content and how each is rendered, so the mobile/desktop app can render sessions the same way the website does.

**Source of truth:** `src/renderer/parser.js` (function `preprocess`) in this repo is the authoritative implementation of every custom syntax below. When in doubt, read that file — this guide summarizes it.

**Related:** audio playback + sentence-level text-sync are documented separately in the audiobooks repo's `docs/APP-INTEGRATION-GUIDE.md`. A few of the constructs below affect text-sync (duplicated/injected DOM); those interactions are called out there and cross-referenced here.

Each construct links to a **real example in the content repo** (`Content:` — line numbers on `main` as of 2026-09-02, they drift as content is edited) and to a **rendered page on the live site** (`Live:`).

**Last updated:** 2026-09-02.

---

## How content is structured

Books live in the content repo (`Noble-Imprint-Resources`) as Markdown under `series/{Series}/{Subseries?}/{Book}/sessions/{NN-Name.md}`, with a `meta.json` at each level. Sessions are standard Markdown (CommonMark) plus the custom constructs below. The renderer runs three stages: **preprocess** (rewrites the custom tags below to HTML), **markdown-it** (`html: true`), then **post-process** (pullquotes, Bible-reference linking, etc.).

The app should implement the same custom syntaxes. Raw HTML in content is allowed and passes through.

---

## Custom constructs

### Question blocks
```
<Question id="TheCallSes1-Q1">Your reflection prompt text.</Question>
```
Renders to `<div class="question-block" data-question-id="…"><p>…</p></div>` (or a heading element if the content is a `#`-heading). Used for interactive/reflection prompts.

**Content:** [Oration II — 02-ChapterOne.md, line 61](https://github.com/Noble-Collective/Noble-Imprint-Resources/blob/main/series/A%20Library%20of%20Classics/A%20Pastoral%20Shelf/Oration%20II/sessions/02-ChapterOne.md#L61) · **Live:** [oration-ii/02-chapterone](https://resources.noblecollective.org/a-library-of-classics/a-pastoral-shelf/oration-ii/02-chapterone)

### Callout → pullquote
```
<Callout>A short, quotable line from the surrounding text.</Callout>
```
The callout text stays **inline** in its paragraph. Post-processing **also** emits a duplicate `<aside class="pullquote">` copy for visual display (with its first letter capitalized for display if it started lowercase). → The same sentence appears twice in the DOM. This matters for audio text-sync (skip the `aside.pullquote` copy); see the audio guide.

**Content:** [The Best Possible Life — 02-The-Furnace.md, line 156](https://github.com/Noble-Collective/Noble-Imprint-Resources/blob/main/series/Narrative%20Journey%20Series/Essentials/The%20Best%20Possible%20Life/sessions/02-The-Furnace.md#L156) · **Live:** [the-best-possible-life/02-the-furnace](https://resources.noblecollective.org/narrative-journey-series/essentials/the-best-possible-life/02-the-furnace)

### ChapterNum
```
<ChapterNum>1</ChapterNum>
```
Renders to `<span class="chapter-num">1</span>` — a styled inline section/chapter number. Not spoken in audio.

**Content:** [On the Shortness of Life — 02-ChapterOne.md, line 7](https://github.com/Noble-Collective/Noble-Imprint-Resources/blob/main/series/A%20Library%20of%20Classics/A%20Philosophical%20Shelf/On%20the%20Shortness%20of%20Life/sessions/02-ChapterOne.md#L7) · **Live:** [on-the-shortness-of-life/02-chapterone](https://resources.noblecollective.org/a-library-of-classics/a-philosophical-shelf/on-the-shortness-of-life/02-chapterone)

### Accent
```
<Accent>highlighted phrase</Accent>
```
Renders to `<span class="accent" style="color: {accent}">…</span>`, where `{accent}` is the book's `meta.json` `accent` color. Inner Markdown (e.g. `_italics_`) is preserved. Inline — stays within its paragraph.

**Content:** [The Best Possible Life — 00-The-Opening.md, line 71](https://github.com/Noble-Collective/Noble-Imprint-Resources/blob/main/series/Narrative%20Journey%20Series/Essentials/The%20Best%20Possible%20Life/sessions/00-The-Opening.md#L71) · **Live:** [the-best-possible-life/00-the-opening](https://resources.noblecollective.org/narrative-journey-series/essentials/the-best-possible-life/00-the-opening)

### Attribution
```
<< **1 Peter 2:24**
```
A line beginning with `<<` renders to `<div class="attribution">…</div>` (right-aligned source/citation line).

**Content:** [Oration II — 01-FrontMatter.md, line 21](https://github.com/Noble-Collective/Noble-Imprint-Resources/blob/main/series/A%20Library%20of%20Classics/A%20Pastoral%20Shelf/Oration%20II/sessions/01-FrontMatter.md#L21) · **Live:** [oration-ii/01-frontmatter](https://resources.noblecollective.org/a-library-of-classics/a-pastoral-shelf/oration-ii/01-frontmatter)

### Bibliography
```
<Bibliography>

- Author, Name. "Title." _Journal_ 1, no. 2 (Year): 1–10.
- …

</Bibliography>
```
Renders to `<div class="bibliography">` wrapping the inner list (or plain paragraphs). Styling: a Chicago-style **hanging indent — no bullets, left-aligned**, first line flush and continuation lines indented ~2em. The CSS applies to both `<li>` and `<p>` entries, so bibliographies authored as either lists or paragraphs render uniformly. Section subheadings (`##`/`###`) inside the wrapper stay as normal headings. Typically back-matter; not narrated.

**Content:** [Hear, My Son — 10-Bibliography.md, line 3](https://github.com/Noble-Collective/Noble-Imprint-Resources/blob/main/series/Vade%20Mecum/Proverbs%20and%20Faith%20Formation/sessions/10-Bibliography.md#L3) · **Live:** [hear-my-son/10-bibliography](https://resources.noblecollective.org/vade-mecum/hear-my-son/10-bibliography)

### Infographic / Item
```
<Infographic title="The Five Movements" type="menu">
Optional intro sentence. A second sentence starts a new line.
<Item icon="church" label="Gather">Body text for this node.</Item>
<Item icon="book-open" label="Read" active>Body text…</Item>
</Infographic>
```
Renders to a responsive, accent-themed timeline:
```html
<div class="infographic infographic--menu">
  <div class="info-title">…</div>
  <div class="info-intro">…</div>
  <ul class="info-items">
    <li class="info-item"><span class="info-marker">…</span>
      <span class="info-text"><span class="info-label">…</span><span class="info-body">…</span></span>
    </li>
  </ul>
</div>
```
- `type="menu"` uses each item's `icon` as its marker; `type="sequence"` draws a story-arc glyph (a plot mountain) with the current node filled.
- `icon="…"` is a Font Awesome **solid** name (`icon="church"`); the special value `triquetra` renders a custom inline SVG.
- `active` on an `<Item>` emphasizes that node (`.info-item--active`).
- Per-session infographic themes exist (blush / card / outline).
- **Note:** label/body text lives in `<span>`s inside `<li>` — not `<p>`/`<h*>`. If the book is audio-enabled and you sync infographic text, account for this (see the audio guide).

Infographics are commonly authored as shared blocks in `commonSeries.md` and pulled into sessions via `@include`.

**Content:** [commonSeries.md — `<Infographic>` line 72, `<Item>` line 75](https://github.com/Noble-Collective/Noble-Imprint-Resources/blob/main/series/Narrative%20Journey%20Series/commonSeries.md#L72) · **Live:** [the-story-behind-it-all/01-the-battle](https://resources.noblecollective.org/narrative-journey-series/essentials/the-story-behind-it-all/01-the-battle) (5 infographics)

### Images
Two syntaxes:
```
<image My_Image_Name>
![alt text](My_Image_Name "Optional caption")
```
Both render to:
```html
<figure class="session-image"><img src="…" alt="…" loading="lazy"><figcaption>caption</figcaption></figure>
```
For the standard-Markdown form, the optional `"caption"` title becomes the `<figcaption>` (may contain `<br>` for multi-line credits); `alt` stays the accessible short text. If no caption, the image name (underscores → spaces) is used.

**Image format constraint:** the app drops bare VP8 `.webp` images. Content art is stored as `svg`/`png`/`jpg` for app compatibility — ensure the app renders those three; content avoids bare `.webp`.

**Content:** `<image …>` → [Sacred Markings — session1.md, line 35](https://github.com/Noble-Collective/Noble-Imprint-Resources/blob/main/series/Spiritual%20Journals/Sacred%20Markings/sessions/session1.md#L35) · `![alt](…)` → [Come Let Us Adore Him — 1-Front Matter.md, line 143](https://github.com/Noble-Collective/Noble-Imprint-Resources/blob/main/series/Liturgies/Come%20Let%20Us%20Adore%20Him/sessions/1-Front%20Matter.md#L143) — **Live:** [sacred-markings/session1](https://resources.noblecollective.org/spiritual-journals/sacred-markings/session1) · [come-let-us-adore-him/1-front-matter](https://resources.noblecollective.org/liturgies/come-let-us-adore-him/1-front-matter)

### Bible reference links
Inline references like `(Proverbs 1:7)`, semicolon-separated continuations (`1:7; 2:3`), and single-chapter references cited without a chapter are auto-linked to the reader. External and internal prose links take the book's accent color; external links open in a new tab.

**Content:** [A Table In the Wilderness — session2.md, line 36](https://github.com/Noble-Collective/Noble-Imprint-Resources/blob/main/series/Liturgies/A%20Table%20In%20the%20Wilderness/sessions/session2.md#L36) · **Live:** [a-table-in-the-wilderness/session2](https://resources.noblecollective.org/liturgies/a-table-in-the-wilderness/session2)

### Tables
Standard Markdown (GFM) tables render as `<table>`. The renderer post-processes a few patterns — the app should replicate at least the **merged-heading** behavior, or those tables will render as two separate tables:

- **Merged 1-cell heading tables.** A one-cell heading table (`<table>` with a single `<th>`) immediately followed by a body table is **merged into one table**: the heading cell becomes a full-width `colspan` row (`th.table-heading-row`) at the top, and the body table's now-redundant empty header row is removed. This is an authoring pattern used throughout the shared front-matter/series-summary tables — a lone heading row directly above a table means "join them."
- **Fixed-column / responsive tables.** Specific known tables are tagged by their header text so CSS can fix column widths and (for wide ones) allow horizontal scroll on phones:
  | Table (identified by headers) | Class | Behavior |
  |---|---|---|
  | Planning Calendar (`Biblical Passage`) | `pc-table` | Fixed column widths |
  | Opening Core Content (`Session` + `Focus`) | `cc-table` | Session column gets real width |
  | Recall Learning Plan (`Session` + `Topic`) | `lp-table` | "Session N" label won't wrap |
  | Further Resources reading plan (`Week N`) | `rp-table` inside `div.rp-scroll` | Equal columns; **scrolls horizontally** on narrow screens |
- **Accent zebra.** In accent-themed books, table header/heading rows and zebra striping take the book's accent color.

For the app: support GFM tables, implement the merged-heading join, and wrap wide tables in a horizontally scrollable container so columns don't crush on phones.

**Content:** merged-heading → [commonSeries.md, line 162](https://github.com/Noble-Collective/Noble-Imprint-Resources/blob/main/series/Narrative%20Journey%20Series/commonSeries.md#L162) · `pc-table` → [The Best Possible Life — 00-The-Opening.md, line 115](https://github.com/Noble-Collective/Noble-Imprint-Resources/blob/main/series/Narrative%20Journey%20Series/Essentials/The%20Best%20Possible%20Life/sessions/00-The-Opening.md#L115) · `rp-table` → [The Bond Between Us — 14-Further-Resources.md, line 135](https://github.com/Noble-Collective/Noble-Imprint-Resources/blob/main/series/Narrative%20Journey%20Series/Essentials/The%20Bond%20Between%20Us/sessions/14-Further-Resources.md#L135) — **Live:** merged tables on [the-best-possible-life/00-front-matter](https://resources.noblecollective.org/narrative-journey-series/essentials/the-best-possible-life/00-front-matter) · pc-table on [the-best-possible-life/00-the-opening](https://resources.noblecollective.org/narrative-journey-series/essentials/the-best-possible-life/00-the-opening) · rp-table on [the-bond-between-us/14-further-resources](https://resources.noblecollective.org/narrative-journey-series/essentials/the-bond-between-us/14-further-resources)

### Numbered paragraphs (`sub-para`)
A paragraph that **starts with a bold 1–2 digit number** (`**2** Some text…`) is tagged `<p class="sub-para">` and gets a first-line text-indent. Used for numbered discourse/oration paragraphs. (In audio, the number gets a pause after it — see the audio guide.)

**Content:** [On the Shortness of Life — 02-ChapterOne.md, line 9](https://github.com/Noble-Collective/Noble-Imprint-Resources/blob/main/series/A%20Library%20of%20Classics/A%20Philosophical%20Shelf/On%20the%20Shortness%20of%20Life/sessions/02-ChapterOne.md#L9) · **Live:** [on-the-shortness-of-life/02-chapterone](https://resources.noblecollective.org/a-library-of-classics/a-philosophical-shelf/on-the-shortness-of-life/02-chapterone)

### Footnotes
Standard `markdown-it-footnote` syntax is enabled and used in some books (e.g. front matter):
```
Some claim.[^1]

[^1]: The footnote text.
```
Renders reference superscripts linked to a footnotes list at the end. The app should support GFM/markdown-it footnotes.

**Content:** [On the Shortness of Life — 01-FrontMatter.md, line 48](https://github.com/Noble-Collective/Noble-Imprint-Resources/blob/main/series/A%20Library%20of%20Classics/A%20Philosophical%20Shelf/On%20the%20Shortness%20of%20Life/sessions/01-FrontMatter.md#L48) · **Live:** [on-the-shortness-of-life/01-frontmatter](https://resources.noblecollective.org/a-library-of-classics/a-philosophical-shelf/on-the-shortness-of-life/01-frontmatter)

### Line breaks
A literal `<br>` is supported mid-content; the renderer isolates it so following headings/lists still parse. Render as a line break.

**Content:** [Come Let Us Adore Him — 1-Front Matter.md, line 17](https://github.com/Noble-Collective/Noble-Imprint-Resources/blob/main/series/Liturgies/Come%20Let%20Us%20Adore%20Him/sessions/1-Front%20Matter.md#L17) · **Live:** [come-let-us-adore-him/1-front-matter](https://resources.noblecollective.org/liturgies/come-let-us-adore-him/1-front-matter)

---

## Shared content: `@include`

Sessions can compose shared blocks from common files:
```
<!-- @include: KeyName param="value" -->
```
This injects a named block, resolved with **book → subseries → series** precedence:
`commonBook.md` → `commonSubseries.md` → `commonSeries.md` (in the book/subseries/series folders respectively).

Parameters:
| Param | Effect |
|-------|--------|
| `id="…"` | Substitutes `{id}` placeholders inside the block |
| `bold="…"` | Bolds a matching line / run / partial substring within the block |
| `active="…"` | Marks one `<Item>` active inside a shared `<Infographic>` |

**The app must resolve these includes to render the affected books at all** (currently the Narrative Journey **Essentials** series). An unresolved `<!-- @include -->` comment yields missing content. The website's resolver is `resolveIncludes` in `src/renderer/parser.js` — match its behavior (including the precedence and the `id`/`bold`/`active` params). Many shared blocks are themselves the constructs above — infographics, series-summary (merged-heading) tables, creeds — so resolving includes is what makes those render.

Note: the **audio** pipeline does not resolve includes, so audio-enabled books keep their session text self-contained. See the audio guide for the sync implication.

**Content:** [The Best Possible Life — 00-Front-Matter.md, line 15](https://github.com/Noble-Collective/Noble-Imprint-Resources/blob/main/series/Narrative%20Journey%20Series/Essentials/The%20Best%20Possible%20Life/sessions/00-Front-Matter.md#L15) · **Live:** [the-best-possible-life/00-front-matter](https://resources.noblecollective.org/narrative-journey-series/essentials/the-best-possible-life/00-front-matter) (the series-summary tables shown there are included content)

### Labeled section blocks in common files

The parser also supports a fixed set of **section-label tags** — `<IntroductionNote>`, `<ReflectionPrompt>`, `<DeepDivePrompt>`, `<ClosingThoughts>`, `<WrapUpNotes>` — each of which renders to:
```html
<div class="common-content"><div class="section-tag">Reflection Prompt</div>
  … inner markdown rendered normally …
</div>
```
The `section-tag` label (spaced from the CamelCase tag name) is **injected** by the renderer. These are authored **only inside the shared `commonSubseries.md`**, not in session files — they're building blocks for the shared-content system, not a general session construct. **As of 2026-09-02 no active `@include` references them, so they do not currently render on any live page.** Support the tags if you encounter them in resolved content, but they are low-priority.

**Content:** [Essentials — commonSubseries.md, line 1](https://github.com/Noble-Collective/Noble-Imprint-Resources/blob/main/series/Narrative%20Journey%20Series/Essentials/commonSubseries.md#L1) (`<DeepDivePrompt>`) · **Live:** none currently

---

## `meta.json` fields that affect rendering

| Field | Effect |
|-------|--------|
| `accent` | Accent color used by `<Accent>`, accent-colored links, and infographic theming |
| `color` | Per-heading-level colors applied by the renderer |
| `maxNavHeadingLevel` | Deepest heading level surfaced in section navigation (default 2) |
| `status`, `banner` | Publication state / banner label (e.g. "Pre-Release") |
| `audiobook` | Audio generation config (see the audio guide) |

**Content:** `accent` → [The Best Possible Life — meta.json](https://github.com/Noble-Collective/Noble-Imprint-Resources/blob/main/series/Narrative%20Journey%20Series/Essentials/The%20Best%20Possible%20Life/meta.json) · `maxNavHeadingLevel` → [Oration II — meta.json](https://github.com/Noble-Collective/Noble-Imprint-Resources/blob/main/series/A%20Library%20of%20Classics/A%20Pastoral%20Shelf/Oration%20II/meta.json)

---

## Navigation & session numbering

- **Section navigation** is built from headings up to `meta.maxNavHeadingLevel` (default `2`). Headings inside HTML comments (`<!-- … -->`) are **ignored** for nav.
- **Session number badges.** Numbering is *numbered-only*: a session gets a number badge (left of its title in nav and on the book page) when its H1 title carries a number. Front/back-matter (Front Matter, The Opening, The Recall, Further Resources, Bibliography, etc.) has no number and is excluded from the book's session count. A book may set **per-book manual overrides** for session numbers.

## Bible reader (separate surface)

The `/bible` reader is a **separate render path** from book sessions (USFM, not the session Markdown here). Notably, poetry is grouped into stanzas (Psalms/Song paragraph handling). If the app renders scripture, treat it as its own surface — the constructs in this guide are for book sessions. Bible audio is covered in the audio guide.

---

## Change log

- **2026-09** — `<Bibliography>` hanging-indent wrapper added.
- **2026-07/08** — Infographic engine (`<Infographic>`/`<Item>`) with menu/sequence types, per-session themes, and the `active` param; `@include` extended with multi-line/partial `bold=` and the `active=` param.
- **2026-06/07** — `<Accent>` inline tag; `@include` shared-content system (`id`/`bold`); Bible-reference linking improvements; accent-colored prose links; `maxNavHeadingLevel`.
- Image art converted from bare `.webp` to `jpg`/`png`/`svg` for app compatibility.
