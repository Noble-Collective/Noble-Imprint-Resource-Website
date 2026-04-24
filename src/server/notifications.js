const admin = require('firebase-admin');
const firestore = require('./firestore');
const email = require('./email');
const templates = require('./email-templates');
const content = require('./content');

function getDb() {
  return admin.firestore();
}

function notificationsCollection() {
  return getDb().collection('notifications');
}

// Role name mapping for display
const ROLE_DISPLAY_NAMES = {
  'manuscript-owner': 'Manuscript Owner',
  'comment-suggest': 'Commenter',
  'viewer': 'Viewer',
  'admin': 'Admin',
};

// --- Queue a notification ---
async function queueNotification({ recipientEmail, type, bookPath, filePath, triggerEvent }) {
  // Don't notify the actor about their own action
  if (recipientEmail === triggerEvent.actorEmail) return null;

  // Check if user has opted in
  const shouldSend = await firestore.shouldNotify(recipientEmail, bookPath);
  const status = shouldSend ? 'pending' : 'skipped';

  const ref = await notificationsCollection().add({
    recipientEmail,
    type,
    bookPath,
    filePath: filePath || null,
    triggerEvent,
    status,
    immediateEmailSent: false,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    sentAt: null,
  });
  return { id: ref.id, status };
}

// --- Check if first activity email was sent today for this recipient+book ---
async function hasImmediateEmailToday(recipientEmail, bookPath) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const snap = await notificationsCollection()
    .where('recipientEmail', '==', recipientEmail)
    .where('bookPath', '==', bookPath)
    .where('immediateEmailSent', '==', true)
    .where('createdAt', '>=', admin.firestore.Timestamp.fromDate(today))
    .limit(1)
    .get();
  return !snap.empty;
}

// --- Process immediate notifications after a comment/reply/suggestion is created ---
async function processImmediateNotifications({ bookPath, filePath, actorEmail, actorName, action, text, selectedText, mentionedUsers }) {
  const tree = await content.buildContentTree();
  const allBooks = content.getAllBooks(tree);
  const book = allBooks.find(b => b.repoPath === bookPath);
  const bookTitle = book ? book.title : bookPath;

  // Build deep link
  const link = filePath ? await buildDeepLink(filePath, tree) : null;

  // 1. Send immediate emails for @-mentions
  if (mentionedUsers && mentionedUsers.length > 0) {
    for (const mentionedEmail of mentionedUsers) {
      if (mentionedEmail === actorEmail) continue;
      const shouldSend = await firestore.shouldNotify(mentionedEmail, bookPath);
      if (!shouldSend) continue;

      const recipient = await firestore.getUser(mentionedEmail);
      const recipientName = recipient ? (recipient.displayName || mentionedEmail) : mentionedEmail;

      await queueNotification({
        recipientEmail: mentionedEmail,
        type: 'mention',
        bookPath, filePath,
        triggerEvent: { action, actorEmail, actorName, text, selectedText },
      });

      const html = await templates.mentionNotificationHtml({
        recipientName,
        actorName,
        bookTitle,
        coverPath: book ? book.coverPath : null,
        sessionTitle: null,
        commentText: text,
        selectedText,
        link,
      });
      await email.sendEmail({ to: mentionedEmail, subject: actorName + ' mentioned you in a comment', html });

      // Mark as sent
      const snap = await notificationsCollection()
        .where('recipientEmail', '==', mentionedEmail)
        .where('type', '==', 'mention')
        .where('status', '==', 'pending')
        .orderBy('createdAt', 'desc')
        .limit(1)
        .get();
      if (!snap.empty) {
        await snap.docs[0].ref.update({
          status: 'sent',
          immediateEmailSent: true,
          sentAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      }
    }
  }

  // 2. Notify manuscript owners and admins (first-of-day = immediate, rest = pending for summary)
  const allUsers = await firestore.getAllUsers();
  const encodedBook = bookPath.replace(/\//g, '|');
  const bookStakeholders = allUsers.filter(u => {
    if (u.email === actorEmail) return false;
    if (u.globalRole === 'admin') return true;
    if (require('./auth').isSuperAdmin(u.email)) return true;
    const role = u.bookRoles ? u.bookRoles[encodedBook] : null;
    return role === 'manuscript-owner' || role === 'admin';
  });

  for (const stakeholder of bookStakeholders) {
    // Skip if they were already notified via @-mention
    if (mentionedUsers && mentionedUsers.includes(stakeholder.email)) continue;

    const shouldSend = await firestore.shouldNotify(stakeholder.email, bookPath);
    if (!shouldSend) continue;

    const notif = await queueNotification({
      recipientEmail: stakeholder.email,
      type: 'activity',
      bookPath, filePath,
      triggerEvent: { action, actorEmail, actorName, text, selectedText },
    });
    if (!notif || notif.status === 'skipped') continue;

    // Check if this is the first activity today for this stakeholder on this book
    const alreadySentToday = await hasImmediateEmailToday(stakeholder.email, bookPath);
    if (!alreadySentToday) {
      const recipientName = stakeholder.displayName || stakeholder.email;
      const html = await templates.firstActivityHtml({
        recipientName,
        bookTitle,
        coverPath: book ? book.coverPath : null,
        actorName,
        actionType: action,
        text,
        link,
      });
      await email.sendEmail({ to: stakeholder.email, subject: 'New activity on ' + bookTitle, html });

      // Mark this notification as immediately sent
      await notificationsCollection().doc(notif.id).update({
        status: 'sent',
        immediateEmailSent: true,
        sentAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    }
    // else: stays pending for daily summary
  }
}

// --- Daily summary: send consolidated emails for all pending notifications ---
async function sendDailySummary() {
  // Get all pending notifications (not yet sent)
  const snap = await notificationsCollection()
    .where('status', '==', 'pending')
    .get();

  if (snap.empty) {
    console.log('[NOTIFICATIONS] No pending notifications for daily summary');
    return { sent: 0 };
  }

  // Group by recipient
  const byRecipient = new Map();
  for (const doc of snap.docs) {
    const data = { id: doc.id, ...doc.data() };
    if (!byRecipient.has(data.recipientEmail)) byRecipient.set(data.recipientEmail, []);
    byRecipient.get(data.recipientEmail).push(data);
  }

  let sentCount = 0;
  const tree = await content.buildContentTree();
  const allBooks = content.getAllBooks(tree);

  for (const [recipientEmail, notifs] of byRecipient) {
    // Group by book
    const byBook = new Map();
    for (const n of notifs) {
      if (!byBook.has(n.bookPath)) byBook.set(n.bookPath, []);
      byBook.get(n.bookPath).push(n);
    }

    const books = [];
    for (const [bookPath, bookNotifs] of byBook) {
      const book = allBooks.find(b => b.repoPath === bookPath);
      const bookTitle = book ? book.title : bookPath;
      books.push({
        bookTitle,
        coverPath: book ? book.coverPath : null,
        link: book ? buildBookLink(book, tree) : null,
        activities: bookNotifs.map(n => ({
          actorName: n.triggerEvent.actorName || n.triggerEvent.actorEmail,
          actionType: n.triggerEvent.action,
          text: n.triggerEvent.text,
          sessionTitle: null,
        })),
      });
    }

    const recipient = await firestore.getUser(recipientEmail);
    const recipientName = recipient ? (recipient.displayName || recipientEmail) : recipientEmail;

    const html = await templates.dailySummaryHtml({ recipientName, books });
    await email.sendEmail({ to: recipientEmail, subject: 'Daily editing summary — Noble Imprint', html });

    // Mark all as sent
    const batch = getDb().batch();
    for (const n of notifs) {
      batch.update(notificationsCollection().doc(n.id), {
        status: 'sent',
        sentAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    }
    await batch.commit();
    sentCount++;
  }

  console.log('[NOTIFICATIONS] Daily summary sent to', sentCount, 'recipients');
  return { sent: sentCount };
}

// --- Role change notification (immediate) ---
async function sendRoleChangeEmail({ recipientEmail, bookPath, bookTitle, role, assignedByName }) {
  const shouldSend = await firestore.shouldNotify(recipientEmail, bookPath);
  if (!shouldSend) return;

  const recipient = await firestore.getUser(recipientEmail);
  const recipientName = recipient ? (recipient.displayName || recipientEmail) : recipientEmail;
  const roleName = ROLE_DISPLAY_NAMES[role] || role;

  const tree = await content.buildContentTree();
  const allBooks = content.getAllBooks(tree);
  const book = allBooks.find(b => b.repoPath === bookPath);
  const link = book ? buildBookLink(book, tree) : null;

  const html = await templates.roleChangeHtml({ recipientName, bookTitle, coverPath: book ? book.coverPath : null, roleName, assignedByName, link });
  await email.sendEmail({ to: recipientEmail, subject: 'You\'ve been given access to ' + bookTitle, html });

  // Log it
  await notificationsCollection().add({
    recipientEmail,
    type: 'role_change',
    bookPath,
    filePath: null,
    triggerEvent: { action: 'role_change', actorEmail: '', actorName: assignedByName, text: roleName },
    status: 'sent',
    immediateEmailSent: true,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    sentAt: admin.firestore.FieldValue.serverTimestamp(),
  });
}

async function sendAdminRoleEmail({ recipientEmail, assignedByName }) {
  // Check global opt-in only (no book context for admin role)
  const prefs = await firestore.getNotificationPrefs(recipientEmail);
  if (!prefs.globalOptIn) return;

  const recipient = await firestore.getUser(recipientEmail);
  const recipientName = recipient ? (recipient.displayName || recipientEmail) : recipientEmail;

  const html = await templates.adminRoleHtml({ recipientName, assignedByName });
  await email.sendEmail({ to: recipientEmail, subject: 'You\'ve been granted Admin access', html });
}

// --- Helpers ---

const SITE = 'https://resources.noblecollective.org';

// Walk the content tree to find a book's series/subseries context and build a URL
function findBookInTree(tree, bookRepoPath) {
  for (const series of tree.series || []) {
    for (const child of series.children || []) {
      if (child.type === 'book' && child.repoPath === bookRepoPath) {
        return { series, subseries: null, book: child };
      } else if (child.type === 'subseries') {
        for (const book of child.books || []) {
          if (book.repoPath === bookRepoPath) {
            return { series, subseries: child, book };
          }
        }
      }
    }
  }
  return null;
}

// Build a deep link URL to a session page from a file path
async function buildDeepLink(filePath, tree) {
  try {
    // Find which book this file belongs to
    const sessionsIdx = filePath.indexOf('/sessions/');
    if (sessionsIdx < 0) return SITE;
    const bookPath = filePath.substring(0, sessionsIdx);
    const found = findBookInTree(tree, bookPath);
    if (!found) return SITE;

    // Load sessions if not already loaded, then find the matching one
    if (!found.book.sessions || found.book.sessions.length === 0) {
      try { await content.loadSessionTitles(found.book); } catch { /* ignore */ }
    }
    const sessionFile = filePath.substring(sessionsIdx + '/sessions/'.length);
    const session = (found.book.sessions || []).find(s => s.path === filePath || s.path.endsWith(sessionFile));
    if (session) {
      return SITE + content.sessionUrl(found.series, found.subseries, found.book, session);
    }
    // Fall back to book page
    return SITE + content.bookUrl(found.series, found.subseries, found.book);
  } catch { /* fallback */ }
  return SITE;
}

function buildBookLink(book, tree) {
  try {
    const found = findBookInTree(tree, book.repoPath);
    if (found) return SITE + content.bookUrl(found.series, found.subseries, found.book);
  } catch { /* fallback */ }
  return SITE;
}

module.exports = {
  queueNotification,
  processImmediateNotifications,
  sendDailySummary,
  sendRoleChangeEmail,
  sendAdminRoleEmail,
  ROLE_DISPLAY_NAMES,
};
