# Proposal: Hear, My Son — Bibliography page formatting

**Date:** 2026-09-02
**Page:** `https://resources.noblecollective.org/vade-mecum/hear-my-son/10-bibliography`
**Source file:** `Noble-Imprint-Resources/series/Vade Mecum/Proverbs and Faith Formation/sessions/10-Bibliography.md`
**Requested by:** Matt

## Matt's ask

> "It would be great to not have bullet points, but to have a bibliography that is
> indented like the PDF. Also, some of the bibliography has incorrect line breaks
> leaving orphaned page numbers or locations."

Two distinct problems, one visual and one in the source text:

1. **Bullets → hanging indent.** Today each entry renders as a disc-bulleted `<li>`.
   The PDF (and Matt's `Screenshot 2026-08-10 at 12.12.48 PM.png`) uses a Chicago-style
   **hanging indent**: first line flush left, continuation lines indented ~2em, no bullets.
2. **Orphaned line breaks.** A few entries are accidentally split across two `-` list
   items, so a stranded page range or museum name renders as its own bullet.

## Content validation (done)

I compared the live markdown against `Hear, My Son-latest draft 8-10-2026.pdf`
(pages 42–44). **The text matches the PDF exactly.** Every "orphan" in the markdown is
simply a PDF *soft-wrap* that got turned into a separate `-` bullet during import — it is
a formatting artifact, not missing/extra content. So this is purely a formatting fix; no
scholarly content changes.

### Orphaned entries to rejoin

**Bibliography section**
- Fox 1994 — `...113, no. 2 (1994):` + `233–43.` → one entry
- Van Leeuwen — `...Semeia 50 (1990):` + `111–144.` → one entry

**Artwork section** (museum/location stranded on its own bullet)
- Cole, *Voyage of Life* → `National Gallery of Art.`
- Pesellino, *Seven Liberal Arts* → `Birmingham Museum of Art.`
- Greuze, *The Bible Reading* → `Louvre Museum.`
- Giorgione, *The Three Ages* → `Palazzo Pitti.`
- Anonymous, *Wisdom Has Built Her House* → `State Tretyakov Gallery.`
- Friedrich, *The Stages of Life* → `Museum der bildenden Künste.`
- Barbieri, *King David* → `National Gallery.`
- Haanen, *The Night School* → `Rijksmuseum.`
- Botticelli, *Young Man Before the Seven Liberal Arts* → `Louvre Museum.`
- Drost, *Standing Young Man...* → `Statens Museum for Kunst.`

(Note: the source has a stray colon in `Page: 30–31:` for the Botticelli entry — it's in
the PDF too. I'd quietly normalize it to `Page 30–31:` while I'm in there. Flagging so
it's a conscious choice, not a silent edit.)

## The rendering pipeline (how the fix has to work)

- Session `.md` is rendered by **markdown-it** in `src/renderer/parser.js` (`html: true`,
  no HTML sanitizer). Output is injected into `<div class="session-content ...">` in
  `src/views/session.ejs:59`.
- All content CSS lives in one file: `src/public/css/style.css`. List styling is at
  `style.css:1267–1296` (`.session-content ul` → `list-style: disc`; `li` → justified,
  reading font). **No CSS build step.**
- **Hard rule:** any change to `style.css` requires bumping `style.css?v=N` in
  `src/views/partials/header.ejs`, or returning visitors keep the stale file for up to a year.
- **Mobile app** renders the same content repo and "depends on the custom tag syntax."
  It does its own styling, so a CSS-only web change doesn't affect it — but *new syntax*
  in the content file (a new tag or raw `<div>`) may not be understood by the app.

To remove bullets and add a hanging indent, the `<ul>` needs a CSS hook. There's no
per-page body class today, so we need to introduce one. Three ways to do it:

## Options for the styling hook

### Option A — Server-side auto class *(recommended)*
Add a `bibliography` class to `.session-content` in `session.ejs` when the session is a
bibliography page (key off `session.filename` ending in `Bibliography.md`). Then one CSS rule:

```css
.session-content.bibliography ul { padding-left: 0; }
.session-content.bibliography li {
  list-style: none;
  padding-left: 2em;
  text-indent: -2em;   /* first line flush, continuations indented */
}
```

- **Content file stays standard markdown** (a plain `-` list — semantically correct for a
  bibliography). Nothing foreign for the mobile app to choke on.
- Applies the PDF look to **every book's bibliography** automatically (consistent house style).
- Web-only; mobile app unaffected.
- Con: it's a convention ("files named `*Bibliography.md` get this style"). If we ever want
  a bibliography page to *not* look this way, we'd need an opt-out.

### Option B — New `<Bibliography>…</Bibliography>` tag
Follow the existing "structural tag" precedent in `parser.js:417–425` to emit
`<div class="bibliography">`, plus the same CSS. Author wraps the list in the tag.
- Matches how `<Question>`, `<Callout>`, etc. work.
- Con: introduces a **new custom tag the mobile app doesn't know yet** — it may render the
  literal `<Bibliography>` text until the app is updated. Explicit per-page opt-in (a plus
  if we *don't* want all bibliographies restyled).

### Option C — Raw `<div class="bibliography">` in the markdown
HTML is unsanitized, so a literal wrapper div (with blank lines around the list) works with
the same CSS and zero parser changes.
- Con: puts raw HTML into a manuscript file — against the "preserve custom tag syntax"
  guidance, and the mobile app may not render it.

**Recommendation: Option A.** It keeps the content file as clean, portable markdown (best
for the mobile app), gives every bibliography the PDF's hanging-indent look consistently,
and is a ~6-line change. The orphan-line fixes are done regardless of which option we pick.

### Open question for Matt/Steve
- **Justified vs. left-aligned?** The PDF text is justified (flush on both margins), and the
  site's `li` is already justified. I'll keep justify to match the PDF unless you'd prefer
  left-aligned (some find justify + hyphenation harder to read on mobile).
- **Scope:** Option A restyles *all* bibliographies site-wide. Assuming that's desirable
  (consistent house style). Say the word if you want it scoped to just this book.

## DECISIONS (Steve, 2026-09-02)
- **Mechanism:** new `<Bibliography>` custom tag (Option B).
- **Alignment:** left-aligned (ragged right).
- **Scope:** styling is site-wide-capable, but **implement on Hear, My Son first**;
  only *analyze* the other three books (don't edit them yet).

## IMPLEMENTED (website repo — uncommitted)
1. **`src/renderer/parser.js`** — new preprocess handler: `<Bibliography>…</Bibliography>`
   → `<div class="bibliography">` (blank-line wrapped so inner markdown still renders).
2. **`src/public/css/style.css`** — `.session-content .bibliography` rule: `list-style:none`,
   hanging indent (`padding-left:2em; text-indent:-2em`), `text-align:left`. Applies to
   both `li` and `p` so mixed source formats (lists vs. plain paragraphs) render uniformly.
3. **`src/views/partials/header.ejs`** — bumped `style.css?v=107` → `?v=108`.

## IMPLEMENTED (content repo — uncommitted)
4. **`…/Proverbs and Faith Formation/sessions/10-Bibliography.md`** — wrapped body in
   `<Bibliography>`; rejoined all split entries (Fox 1994, Van Leeuwen, and 10 Artwork
   museum orphans); normalized `Page: 30–31:` → `Page 30–31:`.

**Verified via the real parser:** renders `<div class="bibliography">` → `<ul>` with 33
clean `<li>` (12 bibliography + 21 artwork), both orphan joins present, tag fully consumed
(no leaked text), no inline `list-style` (CSS-driven). Visual preview generated + sent.

## NOT YET DONE / follow-ups
- **Editor masking** — `<Bibliography>` is NOT added to the editor's `sectionTags`
  (`editor-masking.js:106`), so in the editor the raw tag shows as plain text. Deferred
  because `editor-masking.js` is imported at `/static/js/editor-masking.js` **without a
  `?v=` cache-buster** (editor.js:3) — changing it won't reach returning editors for up to
  a year. Bibliographies are rarely-edited back-matter, so this is low-priority; worth
  solving alongside a broader editor-module cache-busting fix.
- **Mobile app** — `<Bibliography>` is a new tag the mobile app doesn't know. Needs
  verification: does the app strip unknown tags (fine — list still shows) or render them
  literally (would show `<Bibliography>` text)? Coordinate before relying on it in the app.

## Other bibliographies — analysis only (no edits made)
Applying `<Bibliography>` site-wide later would mean wrapping each file. Notes:
- **The Vocationed Pastor** (`08-Bibliography.md`) — all bulleted, multiple H2 sections +
  Artwork. Cleanest: wrap works as-is, no orphans spotted.
- **Oration II** (`08-Bibliography.md`) — **mixed**: Editions/Translations are plain
  paragraphs, Secondary Literature is bulleted. The p-and-li CSS rule handles both, so a
  wrapper alone gives a uniform hanging indent. ⚠ Pre-existing typo `no. 2 ()2010)` (stray
  paren) — out of scope, flag to author.
- **On the Shortness of Life** (`08-Bibliography.md`) — **all plain paragraphs, no bullets.**
  Wrapper + the `p` rule gives hanging indent (nothing to de-bullet).
- Each of the above is a separate content edit needing its own review; not touched here.

Nothing has been committed or pushed yet — awaiting go-ahead.
