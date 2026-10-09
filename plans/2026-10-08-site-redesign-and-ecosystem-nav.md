# Site redesign + Noble Collective ecosystem navigation (design record)

**Dates:** 2026-10-08 to 2026-10-09
**Status:** DESIGN ONLY. Nothing is built. Steve has made the decisions listed in §1. Everything in §5 is open.

## Where the designs live

- **Canvas:** https://claude.ai/artifact/NpVnZb8Nj4cadzvxZJ1xAw. It is private; share it from its Share menu.
  - **Journey** page (opens first): journey map, noblecollective.org desktop menu, mobile drawer, mobile submenu.
  - **Desktop** page (1440 wide): Home signed in, Home signed out, Library (Books and Series), series page, Settings, reader shell.
  - **Mobile web** page (390 wide): the same screens, plus a dark-mode Home.
  - **Style sheet** page: tokens, components, and a "today → redesign" comparison table.
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

**Reader:** unchanged content. The audio bar becomes the app's collapsed player: a navy play button, time, ±15 and expand.

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
- [ ] Keep the `ajax-nav.js` selectors (`#reading-content`, the sidebar) working through the reader-shell restyle.
- [ ] Bump `?v=` on `style.css` and the bundle with each change.
- [ ] Build in the Shopify theme on noblecollective.org (outside this repo).
- [ ] Institute: remove the NC header from its landing page (Noble-Collective-Institute repo).

**Canvas publishing lesson:** after a canvas is opened and saved in the browser, publishing to it asked for approval even though `Artifact` is allowlisted. With Steve on his phone, that stalled the session. Publish to a fresh canvas, or have Steve approve at the computer.
