# Plan: Configurable Heading Navigation Depth + Mobile TOC Rebuild

## Problem

The navigation currently only shows h2 headings — hardcoded in the server (regex `^##\s+`) and the renderer (only h2 gets `id` anchors). For books with deep structure (HomeStead has h1 through h6), users can't jump to subsections below h2. The mobile TOC bar clones the entire desktop sidebar (all sessions + h2s), which is clunky — no way to expand into deeper headings, and tapping any item navigates rather than expanding.

## What Steve wants

1. **Per-book `maxNavHeadingLevel` property** in `meta.json` — controls how deep the heading tree goes in navigation. Default: 2 (h2 only, same as today). Some books may go to 4, 5, or 6.

2. **Mobile TOC rebuild** — the bar that appears/disappears on scroll and tap:
   - Clicking the **text** of a heading jumps to that heading in the content
   - Clicking an **expand/collapse control on the right side** opens/closes child headings
   - Multi-level: h2 expands to show h3s, h3 expands to show h4s, etc.
   - Only goes as deep as `maxNavHeadingLevel` for that book

3. **Desktop sidebar** should also benefit — show the deeper heading tree under the active session, with expand/collapse for deeper levels.

## Current State

| Component | What it does now | Line references |
|---|---|---|
| Heading extraction | h2 only, regex on raw markdown | `index.js:388-396` |
| Heading `id` anchors | h2 only in rendered HTML | `parser.js:118-127` |
| Desktop sidebar | Sessions list + h2 sub-nav under active session | `session-sidebar.ejs` |
| Mobile TOC | Clones entire desktop sidebar, shows as dropdown | `main.js:250-355` |
| Mobile TOC bar | Fixed bar, hides on scroll down, shows on scroll up/tap | `main.js:345-354`, `style.css:2396-2498` |
| `meta.json` | No TOC/heading properties exist | `content.js:80-117` |

## Implementation

### Phase 1: Server — extract heading tree and add `id` anchors

**`meta.json` (content repo):**
Add optional `maxNavHeadingLevel` property. Default: 2.

```json
{
  "title": "HomeStead",
  "maxNavHeadingLevel": 4,
  ...
}
```

**`src/server/content.js` — `loadBook()`:**
Read `maxNavHeadingLevel` from meta.json, store on book object. Default to 2 if missing.

```javascript
book.maxNavHeadingLevel = meta.maxNavHeadingLevel || 2;
```

**`src/server/index.js` — `getSessionPageData()`:**
Replace the h2-only regex with a multi-level heading extractor:

```javascript
const maxLevel = resolved.book.maxNavHeadingLevel || 2;
const headings = [];
const headingPattern = /^(#{1,6})\s+(.+)$/gm;
let match;
while ((match = headingPattern.exec(sessionData.content)) !== null) {
  const level = match[1].length;
  if (level < 1 || level > maxLevel) continue;
  const text = match[2].trim();
  const slug = text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  headings.push({ text, slug, level });
}
```

Pass `headings` and `maxNavHeadingLevel` to the template instead of (or alongside) `h2s`. Keep `h2s` as a filtered view for backward compat if needed, or migrate all references.

**`src/renderer/parser.js`:**
Currently only h2 gets `id` attributes (lines 118-127). Extend to add `id` anchors to all heading levels up to `maxNavHeadingLevel`. This requires passing `maxNavHeadingLevel` into the render call — either as a parameter or by reading it from the book's config.

The renderer already has heading handling; extend the existing `id` assignment logic:

```javascript
// Currently: only h2 gets id
// New: h1-hN get id based on maxNavHeadingLevel
if (level >= 1 && level <= maxNavHeadingLevel) {
  const slug = text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  token.attrSet('id', slug);
}
```

Handle duplicate slugs by appending `-2`, `-3`, etc. (already needed — some h2s can repeat across a long session).

### Phase 2: Desktop sidebar — nested heading tree

**`src/views/partials/session-sidebar.ejs`:**
Replace the flat h2 list with a nested tree structure. Each heading level gets its own `<ul>` nested inside its parent:

```html
<ul class="nav-heading-list">
  <% headings.forEach(function(h, i) { %>
    <% const nextLevel = headings[i+1] ? headings[i+1].level : h.level; %>
    <li class="nav-heading-item nav-heading-level-<%= h.level %>">
      <div class="nav-heading-row">
        <a href="#<%= h.slug %>" class="nav-heading-link"><%= h.text %></a>
        <% if (nextLevel > h.level) { %>
          <button class="nav-heading-toggle" data-toggle-heading aria-label="Expand">
            <span class="chevron">›</span>
          </button>
        <% } %>
      </div>
      <!-- children nested via CSS/JS -->
```

Alternative: build the tree server-side as a nested structure and pass it to EJS, which is cleaner for recursive rendering. A helper function `buildHeadingTree(headings)` converts the flat array into nested `{ text, slug, level, children: [] }`.

**`src/public/js/main.js`:**
Add `initSidebarHeadingToggles()` — binds click handlers to `[data-toggle-heading]` buttons. Clicking toggles the next sibling `<ul>` open/closed. All sub-levels collapsed by default (only top-level headings visible).

### Phase 3: Mobile TOC rebuild

The current approach (clone the entire sidebar) doesn't work well for a multi-level heading tree. Rebuild the mobile TOC panel to be purpose-built.

**Current mobile TOC behavior to keep:**
- Fixed bar below header
- Hides on scroll down, shows on scroll up
- Shows current session title as label
- Tap to open/close

**New mobile TOC behavior:**
- When opened, shows a **heading navigator** (not a sidebar clone)
- Top level: all sessions in the book (same as today)
- Under the active session: heading tree with expand/collapse
- **Left side: heading text** — tapping jumps to that heading, closes the TOC
- **Right side: expand/collapse chevron** — tapping expands to show child headings, does NOT navigate
- Smooth scroll to heading anchor on tap
- Collapse all sub-levels by default

**Structure:**

```html
<div class="mobile-toc-panel">
  <ul class="mobile-toc-sessions">
    <li class="mobile-toc-session active">
      <a href="..." class="mobile-toc-session-link">Session One</a>
      <ul class="mobile-toc-headings">
        <li class="mobile-toc-heading level-2">
          <div class="mobile-toc-heading-row">
            <a href="#overview" class="mobile-toc-heading-link">Overview</a>
            <button class="mobile-toc-expand" aria-label="Expand">›</button>
          </div>
          <ul class="mobile-toc-headings collapsed">
            <li class="mobile-toc-heading level-3">
              <a href="#sub-topic" class="mobile-toc-heading-link">Sub Topic</a>
            </li>
          </ul>
        </li>
      </ul>
    </li>
    <li class="mobile-toc-session">
      <a href="/book/session-2" class="mobile-toc-session-link">Session Two</a>
    </li>
  </ul>
</div>
```

**`src/public/js/main.js` — new `initMobileTocHeadings()`:**
- Builds the mobile TOC from the `headings` data (passed via a `<script>` tag or `data-*` attribute on the TOC element)
- Expand/collapse: toggles `.collapsed` class on child `<ul>`
- Jump: `document.getElementById(slug).scrollIntoView({ behavior: 'smooth' })`, then close the TOC panel
- Session links: for non-active sessions, clicking navigates (AJAX or full reload)

**Where does the heading data come from on the client?**
Option A: Embed in a `<script>` tag as JSON (like `window.__EDITOR_DATA`)
Option B: Read from the DOM — the rendered session HTML has headings with `id` attributes; scan them with `querySelectorAll('h2[id], h3[id], h4[id], ...')`

Option B is simpler and doesn't require server changes beyond adding `id` attributes. The client can build the tree from the DOM:

```javascript
function buildHeadingTree(maxLevel) {
  const headings = document.querySelectorAll(
    Array.from({length: maxLevel}, (_, i) => `.session-content h${i+1}[id]`).join(', ')
  );
  // Build nested tree from flat list based on heading levels
}
```

This also works automatically after AJAX nav since the new DOM has the headings.

### Phase 4: CSS

**Desktop sidebar heading tree:**
- Indent each level: `padding-left: 0.75rem` per level (cascading)
- Collapse animation: `max-height` transition or simple `display: none/block`
- Chevron rotation on expand

**Mobile TOC panel:**
- Replace the sidebar-clone approach with the new heading navigator
- Each heading level indented progressively
- Expand/collapse button on the right: `display: flex; justify-content: space-between`
- Heading link fills available space, expand button is fixed-width touch target (~44px)
- Touch-friendly: minimum 44px tap targets
- Max-height 70vh with overflow scroll (same as current dropdown)
- Active heading highlighted (could use IntersectionObserver for scroll-spy)

### Phase 5: AJAX nav compatibility

After AJAX navigation swaps the DOM:
- The mobile TOC needs rebuilding from the new session's headings
- `__reinitAfterSwap()` already re-runs `initMobileToc()` — this would now also rebuild the heading tree
- If using Option B (DOM-based tree), it works automatically since headings are in the swapped content
- `maxNavHeadingLevel` needs to be available client-side — either from a data attribute on `<main>` or from the AJAX JSON response

Add `maxNavHeadingLevel` to the `/api/session-data/` JSON response so AJAX nav can pass it through.

## Files to modify

| File | Change |
|------|--------|
| `meta.json` (content repo) | Add `maxNavHeadingLevel` property to books that need deeper nav |
| `src/server/content.js` | Read `maxNavHeadingLevel` from meta.json, store on book object |
| `src/server/index.js` | Multi-level heading extraction in `getSessionPageData()`, pass to templates and API |
| `src/renderer/parser.js` | Add `id` anchors to headings beyond h2 (up to `maxNavHeadingLevel`) |
| `src/views/partials/session-sidebar.ejs` | Nested heading tree with expand/collapse |
| `src/views/session.ejs` | Pass heading data / `maxNavHeadingLevel` to client, update mobile TOC markup |
| `src/public/js/main.js` | Rebuild `initMobileToc()` with heading tree, expand/collapse handlers, jump-to-heading |
| `src/public/css/style.css` | Heading tree indentation, expand/collapse, mobile touch targets |
| `src/public/js/ajax-nav.js` | Pass `maxNavHeadingLevel` through after swap |

## Not in scope

- Scroll-spy (highlighting the current heading in the TOC as user reads) — nice-to-have but adds complexity
- Search within TOC — not needed for now
- Remembering expand/collapse state across page loads — not needed

## Testing

1. Book with `maxNavHeadingLevel: 2` (default) — should look identical to today
2. Book with `maxNavHeadingLevel: 4` — sidebar and mobile TOC show h2/h3/h4, expand/collapse works
3. Mobile: tap heading text → scrolls to heading, TOC closes
4. Mobile: tap expand chevron → shows child headings, TOC stays open
5. Desktop sidebar: expand/collapse works, links jump to headings
6. AJAX nav: heading tree rebuilds correctly after session swap
7. Sessions with no headings — no TOC headings shown (graceful)
8. Duplicate heading text — slugs have `-2`, `-3` suffixes, links still work
