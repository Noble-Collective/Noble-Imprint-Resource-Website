const mjml = require('mjml');

const SITE_URL = 'https://resources.noblecollective.org';
const GREEN = '#27ae60';
const GOLD = '#d7b44a';
const CHARCOAL = '#333';

async function compile(mjmlString) {
  const result = await mjml(mjmlString, { minify: true });
  if (result.errors && result.errors.length > 0) {
    console.error('[EMAIL-TEMPLATE] MJML errors:', result.errors);
  }
  return result.html;
}

function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// coverPath is the full repo path including extension (e.g., "series/.../cover.svg")
function bookCoverUrl(coverPath) {
  if (!coverPath) return null;
  return SITE_URL + '/cover/' + coverPath;
}

// Book title with accent bar — all covers are SVG which email clients block, so use styled text
function bookHeaderMjml(bookTitle, coverPath, link) {
  const titleHtml = link
    ? '<a href="' + escapeHtml(link) + '" style="color:' + CHARCOAL + ';text-decoration:none">' + escapeHtml(bookTitle) + '</a>'
    : escapeHtml(bookTitle);
  return `<mj-text padding="8px 0 8px 12px" font-size="15px" font-weight="600" css-class="book-header">${titleHtml}</mj-text>`;
}

// Shared email layout wrapper
function emailLayout(title, bodyMjml) {
  return `
<mjml>
  <mj-head>
    <mj-attributes>
      <mj-all font-family="'DM Sans', Arial, sans-serif" />
      <mj-text font-size="14px" color="${CHARCOAL}" line-height="1.6" padding="4px 0" />
    </mj-attributes>
    <mj-style>
      a { color: ${GREEN}; }
      .mention { color: ${GREEN}; font-weight: 600; background: #e8f5e9; border-radius: 2px; padding: 0 2px; }
      .quote-border { border-left: 3px solid ${GOLD} !important; }
      .comment-border { border-left: 3px solid ${GREEN} !important; }
      .book-header { border-left: 3px solid ${GOLD} !important; }
    </mj-style>
  </mj-head>
  <mj-body background-color="#f5f5f5">
    <mj-section background-color="${CHARCOAL}" padding="16px 24px">
      <mj-column>
        <mj-text color="#fff" font-size="16px" font-weight="600" padding="0">Noble Collective Resources</mj-text>
      </mj-column>
    </mj-section>

    <mj-section background-color="#ffffff" padding="20px 24px 4px">
      <mj-column>
        ${bodyMjml}
      </mj-column>
    </mj-section>

    <mj-section padding="16px 24px">
      <mj-column>
        <mj-text font-size="11px" color="#999" align="center">
          <a href="${SITE_URL}/notifications" style="color:#999">Manage notification settings</a>
          &nbsp;&middot;&nbsp;
          <a href="${SITE_URL}" style="color:#999">resources.noblecollective.org</a>
        </mj-text>
      </mj-column>
    </mj-section>
  </mj-body>
</mjml>`;
}

async function mentionNotificationHtml({ recipientName, actorName, bookTitle, coverPath, sessionTitle, commentText, selectedText, link }) {
  const body = `
    <mj-text>Hi ${escapeHtml(recipientName)},</mj-text>
    <mj-text>
      <strong>${escapeHtml(actorName)}</strong> mentioned you in a comment on <strong>${escapeHtml(bookTitle)}</strong>${sessionTitle ? ' — ' + escapeHtml(sessionTitle) : ''}.
    </mj-text>
    ${selectedText ? `<mj-text padding="12px 0 0 0"><div style="border-left:3px solid ${GOLD};padding:6px 12px;font-size:13px;color:#888;font-style:italic">"${escapeHtml(selectedText.substring(0, 120))}"</div></mj-text>` : ''}
    <mj-text padding="12px 0 0 0"><div style="border-left:3px solid ${GREEN};padding:6px 12px">${escapeHtml(commentText)}</div></mj-text>
    ${link ? `<mj-button background-color="${GREEN}" href="${escapeHtml(link)}" font-size="13px" inner-padding="8px 20px" border-radius="4px">View Comment</mj-button>` : ''}`;
  return compile(emailLayout('You were mentioned', body));
}

async function firstActivityHtml({ recipientName, bookTitle, coverPath, actorName, actionType, text, link }) {
  const actionLabel = actionType === 'suggestion' ? 'made a suggestion' : actionType === 'comment' ? 'left a comment' : 'replied';
  const body = `
    <mj-text>Hi ${escapeHtml(recipientName)},</mj-text>
    <mj-text>
      <strong>${escapeHtml(actorName)}</strong> ${actionLabel} on <strong>${escapeHtml(bookTitle)}</strong>.
    </mj-text>
    <mj-text padding="12px 0 0 0"><div style="border-left:3px solid ${GOLD};padding:6px 12px;font-size:13px;color:#555">${escapeHtml(text ? text.substring(0, 200) : '')}</div></mj-text>
    <mj-text font-size="12px" color="#888">
      You'll receive a daily summary of any further activity at 6:00 AM ET.
    </mj-text>
    ${link ? `<mj-button background-color="${GREEN}" href="${escapeHtml(link)}" font-size="13px" inner-padding="8px 20px" border-radius="4px">View on Site</mj-button>` : ''}`;
  return compile(emailLayout('New activity on ' + bookTitle, body));
}

async function dailySummaryHtml({ recipientName, books }) {
  let bookSections = '';
  for (const book of books) {
    bookSections += bookHeaderMjml(book.bookTitle, book.coverPath, book.link);
    for (const activity of book.activities) {
      const actionLabel = activity.actionType === 'suggestion' ? 'suggested an edit' : activity.actionType === 'comment' ? 'commented' : 'replied';
      bookSections += `
      <mj-text font-size="13px">
        <strong>${escapeHtml(activity.actorName)}</strong> ${actionLabel}${activity.sessionTitle ? ' on ' + escapeHtml(activity.sessionTitle) : ''}
        ${activity.text ? '<br/><span style="color:#666">' + escapeHtml(activity.text.substring(0, 100)) + '</span>' : ''}
      </mj-text>`;
    }
  }

  const body = `
    <mj-text>Hi ${escapeHtml(recipientName)},</mj-text>
    <mj-text>Here's yesterday's editing activity:</mj-text>
    ${bookSections}`;
  return compile(emailLayout('Daily Summary', body));
}

async function roleChangeHtml({ recipientName, bookTitle, coverPath, roleName, assignedByName, link }) {
  const body = `
    <mj-text>Hi ${escapeHtml(recipientName)},</mj-text>
    <mj-text>
      ${escapeHtml(assignedByName)} has given you <strong>${escapeHtml(roleName)}</strong> access:
    </mj-text>
    ${bookHeaderMjml(bookTitle, coverPath, link)}
    ${link ? `<mj-button background-color="${GREEN}" href="${escapeHtml(link)}" font-size="13px" inner-padding="8px 20px" border-radius="4px">View Book</mj-button>` : ''}`;
  return compile(emailLayout('New book access', body));
}

async function adminRoleHtml({ recipientName, assignedByName }) {
  const body = `
    <mj-text>Hi ${escapeHtml(recipientName)},</mj-text>
    <mj-text>
      ${escapeHtml(assignedByName)} has granted you <strong>Admin</strong> access to Noble Collective Resources. You can now manage all books, users, and suggestions.
    </mj-text>
    <mj-button background-color="${GREEN}" href="${SITE_URL}/admin" font-size="13px" inner-padding="8px 20px" border-radius="4px">Open Admin Console</mj-button>`;
  return compile(emailLayout('Admin access granted', body));
}

module.exports = {
  mentionNotificationHtml,
  firstActivityHtml,
  dailySummaryHtml,
  roleChangeHtml,
  adminRoleHtml,
};
