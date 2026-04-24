# Plan: @-Mention Tagging, Comment Editing, and Email Notifications

## Context

The Noble Imprint Resource Website has a mature collaborative editing system (suggestions, comments, replies) but lacks two key features: (1) the ability to tag/mention users in comments and replies, and (2) any notification system. Currently, manuscript owners and admins have no way to know when someone makes a suggestion or comment on their book unless they manually check the site. This plan adds @-mention tagging with autocomplete, comment/reply editing, per-user notification preferences, and email notifications via Mailgun.

**Decisions made:**
- Email provider: **Mailgun** (HTTP API, 100 emails/day free)
- Sender address: **notifications@noblecollective.org** (new Google Workspace user)
- Daily summary: **6:00 AM Eastern next day**
- @-mention autocomplete: **Tribute.js** (zero-dependency vanilla JS library, designed for textareas)
- Email templates: **MJML** (responsive email framework, compiles to HTML)

---

## Phase 1: @-Mention Tagging

### 1A. Server — Taggable users endpoint

**File: `src/server/suggestion-routes.js`**

New route: `GET /taggable-users?bookPath=...`
- Requires authentication (existing middleware)
- Calls `firestore.getAllUsers()`, filters to users with a role on the given book + global admins
- Returns `{ users: [{ email, displayName, photoURL }] }`
- Cache response in-memory for 60s per bookPath (reuse existing `cache.js`)

### 1B. Server — Accept `mentionedUsers` on create

**File: `src/server/suggestion-routes.js`**
- `POST /comments`: Accept optional `mentionedUsers` string array in body, pass to `suggestions.createComment()`
- `POST /replies`: Accept optional `mentionedUsers` string array in body, pass to `suggestions.createReply()`

**File: `src/server/suggestions.js`**
- `createComment()`: Add `mentionedUsers: data.mentionedUsers || []` to the Firestore document
- `createReply()`: Add `mentionedUsers: data.mentionedUsers || []` to the Firestore document

### 1C. Client — Install Tribute.js and build autocomplete

**Install:** `npm install tributejs` (add to devDependencies, bundle via esbuild)

**File: `src/editor-entry.js`** — Export Tribute from the CodeMirror bundle so it's available to editor scripts.

**File: `src/public/js/editor-comments.js`**
- Import Tribute from the bundle
- On `initComments()`, fetch taggable users once: `GET /api/suggestions/taggable-users?bookPath=...`. Cache in module-level variable.
- Attach Tribute to `#comment-popup-input` textarea:
  ```
  new Tribute({
    trigger: '@',
    values: users.map(u => ({ key: u.displayName, value: u.displayName, email: u.email })),
    selectTemplate: item => '@' + item.original.key,
    menuItemTemplate: item => `<span>${item.original.key}</span> <small>${item.original.email}</small>`,
  })
  ```
- Track mentions in a module-level `Set` — populate when Tribute fires `tribute-replaced` event
- On `submitComment()`: Include `mentionedUsers: [...mentionedUserEmails]` in POST body, clear set after submit

### 1D. Client — Mentions in reply inputs

**File: `src/public/js/editor-margin.js`**
- Reply inputs are `<input type="text">` created dynamically in `buildThreadHtml()`
- After `renderAllCards()`, attach Tribute to each `.margin-reply-field` input
- Need a shared `attachMentionAutocomplete(el)` function (exported from editor-comments.js or a small utility)
- Track mentioned emails per reply input using a `data-mentions` attribute or a `Map<inputEl, Set<email>>`
- Pass `mentionedUsers` through the reply send handler → `postReply()` in editor.js

**File: `src/public/js/editor.js`**
- Modify `postReply()` to accept and forward `mentionedUsers` in the POST body

### 1E. Client — Display @-mentions with visual styling

**File: `src/public/js/editor-margin.js`**
- In comment card body and reply text rendering, replace `@DisplayName` with `<span class="mention">@DisplayName</span>`
- Match against the `mentionedUsers` array + user display names for accuracy (avoid false positives)
- Same treatment in `renderHistoryCards()`

**File: `src/public/css/style.css`**
- `.mention` — green text, light green background, rounded, slight padding
- `.tribute-container` — dropdown positioning, white bg, shadow, max-height scroll
- `.tribute-container li` — padding, hover highlight
- `.tribute-container li.highlight` — active item background

---

## Phase 2: Comment and Reply Editing

### 2A. Server — Edit endpoints

**File: `src/server/suggestion-routes.js`**
- `PUT /comments/:id` — Author-only edit. Accept `{ commentText, mentionedUsers }`. Call `suggestions.updateComment()`. Return `{ status: 'ok' }`.
- `PUT /replies/:id` — Author-only edit. Accept `{ text, mentionedUsers }`. Call `suggestions.updateReply()`. Return `{ status: 'ok' }`.

**File: `src/server/suggestions.js`**
- `updateComment(id, { commentText, mentionedUsers })` — Update fields + set `editedAt: serverTimestamp()`
- `updateReply(id, { text, mentionedUsers })` — Update fields + set `editedAt: serverTimestamp()`
- `getComment(id)` — Single comment getter (if not already present)
- `getReply(id)` — Single reply getter (currently no single getter exists)

### 2B. Client — Edit UI in margin cards

**File: `src/public/js/editor-margin.js`**

Comment cards:
- Add pencil edit button in `.margin-card-actions` — visible only when `userData.email === comment.authorEmail`
- On click: Replace `.margin-card-comment-text` paragraph with a `<textarea>` pre-filled with current text + Save/Cancel buttons
- Save: `PUT /api/suggestions/comments/:id` with updated text and mentions
- After save: Update `currentComments` array in-place, re-render cards
- Show `(edited)` indicator after text when `editedAt` is set

Reply items:
- Add small pencil icon next to each reply where user is the author
- On click: Replace `.margin-card-reply-text` with an `<input>` pre-filled + save/cancel
- Save: `PUT /api/suggestions/replies/:id`
- After save: Update `currentReplies` and re-render
- Show `(edited)` indicator

**File: `src/public/css/style.css`**
- `.margin-action--edit` — pencil icon styling
- `.margin-card-edit-textarea` — inline edit textarea styles
- `.margin-card-edited` — small italic gray "(edited)" text

---

## Phase 3: Notification Preferences

### 3A. Server — Preferences storage

**File: `src/server/firestore.js`**
- `getNotificationPrefs(email)` — Returns user's `notificationPrefs` field with defaults:
  ```
  { globalOptIn: true, bookOverrides: {} }
  ```
- `updateNotificationPrefs(email, prefs)` — Updates `notificationPrefs` field on user document
- `shouldNotify(email, bookPath)` — Returns boolean:
  1. Check `globalOptIn` — if false, return false
  2. Check `bookOverrides[encodedBookPath]` — if explicitly set, use that
  3. If bookPath matches Test Book pattern (`Foundations/Test Book`), default false
  4. Otherwise default true

**Firestore `users` document addition:**
```
notificationPrefs: {
  globalOptIn: boolean,          // default: true
  bookOverrides: {               // keyed by pipe-encoded book path
    "series|...|Test Book": false
  }
}
```

### 3B. Server — Notification preferences routes

**File: `src/server/notification-routes.js`** (new)
- `GET /notifications` — Page route. Requires auth. Renders notification preferences page with user prefs + book list (books where user has comment-suggest+ role).
- `GET /api/notifications/preferences` — Returns user's notification preferences JSON.
- `PUT /api/notifications/preferences` — Updates preferences. Accepts `{ globalOptIn, bookOverrides }`.

**File: `src/server/index.js`**
- Register routes before the catch-all content route:
  ```
  const notificationRoutes = require('./notification-routes');
  app.use('/notifications', notificationRoutes.page);
  app.use('/api/notifications', notificationRoutes.api);
  ```

### 3C. Client — Notification preferences page

**File: `src/views/notifications.ejs`** (new)
- Same layout as other pages (header/footer partials, sidebar)
- User info at top (name, email)
- Global toggle: "Receive email notifications" — CSS toggle switch
- Book list: Each book the user has access to, with individual toggle
- Test Book shows note: "Notifications off by default for test content"
- Auto-save on toggle change (PUT to API, with optimistic UI)

**File: `src/views/partials/sidebar-auth.ejs`**
- Add "Notifications" link below "Admin Console" for logged-in users:
  ```
  <a href="/notifications" class="sidebar-auth-link">Notifications</a>
  ```
- Also add to mobile drawer in `header.ejs`

**File: `src/public/css/style.css`**
- `.notif-prefs-container`, `.notif-toggle-row`, `.notif-book-list`
- CSS-only toggle switch (checkbox + label pattern)

---

## Phase 3B: Admin Role-Change Notifications

When an admin assigns a user to a book or changes their role, the affected user should get an immediate email notification.

### Server — Wire into admin routes

**File: `src/server/admin-routes.js`**

After `PUT /users/:email/books` (set book role) succeeds:
- Look up book title from content tree (using `content.buildContentTree()` + `content.getAllBooks()`)
- Call `notifications.sendRoleChangeEmail({ recipientEmail, bookTitle, role, assignedByName })` — fire-and-forget
- Only send if user has `globalOptIn !== false` (check via `firestore.shouldNotify()`)

After `PUT /users/:email/role` (set global role) succeeds:
- If role is being set to `'admin'`: send notification "You've been granted Admin access"
- Fire-and-forget, only if opted in

**Do NOT notify on:**
- Role removal (`DELETE /users/:email/books`) — no email for access being taken away
- User deletion (`DELETE /users/:email`)

### Email template

**File: `src/server/email-templates.js`**
- `roleChangeHtml({ recipientName, bookTitle, roleName, assignedByName, link })` — "You've been given [Role] access to [Book Title]"
- Includes a deep link to the book page
- Friendly role name mapping: `manuscript-owner` → "Manuscript Owner", `comment-suggest` → "Commenter", `viewer` → "Viewer", `admin` → "Admin"

### Notification document

Same `notifications` collection, with `type: 'role_change'`. Sent immediately (no daily aggregation — role changes are infrequent and important).

---

## Phase 4: Email Infrastructure & Notifications

### 4A. Mailgun setup and email module

**Install:** `npm install mailgun.js form-data`

**File: `src/server/email.js`** (new)
- Initialize Mailgun client:
  ```js
  const Mailgun = require('mailgun.js');
  const formData = require('form-data');
  const mg = new Mailgun(formData);
  const client = mg.client({ username: 'api', key: process.env.MAILGUN_API_KEY });
  ```
- `sendEmail({ to, subject, html })` — Wraps `client.messages.create(MAILGUN_DOMAIN, { from, to, subject, html, 'h:List-Unsubscribe': '...' })`
- `sendBatch(emails)` — Sends array of emails with 100ms delay between each
- All calls wrapped in try/catch — email failures never crash the app
- Graceful no-op if `MAILGUN_API_KEY` is not set (local dev)

### 4B. Email templates

**Install:** `npm install mjml`

**File: `src/server/email-templates.js`** (new)
- `emailLayout(bodyHtml)` — Shared wrapper matching site style (green/gold/charcoal, Lora/Poppins via web-safe fallbacks). Header with Noble Imprint logo, footer with unsubscribe link.
- `mentionNotificationHtml({ recipientName, actorName, bookTitle, sessionTitle, commentText, selectedText, link })` — "@ActorName mentioned you in a comment"
- `firstActivityHtml({ recipientName, bookTitle, actorName, actionType, text, link })` — "New activity on [Book Title]"
- `dailySummaryHtml({ recipientName, books: [{ bookTitle, activities: [...] }] })` — Consolidated daily digest

All functions return compiled HTML via `mjml(mjmlString).html`.

### 4C. Notification service

**File: `src/server/notifications.js`** (new)

**Firestore `notifications` collection:**
```
{
  recipientEmail: string,
  type: 'mention' | 'activity' | 'role_change',
  bookPath: string,
  filePath: string,
  triggerEvent: {
    action: 'comment' | 'reply' | 'suggestion',
    actorEmail: string,
    actorName: string,
    parentId: string,
    text: string,               // comment/reply text snippet
    selectedText: string | null  // text being commented on
  },
  status: 'pending' | 'sent' | 'skipped' | 'failed',
  immediateEmailSent: boolean,   // true if first-of-day email already sent
  createdAt: Timestamp,
  sentAt: Timestamp | null
}
```

Core functions:
- `queueNotification({ recipientEmail, type, bookPath, filePath, triggerEvent })` — Creates a `notifications` document with `status: 'pending'`. Checks `firestore.shouldNotify()` first; if opted out, sets status to `'skipped'` immediately.
- `processImmediateNotifications(bookPath, actorEmail)` — Called after comment/reply/suggestion creation. For each manuscript-owner/admin of that book:
  1. Check if they've already received an immediate email today for this book (query `notifications` where recipientEmail + bookPath + `immediateEmailSent: true` + createdAt today)
  2. If first time today → send immediate email, mark `immediateEmailSent: true`
  3. If not first → leave as pending for daily summary
  For @-mentions: Always send immediate email (regardless of first-of-day logic).
- `sendDailySummary()` — Query all `pending` notifications for the previous day. Group by recipientEmail. For each recipient, group by bookPath. Build one consolidated email with all books. Send via `email.sendEmail()`. Mark all as `sent`.
- `buildDeepLink(filePath, bookPath)` — Converts file path to URL using slug logic from `content.js`.

### 4D. Wire notifications into creation routes

**File: `src/server/suggestion-routes.js`**

After each successful creation, fire notifications async (non-blocking):

- `POST /comments` — After `createComment()` succeeds:
  - For each `mentionedUsers` email: queue `type: 'mention'` notification
  - For manuscript-owners/admins of the book: queue `type: 'activity'` notification
  - Call `processImmediateNotifications()` (fire-and-forget with `.catch(console.error)`)

- `POST /replies` — Same pattern (mentions + activity notifications)

- `POST /hunk` — After `createHunk()` succeeds:
  - For manuscript-owners/admins: queue `type: 'activity'` notification
  - Call `processImmediateNotifications()` fire-and-forget
  - (No @-mentions on suggestions)

**Important:** The notification queue + send is async. The API response returns immediately. If email fails, the notification stays `pending` and gets picked up in the daily summary retry.

### 4E. Daily summary endpoint

**File: `src/server/notification-routes.js`**
- `POST /api/internal/send-daily-summary` — Protected by `x-cloudscheduler-key` header check against `process.env.SCHEDULER_SECRET`. Calls `notifications.sendDailySummary()`. Returns `{ status: 'ok', sent: count }`.

### 4F. Cloud Scheduler setup (one-time infrastructure)

```bash
# Create the scheduler secret
echo -n "$(openssl rand -hex 32)" | gcloud secrets create scheduler-secret \
  --data-file=- --project=noble-imprint-website

# Create the scheduled job — 6 AM Eastern daily
gcloud scheduler jobs create http noble-daily-summary \
  --location=us-central1 \
  --schedule="0 6 * * *" \
  --time-zone="America/New_York" \
  --uri="https://resources.noblecollective.org/api/internal/send-daily-summary" \
  --http-method=POST \
  --headers="x-cloudscheduler-key=SCHEDULER_SECRET_VALUE" \
  --project=noble-imprint-website
```

Update Cloud Run service env vars:
```bash
gcloud run services update resource-website \
  --set-env-vars="MAILGUN_API_KEY=...,MAILGUN_DOMAIN=noblecollective.org,SCHEDULER_SECRET=..." \
  --region=us-central1 --project=noble-imprint-website
```

---

## DNS & Email Deliverability Work

### Cloudflare DNS changes required

**1. Verify existing records first:**
- Log into Cloudflare → noblecollective.org → DNS
- Check for existing SPF record (should have `include:_spf.google.com` for Google Workspace)
- Check for existing DKIM records at `google._domainkey.noblecollective.org`

**2. Mailgun domain verification:**
- Add domain `noblecollective.org` in Mailgun dashboard
- Mailgun will provide DNS records to add:

**3. Add/update these DNS records in Cloudflare:**

| Type | Name | Value | Notes |
|------|------|-------|-------|
| TXT | `@` | `v=spf1 include:_spf.google.com include:mailgun.org ~all` | Update existing SPF to add Mailgun |
| TXT | `smtp._domainkey` | *(Mailgun provides this DKIM public key)* | New DKIM record for Mailgun |
| TXT | `_dmarc` | `v=DMARC1; p=quarantine; rua=mailto:steve@noblecollective.org` | Add DMARC policy if not present |
| CNAME | `email.mg` | `mailgun.org` | Mailgun tracking (optional) |

**4. Verify in Mailgun dashboard** that domain is verified (green checkmarks on SPF + DKIM).

**5. Create Google Workspace user** `notifications@noblecollective.org` for the "from" address. This ensures the address exists for any bounces/replies.

### What could go wrong with deliverability
- **SPF too many lookups:** SPF allows max 10 DNS lookups. Adding Mailgun's `include:mailgun.org` adds ~2 lookups. Check current count first (`nslookup -type=TXT noblecollective.org`). Google Workspace typically uses 3-4. Should be fine.
- **DMARC alignment:** The "From" header must use `noblecollective.org` domain, and both SPF and DKIM must align. Mailgun handles this when configured correctly.
- **Sender reputation:** New senders start with neutral reputation. Low volume (~5-20 emails/day) won't trigger throttling. Avoid sending to nonexistent addresses (only send to known admin console users).

---

## Libraries & Tools Summary

| Library | Purpose | Why chosen |
|---------|---------|------------|
| `mailgun.js` + `form-data` | Email sending | HTTP API (no SMTP port issues on Cloud Run), 100/day free, good deliverability |
| `tributejs` | @-mention autocomplete | Zero dependencies, vanilla JS, textarea support, specifically for @-mentions |
| `mjml` | Email templates | Industry-standard responsive email, compiles to battle-tested HTML |
| Google Cloud Scheduler | Daily summary cron | Managed, survives Cloud Run scale-to-zero, $0.10/month |

**Not using:**
- Nodemailer — SMTP unreliable from Cloud Run datacenter IPs
- SendGrid — Free tier discontinued
- node-cron / Bree — Don't survive Cloud Run scale-to-zero
- BullMQ — Requires Redis, overkill for this volume
- Firebase Trigger Email extension — Adds Cloud Functions dependency, still needs SMTP provider

---

## Risk Analysis: Impact on Existing Code

### LOW RISK (additive changes, no existing behavior modified)

| Change | Risk | Mitigation |
|--------|------|------------|
| New `notifications.ejs` page | None — new page, no existing pages affected | Uses same layout partials |
| New `notification-routes.js` file | None — new routes, registered before catch-all | Route registration order verified in index.js |
| New `email.js`, `email-templates.js`, `notifications.js` | None — new modules, not imported by existing code until wired in | Graceful no-op when env vars missing |
| Sidebar "Notifications" link | Minimal — adds one link to sidebar-auth.ejs | Only shows for logged-in users, no layout shift |
| Cloud Scheduler job | None — external to the app, calls a new endpoint | Protected by secret header |
| `notificationPrefs` field on user documents | None — new field, no existing code reads it | Old documents work fine (defaults applied) |

### MEDIUM RISK (modifying existing files, but isolated changes)

| Change | Risk | Mitigation |
|--------|------|------------|
| `mentionedUsers` field on comments/replies | Low — additive Firestore field, existing code ignores it | Existing create flows unchanged (field is optional) |
| `editedAt` field on comments/replies | Low — additive field, only read by new edit UI | No impact on existing comment/reply display |
| `PUT /comments/:id` and `PUT /replies/:id` routes | Low — new routes, no collision with existing | Existing POST/DELETE routes untouched |
| `editor-comments.js` — Tribute.js attachment | Medium — modifying `initComments()` and `submitComment()` | Tribute attaches to existing textarea, doesn't replace it. Submit flow adds optional field. Test: verify comment creation still works without @-mentioning anyone |
| `editor-margin.js` — edit buttons + mention display | Medium — modifying card rendering HTML | Edit buttons only show for author. Mention spans are display-only. Test: verify existing cards render correctly, resolve/discard still work |
| `editor.js` — `postReply()` modification | Low — adding optional parameter | Existing callers don't pass it, default is `[]` |
| `suggestion-routes.js` — notification wiring | Medium — adding async fire-and-forget calls after existing create responses | Notifications are non-blocking (`.catch(console.error)`). If notification code throws synchronously before the async call, it could block the response. Mitigation: wrap entire notification block in try/catch |
| `admin-routes.js` — role-change notification | Low — adding async fire-and-forget after successful role assignment | Same pattern as suggestion-routes. Existing response sent first, notification is bonus. Wrap in try/catch. |
| `index.js` — route registration | Low — adding 2 lines before catch-all | Same pattern as existing admin/suggestion routes |

### CRITICAL AREAS TO PROTECT

1. **Auto-save flow** (`editor.js` → `POST /hunk`) — The notification wiring must be strictly after the successful response. Never block or delay auto-save.

2. **Accept/reject flow** (`suggestion-routes.js` → `PUT /hunk/:id/accept`) — Not modified. No notifications on accept (only on creation). Safe.

3. **Annotation registry** (`editor-suggestions.js`) — Not modified at all. @-mentions are purely a comment/reply text feature, not a CM6 state concern.

4. **Masking/constraints** (`editor-masking.js`, `editor-constraints.js`) — Not modified.

5. **Polling loops** (`editor.js` — suggestion-count, file-version, presence) — Not modified. New notification data doesn't flow through polling.

6. **Tribute.js + CodeMirror interaction** — Tribute attaches to the comment popup textarea (`#comment-popup-input`), which is a standard HTML textarea *outside* the CodeMirror editor. No interaction with CM6 state, transactions, or decorations. Reply inputs are also standard `<input>` elements in the margin panel, outside CM6.

7. **Test suite** — Existing ~130 tests should pass unchanged since:
   - No Firestore schema breaking changes (all fields are additive)
   - No API endpoint signature changes (new fields are optional)
   - No editor behavior changes (CM6 extensions untouched)
   - Notification sending is no-op when `MAILGUN_API_KEY` is not set

---

## New Files Summary (7)

| File | Purpose |
|------|---------|
| `src/server/email.js` | Mailgun client wrapper, `sendEmail()`, `sendBatch()` |
| `src/server/email-templates.js` | MJML templates: mention, first-activity, daily summary |
| `src/server/notifications.js` | Notification queue, immediate send, daily summary logic |
| `src/server/notification-routes.js` | Page route + API routes for preferences, daily summary trigger |
| `src/views/notifications.ejs` | Notification preferences page |
| `src/public/css/tribute.css` | Tribute.js dropdown styles (or inline in style.css) |
| `plans/2026-04-24-notifications-and-mentions.md` | Implementation plan saved to plans/ folder |

## Modified Files Summary (10)

| File | Changes |
|------|---------|
| `src/server/suggestion-routes.js` | Add taggable-users endpoint, PUT comment/reply edit routes, wire notifications into POST comment/reply/hunk |
| `src/server/admin-routes.js` | Wire role-change notifications into PUT /users/:email/books and PUT /users/:email/role |
| `src/server/suggestions.js` | Add updateComment(), updateReply(), getComment(), getReply(); modify createComment/createReply to store mentionedUsers |
| `src/server/firestore.js` | Add getNotificationPrefs(), updateNotificationPrefs(), shouldNotify() |
| `src/server/index.js` | Register notification routes |
| `src/public/js/editor-comments.js` | Tribute.js autocomplete on comment popup, track mentions, pass mentionedUsers on submit |
| `src/public/js/editor-margin.js` | Edit buttons + inline editing UI, mention display styling, Tribute on reply inputs |
| `src/public/js/editor.js` | Modify postReply() to forward mentionedUsers |
| `src/views/partials/sidebar-auth.ejs` | Add "Notifications" link |
| `src/public/css/style.css` | Mention styles, edit button/textarea, toggle switch, notification page, Tribute dropdown |
| `package.json` | Add mailgun.js, form-data, tributejs, mjml |

---

## Implementation Order

1. **Phase 2: Comment/reply editing** — Independent, small, high user value. Good warm-up.
2. **Phase 1: @-mention tagging** — Core feature, enables notification targeting.
3. **Phase 3: Notification preferences** — Must exist before sending any emails.
4. **Phase 4: Email notifications** — Depends on Phase 1 (mentionedUsers) + Phase 3 (preferences).

Phases 1 and 2 are independent and can be done in either order.

---

## Verification

### Phase 1 (@-mentions)
- Start local server (`npm start`)
- Open a session page in suggest mode, select text, click Comment
- Type `@` in the comment popup textarea — verify dropdown appears with user names
- Select a user — verify `@DisplayName` inserted into text
- Submit comment — verify card shows mention with green highlight styling
- Check Firestore comment document — verify `mentionedUsers` array contains the email
- Same test in reply input field

### Phase 2 (Comment/reply editing)
- Create a comment, verify pencil icon appears on your own comment
- Click pencil — verify textarea appears with current text
- Edit and save — verify card updates, "(edited)" appears
- Verify pencil does NOT appear on other users' comments
- Same test for replies

### Phase 3 (Notification preferences)
- Navigate to /notifications — verify page loads with global toggle ON
- Toggle global off/on — verify PUT request and page state
- Verify per-book toggles show only books you have access to
- Verify Test Book defaults to OFF

### Phase 4 (Email notifications)
- Create a comment mentioning a user — verify Mailgun API called, email received
- Create a suggestion on a book — verify manuscript owner gets immediate email (first of day)
- Create another suggestion — verify no immediate email (queued for summary)
- Trigger daily summary manually: `curl -X POST -H "x-cloudscheduler-key: SECRET" https://resources.noblecollective.org/api/internal/send-daily-summary`
- Verify consolidated summary email received with all pending notifications

### Phase 3B (Admin role-change notifications)
- In admin console, assign a user a new book role — verify they receive an email with the book title and role name
- Assign admin role — verify email sent
- Remove a book role — verify NO email sent
- Verify email includes link to the book page

### Regression testing
- Run existing Playwright test suite: `npx playwright test tests/ --workers=1`
- Verify all ~130 tests pass unchanged
- Manual smoke test: create suggestion, accept, reject, direct edit, multi-user sync
