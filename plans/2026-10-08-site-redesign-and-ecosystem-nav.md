# Site redesign + Noble Collective ecosystem navigation (design record)

**Dates:** 2026-10-08 to 2026-10-10
**Status:** DESIGN ONLY. Nothing is built. Steve has made the decisions listed in §1. Everything in §5 is open.
§6 (added 2026-10-10, Steve: "incorporate page numbers into the re-design") folds the app's print page numbers into
the redesign: its own canvas, with Steve's decisions still to make in §6.7.

## Where the designs live

- **Canvas:** https://claude.ai/artifact/NpVnZb8Nj4cadzvxZJ1xAw. It is private; share it from its Share menu.
  - **Journey** page (opens first): journey map, noblecollective.org desktop menu, mobile drawer, mobile submenu.
  - **Desktop** page (1440 wide): Home signed in, Home signed out, Library (Books and Series), series page, Settings, reader shell.
  - **Mobile web** page (390 wide): the same screens, plus a dark-mode Home.
  - **Style sheet** page: tokens, components, and a "today → redesign" comparison table.
- **Page numbers canvas (§6):** https://claude.ai/artifact/1NiZcjMyokJCtvTrXRp9qr
  - **Desktop:** the reader with page numbers on (the switch works), the Aa menu, and Go to page with the one-time nudge.
  - **Mobile web:** the reader, the contents sheet with Go to page, the Aa sheet, and a dark board with p. 88 plus a split word.
  - **Divider spec.**
  - It uses the same tokens as the redesign. It's a separate canvas because the main canvas asks for approval on every publish once it has been opened in the browser (see the lesson at the end).
- **Old canvas:** https://claude.ai/artifact/DHLcUPFGVUZmkwSKokM9ZD. Superseded; it holds the same resources boards without the journey.
- **Source boards:** the `.dc.html` files were written in a scratchpad (not kept). To edit, `read` each board back from the canvas.

## 1. Decisions Steve has made

1. **noblecollective.org is the front door.**
   - It gets **one new dropdown** in its header (Shopify theme) linking to all three sites.
   - Each entry has an icon, a name, a one-line purpose, and a **right-aligned new-tab icon**.
   - Every link opens in a **new tab**.
2. **All three sites are standalone and full-screen, with their own design.** None of them carries the noblecollective.org header.
   - This means removing the header the Institute landing page uses today.
   - An earlier variant embedded the noblecollective.org header on the resources site's desktop view. Steve rejected it and kept the full-screen custom design.
3. **The resources site is redesigned to match the Noble Imprint app 2.0.** That means the Home dashboard, the Library catalog, the bottom nav on mobile and a Settings page.
   - **The reader content stays as it is.** Only the shell around it changes: header, sidebar and audio bar.

## 2. Resources site redesign (the Desktop, Mobile web and Style sheet pages)

The specs come from the app's 2.0 code (`Noble-Imprint-App`, branch develop):
- `app_colors.dart`
- `quiet_nav_bar.dart`
- `catalog_book_row.dart`
- `catalog_shelf.dart`
- `home_v2_page.dart`
- `_profile_v2.dart`

**Look**
- Inter for interface text, Lora for titles. The reader keeps Lora for body text and Poppins for headings.
- Gold #DA9F28 for actions; deep gold #835F16 for links and counts.
- Navy #3A5C92 marks the current page.
- Lines are 1px: #E0E0E0 on bars, #ECECEC elsewhere.
- Cards have radius 14 (hero cards 18); buttons are full pills.
- Book covers are 2:3: 56×84 on mobile, 64×96 on desktop.
- Dark mode uses the app's dark palette (Style sheet page).

**Navigation**
- Web nav: **Home · Library · Bible · Notebook · Settings**. The app's Tabs becomes Notebook (`/notes`), because browsers already have tabs.
- Desktop: a 64px white bar with the app's icons and a gold 3px marker under the current item. Settings is a gear, next to the avatar.
- Mobile: the app's quiet white bottom bar replaces the hamburger drawer, and hides while reading. The header is 48px with the logo top-right.
- Mobile page titles use #6F8CBF instead of the app's #89A4D0, which is too faint to read easily on white.

**Home** (a dashboard, as in the app)
- Signed in, in order:
  - "Welcome back"
  - Continue reading
  - Partner with us + Donate
  - Also reading
  - Resource of the day
  - From your notebook
  - Then, web only: "Explore the library" series cards.
- Signed out, in order:
  - "Resourcing the church for mission"
  - Resource of the day (large card)
  - Partner with us
  - Sign-in card (Google and Apple, stacked)
  - Series cards
  - The Bible
- Implementation notes:
  - Resource of the day and Partner come from `src/server/home.js` `buildHome()`. The site doesn't use it today; only the app does, through `/api/home`.
  - Continue reading, Also reading and the notebook highlight come from the shared store, using the SDK dashboard selectors.

**Library**
- Books ⇄ Series switch, a search field, and an "A–Z / By series" sort.
- Book rows: Pre-Release and Preview pills from `meta.json` `banner`, plus the Audiobook marker from `audiobook.enabled`.
- Series cards have fanned covers.
- **Series pages become real routes.** Today the series links jump to `/#series-` anchors on the homepage. On desktop, a series page shows each collection inline; on mobile it shows collection cards you tap into.

**Settings**
- A new `/settings` page using the app's accordion. Today there is only a gear pop-up (`src/reader-userdata/settings.js`) and an account pop-up (`reader-userdata-entry.js`).
- Sections:
  - Reading: Appearance, Text size, Font, preview.
  - Bible: Translation, Verse layout.
  - Account & privacy: sync switch, sign-in methods, privacy and data, sign out.
- Dropped on the web: the app's Tabs section and the pinch switch.

**Reader:** unchanged content, with one exception: the print page dividers (§6). They are the only addition inside the text. The page draws them, and nothing that reads the text can see them.
- The audio bar becomes the app's collapsed player: a navy play button, time, ±15 and expand.

## 3. Ecosystem journey (the Journey page)

1. Visitor arrives at noblecollective.org (Shopify; charcoal #525050 header, gold GIVE #D7B44A, Poppins).
2. Opens the new dropdown. It lists three sites, each with ↗ "opens in a new tab". On mobile: drawer → the dropdown's item → submenu.
3. The site opens in a new tab, with noblecollective.org still open behind it.
4. The visitor lands on that site's own full-screen home.
5. One sign-in (Google or Apple) works on all three sites and in the app. This already works through the shared Firebase identity.
6. Finding the way back. **Proposed, not drawn:** each site's footer and account menu carries "Part of Noble Collective" plus links to the other two sites.

Changes each site needs:
- **Resources:** the redesign in §2.
- **Coram Deo:** already standalone; add the footer line.
- **Institute:** remove the noblecollective.org header from its landing page.

Implementation note: the dropdown has to be built in the Shopify theme (a nested menu). The right-aligned ↗ icon probably needs a small theme change (Liquid or CSS).

## 4. Naming / rebrand discussion (2026-10-08 to 09; nothing decided)

- **Dropdown label.** Canvas currently says "Resources". Options discussed:
  - **Equip** (Claude's pick; Ephesians 4:12)
  - Resources (familiar, but repeats "Noble Imprint *Resources*")
  - Study
  - Learn
  - Steve suggested "Software"; Claude advised against it: it sounds like products to buy, next to "Store".
- **The Institute (LMS).** Steve is considering **Noble Academy**. He also raised **Noble Theological Institute**.
  - Claude's view: Noble Academy for the platform, because most users are church-cohort members.
  - "Theological Institute" suggests seminary and accreditation (check state rules on academic-sounding names). It could name a later track for pastors and leaders inside the Academy.
- **Coram Deo** (study Bible plus a catena of church-history voices). Rename to "Noble …", two or three words. Shortlist:
  - Noble Bereans (Acts 17:11; caution: "Berean" is also in the BSB translation's name)
  - Noble Witnesses (Hebrews 12:1)
  - Noble Margins
  - **Noble Bible Treasury / Noble Treasury** (Matthew 13:52; Claude's overall pick)
  - Noble Golden Chain (*Catena Aurea*)
  - Noble Ancient Paths (Jeremiah 6:16)
  - Library variants: **Noble Heritage Library** (pick), Noble Tradition Library, Noble Scripture Library. Caution: "Library" overlaps with Noble Imprint's Library tab and its "Resource Library" heading.

## 5. Open items / next steps

- [ ] Steve picks the dropdown label and the names (Academy, the Coram Deo rename), then update the Journey boards to match.
- [ ] Upload the real Noble Collective logo. The boards use a drawn stand-in, because the logo upload was declined.
- [ ] Draw the "Part of Noble Collective" footer and account-menu switcher for each site.
- [ ] Steve reviews the resources-site boards, then writes a build plan. Suggested phases:
  1. Tokens and fonts.
  2. Header and nav (desktop bar, mobile bottom bar).
  3. Home dashboard (`buildHome()` on the server plus the shared-store selectors).
  4. Library and series routes.
  5. `/settings` page.
  6. Reader shell and audio bar.
  7. **Print page numbers** in the new reader shell (§6.5, steps W1–W4).
  - Phase 1 also re-vendors the SDK to **0.7.1**, for `printPages` (§6.5, step W0).
- [ ] Steve answers §6.7 for page numbers: where the switches go, Go to page, the nudge's wash, and when it ships.
- [ ] Keep the `ajax-nav.js` selectors (`#reading-content`, the sidebar) working through the reader-shell restyle.
- [ ] Bump `?v=` on `style.css` and the bundle with each change.
- [ ] Build in the Shopify theme on noblecollective.org (outside this repo).
- [ ] Institute: remove the NC header from its landing page (Noble-Collective-Institute repo).

**Canvas publishing lesson:** after a canvas is opened and saved in the browser, publishing to it asked for approval even though `Artifact` is allowlisted. With Steve on his phone, that stalled the session. Publish to a fresh canvas, or have Steve approve at the computer.

## 6. Print page numbers in the redesign (designed 2026-10-10)

The app shipped "Page numbers" in 2.0.0 (232). It draws a labelled divider (hairline · `PAGE 41` · hairline) exactly where each page of the print edition begins. It's for readers following along with the print book ("turn to page 41").

- **Full reference:** the app's [`docs/PRINT-PAGE-NUMBERS.md`](../../Noble-Imprint-App/docs/PRINT-PAGE-NUMBERS.md). It covers the decisions, tagging rules, placement, tests and pitfalls. Its §12, the hand-off for the website, is what this section builds on.
- **Rule:** shared behaviour must match across products. So the website copies the app's behaviour exactly and adapts only the shell around it.

**Canvas:** https://claude.ai/artifact/1NiZcjMyokJCtvTrXRp9qr

### 6.1 What readers get (the same as in the app)

**Which books:** only books whose session files carry `<!-- page N -->` markers. Today that is The Call of Christ (115 pages, pp. 9–141). Every other book and every Bible shows nothing new: no switch and no row.

**The setting:** one "Page numbers" setting for every book, off by default.
- It syncs as the shared `printPages` key (Collective-Shared ARCHITECTURE §6, SDK 0.7.1).
- Turning it on in the app turns it on here, and the other way round.

**The divider**, drawn at every break in exactly the right place (canvas: Desktop "Reader" and Divider spec):
- **A page that begins a block** (a heading, a question or a paragraph): the divider goes above that block.
- **A page that begins inside a paragraph:** the line ends early and is left ragged, then the divider, then the SAME paragraph continues. There is no indent and no paragraph gap.
- **A break right after a real hyphen** ("Christ-" | "followers", p. 88): no second hyphen is added.
- **A break inside a word** (`estran<!-- page 41 -->ged`, for future books): "estran-", with the hyphen drawn by the page, not added to the text.
- **Two pages at the same spot** (a blank print page): one divider, labelled with the later page.

**Off:** the page is exactly as it is today.

**Contents:** each contents row shows the page it starts on ("p. 38") while the setting is on.

**"Go to page N":** a page search. With page numbers on, it lands on the divider.

**The first jump with page numbers off** (shown once per browser):
- The page's first five words are washed for 1.5 s.
- A dark banner offers "Jumped to page 41 of the print edition · SHOW PAGE NUMBERS ×".

### 6.2 Where the switches live (canvas)

- **The reader's Aa menu** (a pop-over on desktop, a sheet on mobile).
  - A "Page numbers" switch row after Font, with the line "Show where each page of the print edition begins."
  - This matches the app's ⋮-menu row.
  - It appears only in a book with pages.
- **The CONTENTS line** (the desktop sidebar, and the mobile contents sheet opened from the title pill).
  - A small, muted "Page numbers" label and a mini switch on the right.
  - This matches the app's subtle switch in its Search panel (Steve: "I don't want it being so prominent").
- **Not on `/settings`.** The app's Settings page has no row for it, because it's a reading-view choice shown where it applies. Steve to decide (§6.7, D1).
- **Page search.**
  - The sidebar and the contents sheet get the app's "Find a section or page" field. The redesign boards have no section search yet, so this adds the field the app already has.
  - Typing "41", "p 41" or "page xii" shows a gold row: "Go to page 41 · Print edition · Session 1: The Gospel" (desktop board 3, mobile board 2).

### 6.3 Look (canvas: Divider spec)

- **Hairlines:** 1 px, in the bar-line colour (`#E0E0E0`, dark `#3A3936`), filling the width on either side of the label.
- **Label** (`PAGE 41` / `PAGE XII`):
  - Poppins 500, the reader's heading face, because the divider sits inside the content.
  - Size: 0.64 × the body size. That is 11.5 px on the 18 px desktop body and 11 px on the 17 px mobile body.
  - Tracking 0.14 em, tabular figures.
  - Secondary text colour: `#7A7A7A`, dark `#B9B3A8`.
  - It follows the reader's text-size scale (`--nc-font-scale`).
- **Spacing:**
  - 10 px on either side of the label.
  - Inside a paragraph: 9 px above and 8 px below.
  - Above a block: just over the block's first line.
- **Banner:** dark `#2A2724`, text `#F2EEE6`, gold action `#E8B95A`, and a ×. It sits above the audio bar.
- **Wash:** the app's soft gold (`#F3D9A4`, dark `#6B5326`), or the site's existing neutral jump flash (§6.7, D3).

### 6.4 How the dividers stay safe on the web (the main risk, and the answer)

**The risk.** The website builds several things from the page's text as the browser holds it (the DOM text):
- highlights, notes and bookmarks, which use W3C text-quote anchors (`anchor-dom.js`);
- the quotes saved from a selection;
- `?ncq=` passage links;
- the audio highlight (`audio-player.js` and the shared narration engine).

If a divider added text, or split a paragraph into two blocks that these readers see differently, every one of them would shift or break.

**The answer:** keep the divider out of every one of those text readers, using conventions the site already has.

1. **No text nodes at all.**
   - The divider is made of empty elements.
   - `PAGE 41` is CSS generated content (`::after { content: "PAGE " attr(data-page) }`), and the hairlines are CSS too.
   - Generated content is never selected, never copied, and never part of `textContent`.
2. **`data-nc-skip` on the divider.** Every text reader on the site already skips this attribute:
   - `anchor-dom.js` (`skip()`);
   - the audio player (`SKIP_SEL`);
   - Collective-Shared's `scripts/narration-golden/build-inputs.cjs`.

   The inline bookmark marker (`nc-bm-marker`) already sits inside paragraphs this way without moving any anchor.
3. **Screen readers hear the page once.** The divider gets `aria-hidden`, and a wrapper carries `role="separator"`, so "Page 41" is read once rather than twice.
4. **The paragraph stays one element.**
   - Inside a paragraph, the divider is a `<span>` displayed as a full-width flex box.
   - So the `<p>` is still ONE block for the narration engine (whose blocks are the innermost `p`, `h*`, `li` and so on), for bookmarks, and for the editor's view of the page.
   - Between blocks, the divider is a `<div>`.
5. **Always rendered, shown by a class.**
   - The server renders the dividers into every tagged session.
   - They stay `display: none` unless `<html>` has the `nc-print-pages` class, which `settings.js` sets from `printPages`, the same way it sets `nc-dark`.
   - Off means nothing is laid out, so the page is exactly today's. There is no placement in the browser and no jump while the page loads.
6. **The source never changes.** The markers are comments in the session markdown. The editor (CodeMirror, in suggest, direct and review modes) works on the source and never sees the dividers.

**Placement is simpler than in the app.**
- The app has to match markers to its text by their words, because its baked content strips comments.
- The website's renderer KEEPS each comment at its exact place in the HTML, even inside a word: `<p>…estran<!-- page 41 -->ged from God.</p>` (checked 2026-10-09).
- So a post-processing step in `src/renderer/parser.js` replaces each page comment with the divider, right where the comment sits:
  - **inside a block:** an inline `<span>`;
  - **between blocks:** a `<div>`;
  - **a letter or digit on both sides in the source:** the class `nc-page--word`. The drawn hyphen is a second empty `data-nc-skip` span, placed before the divider, whose `::after` is `-`.
  - **after `-` `‐` `‑` `–` or `—`:** no drawn hyphen.
- The W1 test checks this placement against the app's on all 115 pages of The Call of Christ.

**Known web-only limits** (accepted, since the setting is off by default):
- The browser's own Find (Ctrl/⌘ F) and `#:~:text=` links may miss a phrase that runs across a divider in the middle of a paragraph, because the divider is a block box.
- The site's own `?ncq=` passage jump and highlights are not affected, because they read the DOM text.
- Note this in W4.

### 6.5 Build (after the redesign's phase 6, the reader shell; W0 can go in with phase 1)

**W0: the setting**
- Re-vendor `@noble-collective/userdata` **0.7.1**: put the tarball in `vendor/`, run `npm install ./vendor/<tgz>`, then `npm run build:reader`.
  - Version 0.7.0's strict schema throws on `printPages` in its one-time "seed an empty doc" write.
- `settings.js`:
  - `printPages` sets `html.nc-print-pages`, applied from the local cache before the live snapshot arrives (like the theme), so nothing flashes;
  - it updates live through `onSettingsRaw`;
  - the Aa-menu switch row, built like the other `segRow` rows;
  - signed out, it's stored locally, like the other settings.

**W1: the dividers**
- The `parser.js` post-processing step (§6.4), plus CSS in `style.css` (bump its `?v=`).
- While `loadAllSessionTitles` reads every session (it already does), the content tree also records which books have pages and each session's page labels, and keeps them in the snapshot. With that, the server:
  - sets `readerContext.hasPrintPages`, so the switches appear only in those books;
  - supplies the contents' "p. N" labels.
- **Unit tests:**
  - each kind of marker: mid-sentence, on its own line before a heading or question, after a hyphen, inside a word, two at one spot, and never inside a tag, an attribute or a link;
  - with the setting off, the HTML is identical apart from the hidden elements.
- **Whole-book check:** every Call of Christ session in `src/.file-cache` renders one divider per page, in the same order as the app.
- **Text-reading checks**, with dividers present and absent (in jsdom or the Playwright harness):
  - `anchor-dom`'s `buildIndex(...).norm` and the narration block texts are identical;
  - a highlight across p. 41 lands on the same characters;
  - a selection across it saves the same quote;
  - the audio sentence across it lights both halves (in the style of `tests/audio-highlight.spec.js`).

**W2: switches and contents**
- The CONTENTS mini switch, in the sidebar and in the mobile contents sheet.
- "p. N" on the contents rows.

**W3: Go to page and the nudge**
- The "Find a section or page" field.
- Page queries follow the app's `pageQueryLabel` rules: "41", "p 41" and "page xii" all work; a roman numeral counts only after "p" or "page".
- The book's page index comes from the snapshot: each label maps to a session URL plus `#page-41`.
- A page in another session navigates there (safe with `ajax-nav`).
- With page numbers off: land on the page's first words, with the one-time wash and banner (remembered in `localStorage` as `nc:print-pages-nudge`). "SHOW PAGE NUMBERS" sets `printPages`.

**W4: checks and docs**
- Real Safari and WebKit (`tests/safari/`), dark mode, text sizes up to XL, and mobile.
- Update CLAUDE.md, and mark §12 of the app doc done.
- Deploy only with Steve's go-ahead, because a push to `main` deploys the site.

### 6.6 What stays the same everywhere

- These all behave exactly as today, with page numbers on or off:
  - highlights, notes, bookmarks and answers;
  - `?ncq=` share links;
  - Continue reading;
  - the audio highlight;
  - the editor.
- Nothing in the content repo changes.
- The tagging rules for adding more books are in §3 of the app doc.

### 6.7 Decisions for Steve

- **D1, where the switches go.** Either the Aa menu plus the quiet CONTENTS switch, the same as the app (recommended), or those plus a row on `/settings`.
- **D2, Go to page and the one-time banner on the web.** Yes (recommended, since it's the reason the feature exists), or later.
- **D3, the nudge's wash.** The app's soft gold (recommended, so the same feature looks the same everywhere), or the site's existing neutral-gray jump flash (`nc-jumpflash`).
- **D4, when.** As phase 7 of the redesign (recommended, since the reader shell is being redrawn there anyway), or sooner on today's site. W0–W4 also work on the current shell; there the switch would go in today's gear menu.
