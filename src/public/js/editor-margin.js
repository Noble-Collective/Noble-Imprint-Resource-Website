// Noble Imprint — Margin Panel for Suggestions and Comments
// Shows cards alongside the editor, positioned to align with document text.
import { getPendingFormatGroups, attachMentionToElement, getPendingMentions, clearPendingMentions } from '/static/js/editor-comments.js';

let marginEl = null;
let editorView = null;
let currentHunks = [];
let currentComments = [];
let currentReplies = [];
let userData = null; // { email, displayName, photoURL, editRole }
let onAcceptHunk = null;
let onRejectHunk = null;
let onResolveComment = null;
let onPostReply = null;
let onDismissStale = null;
const removingCards = new Set(); // Card IDs mid-removal animation
const staleCards = new Map(); // hunkId → { hunkId, firestoreId, origText, newText, type, onRetry, onDismiss }

function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Generate a consistent color from a string (email) for avatar backgrounds
function avatarColor(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) hash = str.charCodeAt(i) + ((hash << 5) - hash);
  const colors = ['#e74c3c','#3498db','#2ecc71','#9b59b6','#e67e22','#1abc9c','#f39c12','#8e44ad','#2980b9','#c0392b'];
  return colors[Math.abs(hash) % colors.length];
}

function renderAvatar(name, email, photoURL, small) {
  if (photoURL) {
    return '<img src="' + escapeHtml(photoURL) + '" alt="" class="margin-card-avatar' + (small ? ' margin-card-avatar--small' : '') + '" referrerpolicy="no-referrer">';
  }
  const initial = (name || '?')[0].toUpperCase();
  const color = avatarColor(email || name || '?');
  const cls = 'margin-card-avatar margin-card-avatar--initials' + (small ? ' margin-card-avatar--small' : '');
  return '<span class="' + cls + '" style="background:' + color + '">' + escapeHtml(initial) + '</span>';
}

// Highlight @mentions in text — wraps @Name in a styled span
// Only highlights patterns that match known mentioned user display names
function highlightMentions(text, mentionedUsers) {
  if (!mentionedUsers || mentionedUsers.length === 0) return escapeHtml(text);
  let html = escapeHtml(text);
  // Replace any @word pattern with mention styling (conservative — mentioned users exist)
  html = html.replace(/@([\w][\w\s]*[\w]|[\w]+)/g, function(match) {
    return '<span class="mention">' + match + '</span>';
  });
  return html;
}

function truncate(str, len) {
  if (str.length <= len) return str;
  return str.substring(0, len) + '...';
}

function timeAgo(date) {
  if (!date) return '';
  const now = Date.now();
  const diff = now - date.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return mins + ' min ago';
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return hrs + 'h ago';
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export function initMarginPanel(el, view, user, callbacks) {
  marginEl = el;
  editorView = view;
  userData = user;
  onAcceptHunk = callbacks && callbacks.onAccept;
  onRejectHunk = callbacks && callbacks.onReject;
  onResolveComment = callbacks && callbacks.onResolveComment;
  onPostReply = callbacks && callbacks.onPostReply;
  onDismissStale = callbacks && callbacks.onDismissStale;
}

export function updateReplies(replies) {
  currentReplies = replies || [];
  renderAllCards();
}

export function removeRepliesForParent(parentId) {
  currentReplies = currentReplies.filter(r => r.parentId !== parentId);
}

export function updateCommentCards(comments) {
  console.log('[MARGIN] updateCommentCards called with', (comments || []).length, 'comments');
  currentComments = comments || [];
  if (!isHistoryMode) renderAllCards();
}

export function updateMarginCards(hunks) {
  if (!marginEl || !editorView) return;
  console.log('[MARGIN] updateMarginCards called with', hunks.length, 'hunks');
  currentHunks = hunks;
  if (!isHistoryMode) renderAllCards();
}

function buildThreadHtml(parentId, parentType) {
  var replies = currentReplies.filter(function(r) { return r.parentId === parentId; });
  var hasEditAccess = userData && (userData.editRole === 'admin' || userData.editRole === 'manuscript-owner' || userData.editRole === 'comment-suggest');

  if (replies.length === 0 && !hasEditAccess) return '';

  var html = '<div class="margin-card-thread">';

  for (var i = 0; i < replies.length; i++) {
    var r = replies[i];
    var rName = r.authorName || r.authorEmail || 'Unknown';
    var rInitial = rName[0].toUpperCase();
    var rTime = r.createdAt ? (r.createdAt._seconds ? new Date(r.createdAt._seconds * 1000) : new Date(r.createdAt)) : new Date();
    var isReplyAuthor = userData && userData.email === r.authorEmail;
    var editReplyBtn = isReplyAuthor
      ? '<button class="margin-reply-edit-btn" data-action="edit-reply" data-reply-id="' + r.id + '" title="Edit">'
        + '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>'
        + '</button>'
      : '';
    html += '<div class="margin-card-reply">'
      + renderAvatar(rName, r.authorEmail, r.photoURL || r.authorPhotoURL || null, true)
      + '<div class="margin-card-reply-content">'
      + '<span class="margin-card-reply-author">' + escapeHtml(rName) + '</span>'
      + '<span class="margin-card-reply-time">' + timeAgo(rTime) + '</span>'
      + editReplyBtn
      + '<div class="margin-card-reply-text" data-reply-id="' + r.id + '">' + highlightMentions(r.text, r.mentionedUsers) + (r.editedAt ? ' <span class="margin-card-edited">(edited)</span>' : '') + '</div>'
      + '</div>'
      + '</div>';
  }

  if (hasEditAccess) {
    html += '<div class="margin-card-reply-input">'
      + '<input type="text" class="margin-reply-field" data-parent-id="' + parentId + '" data-parent-type="' + parentType + '" placeholder="Reply...">'
      + '<button class="margin-reply-send" data-parent-id="' + parentId + '" data-parent-type="' + parentType + '" title="Send">'
      + '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"></line><polygon points="22 2 15 22 11 13 2 9 22 2"></polygon></svg>'
      + '</button>'
      + '</div>';
  }

  html += '</div>';
  return html;
}

function renderAllCards() {
  if (!marginEl || !editorView) return;
  console.log('[MARGIN] renderAllCards: currentHunks=' + currentHunks.length + ', currentComments=' + currentComments.length);
  try {

  // Preserve cards that are mid-removal animation
  const preservedCards = [];
  if (removingCards.size > 0) {
    marginEl.querySelectorAll('.margin-card--removing').forEach(function(card) {
      preservedCards.push(card);
    });
  }

  if (currentHunks.length === 0 && currentComments.length === 0 && staleCards.size === 0 && preservedCards.length === 0) {
    marginEl.innerHTML = '<div class="margin-empty">No changes yet</div>';
    return;
  }

  const hunks = currentHunks;

  const canAccept = userData && (userData.editRole === 'admin' || userData.editRole === 'manuscript-owner');
  const userEmail = userData ? userData.email : '';
  const now = new Date();

  // Get suggestion metadata from the annotation registry (live state, not stale page data).
  // Falls back to window.__EDITOR_DATA.pendingSuggestions for initial page load data.
  const registry = (editorView && window.__annotationRegistry) ? editorView.state.field(window.__annotationRegistry) : null;
  const loadedSuggestions = window.__EDITOR_DATA ? (window.__EDITOR_DATA.pendingSuggestions || []) : [];

  // --- Build unified items array with positions, then sort by position ---
  // This ensures interleaved suggestions and comments render in correct order.
  const items = [];
  const editorRect = editorView.dom.getBoundingClientRect();

  // Get the document-relative top position for a character position.
  // lineBlockAt gives accurate positions even for lines outside the viewport
  // (unlike coordsAtPos which returns null for virtualized content, and
  // lineNumber × defaultLineHeight which underestimates by ~3x due to
  // varying heading sizes and paragraph spacing).
  function estimateTop(pos) {
    try {
      const block = editorView.lineBlockAt(pos);
      if (block) return block.top;
    } catch { /* ignore */ }
    try {
      const line = editorView.state.doc.lineAt(pos);
      return (line.number - 1) * editorView.defaultLineHeight;
    } catch { return 0; }
  }

  for (const hunk of hunks) {
    const pos = hunk.type === 'deletion' ? (hunk.currentPos || 0) : (hunk.currentFrom || 0);
    const top = estimateTop(pos);
    items.push({ kind: 'suggestion', data: hunk, top, pos });
  }

  const doc = editorView.state.doc.toString();
  for (const c of currentComments) {
    let top = 0;
    let cPos = -1;
    if (c.resolvedFrom != null && !c.resolvedStale) cPos = c.resolvedFrom;
    else if (c.currentFrom != null) cPos = c.currentFrom;
    else cPos = doc.indexOf(c.selectedText);
    if (cPos >= 0) top = estimateTop(cPos);
    items.push({ kind: 'comment', data: c, top, pos: cPos >= 0 ? cPos : 0 });
  }

  // Sort by document position so cards render in correct order
  items.sort((a, b) => a.pos - b.pos);

  // Merge linked hunks (e.g., bold/italic formatting that produces 2 insertion hunks).
  // Keep the first item, hide the second, and store the linked IDs for atomic accept/reject.
  // Also check pending format groups for DRAFT hunks that haven't been auto-saved yet.
  const pendingFmtGroups = getPendingFormatGroups();
  const linkedGroups = new Map(); // groupId → [item, item, ...]
  for (const item of items) {
    if (item.kind !== 'suggestion') continue;
    // 1. Check registry annotation (has linkedGroup after auto-save promotion)
    // 2. Check loaded Firestore data by ID
    // 3. Check pending format groups for draft hunks (not yet saved)
    let groupId = item.data.linkedGroup
      || loadedSuggestions.find(s => s.id === item.data.id)?.linkedGroup;
    let label = item.data.linkedLabel
      || loadedSuggestions.find(s => s.id === item.data.id)?.linkedLabel || '';
    if (!groupId && item.data.type === 'insertion' && pendingFmtGroups.length > 0) {
      const hPos = item.data.originalFrom != null ? item.data.originalFrom : item.pos;
      for (const fg of pendingFmtGroups) {
        if (item.data.newText !== fg.marker) continue;
        if (hPos >= fg.origFrom - 2 && hPos <= fg.origFrom + fg.textLen + 2) {
          groupId = fg.groupId;
          label = fg.label;
          break;
        }
      }
    }
    if (groupId) {
      if (!linkedGroups.has(groupId)) linkedGroups.set(groupId, []);
      linkedGroups.get(groupId).push(item);
      item._linkedGroup = groupId;
      item._linkedLabel = label;
    }
  }
  // Mark secondary items in each group as hidden
  for (const [, groupItems] of linkedGroups) {
    if (groupItems.length > 1) {
      // First item becomes the visible card; store all IDs for atomic operations
      groupItems[0]._linkedIds = groupItems.map(gi => gi.data.id);
      for (let i = 1; i < groupItems.length; i++) {
        groupItems[i]._linkedHidden = true;
      }
    }
  }

  let html = '';
  for (const item of items) {
    // Skip secondary items in a linked group (merged into the first card)
    if (item._linkedHidden) continue;
    // Skip suggestions that have a stale card (rendered separately below)
    if (item.kind === 'suggestion' && staleCards.has(item.data.id)) continue;

    if (item.kind === 'suggestion') {
      const hunk = item.data;
      const top = item.top;

      let bodyHtml = '';
      // Linked formatting group: show the label instead of raw marker text
      if (item._linkedLabel) {
        bodyHtml = '<span class="margin-card-ins">' + escapeHtml(item._linkedLabel) + '</span>';
      } else if (hunk.type === 'deletion') {
        bodyHtml = '<span class="margin-card-del">' + escapeHtml(truncate(hunk.originalText, 80)) + '</span>';
      } else if (hunk.type === 'insertion') {
        bodyHtml = '<span class="margin-card-ins">' + escapeHtml(truncate(hunk.newText, 80)) + '</span>';
      } else if (hunk.type === 'replacement') {
        bodyHtml = '<span class="margin-card-del">' + escapeHtml(truncate(hunk.originalText, 40)) + '</span>'
          + ' <span class="margin-card-arrow">&rarr;</span> '
          + '<span class="margin-card-ins">' + escapeHtml(truncate(hunk.newText, 40)) + '</span>';
      }

      // Look up author info: prefer registry (live), fall back to page data by exact ID only.
      // Content-based matching (originalText/newText) is too loose — it can match a DIFFERENT
      // user's suggestion on the same word, causing draft cards to flash the wrong author name.
      var regEntry = registry ? registry.get(hunk.id) : null;
      var loaded = regEntry || loadedSuggestions.find(function(s) { return s.id === hunk.id; });
      var authorName = loaded ? (loaded.authorName || loaded.authorEmail || (userData ? (userData.displayName || userData.email) : 'Unknown')) : (userData ? (userData.displayName || userData.email) : 'Unknown');
      var isAuthor = loaded ? (loaded.authorEmail === userEmail) : true;
      var hunkTime = loaded && loaded.createdAt ? new Date(loaded.createdAt._seconds ? loaded.createdAt._seconds * 1000 : loaded.createdAt) : now;
      var authorEmailStr = loaded ? (loaded.authorEmail || '') : (userData ? userData.email : '');
      var authorPhotoURL = loaded ? (loaded.photoURL || loaded.authorPhotoURL || null) : (userData ? userData.photoURL : null);
      var avatarHtml = renderAvatar(authorName, authorEmailStr, authorPhotoURL, false);

      var firestoreId = loaded ? loaded.id : null;
      var directEditLock = window.__directEditLockUser || null;
      var actionsHtml = '';
      if (!firestoreId) {
        // Draft not yet saved to Firestore — show saving indicator instead of buttons
        actionsHtml = '<span class="margin-card-saving"><span class="margin-card-spinner"></span> Saving\u2026</span>';
      } else {
        if (canAccept) {
          if (directEditLock) {
            actionsHtml += '<button class="margin-action margin-action--accept margin-action--locked" data-action="accept" data-hunk-id="' + hunk.id + '" title="' + escapeHtml(directEditLock) + ' is directly editing this file" disabled>'
              + '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>'
              + '</button>';
          } else {
            actionsHtml += '<button class="margin-action margin-action--accept" data-action="accept" data-hunk-id="' + hunk.id + '" title="Accept">'
              + '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>'
              + '</button>';
          }
        }
        if (isAuthor || canAccept) {
          actionsHtml += '<button class="margin-action margin-action--reject" data-action="reject" data-hunk-id="' + hunk.id + '" title="' + (isAuthor ? 'Discard' : 'Reject') + '">'
            + '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>'
            + '</button>';
        }
      }
      var threadHtml = buildThreadHtml(firestoreId || hunk.id, 'suggestion');

      var linkedIdsAttr = item._linkedIds ? ' data-linked-ids="' + item._linkedIds.join(',') + '"' : '';
      html += '<div class="margin-card margin-card--suggestion" data-hunk-id="' + hunk.id + '"' + linkedIdsAttr + ' style="top:' + top + 'px">'
        + '<div class="margin-card-header">'
        + '<div class="margin-card-user">'
        + avatarHtml
        + '<span class="margin-card-name">' + escapeHtml(authorName) + '</span>'
        + '</div>'
        + '<div class="margin-card-actions">' + actionsHtml + '</div>'
        + '</div>'
        + '<div class="margin-card-body">' + bodyHtml + '</div>'
        + threadHtml
        + '<div class="margin-card-time">' + timeAgo(hunkTime) + '</div>'
        + '</div>';

    } else {
      // Comment card
      const c = item.data;
      const top = item.top;

      var cAuthorName = c.authorName || c.authorEmail || 'Unknown';
      var cInitial = cAuthorName[0].toUpperCase();
      var cTime = c.createdAt ? (c.createdAt._seconds ? new Date(c.createdAt._seconds * 1000) : new Date(c.createdAt)) : new Date();
      var canResolve = userData && (userData.editRole === 'admin' || userData.editRole === 'manuscript-owner' || userData.email === c.authorEmail);

      var isCommentAuthor = userData && userData.email === c.authorEmail;
      var cActionsHtml = '';
      if (isCommentAuthor) {
        cActionsHtml += '<button class="margin-action margin-action--edit" data-action="edit-comment" data-comment-id="' + c.id + '" title="Edit">'
          + '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>'
          + '</button>';
      }
      if (canResolve) {
        cActionsHtml += '<button class="margin-action margin-action--resolve" data-action="resolve-comment" data-comment-id="' + c.id + '" title="Resolve">'
          + '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>'
          + '</button>';
      }

      var cThreadHtml = buildThreadHtml(c.id || ('comment-' + Math.random()), 'comment');

      html += '<div class="margin-card margin-card--comment" data-comment-id="' + c.id + '" style="top:' + top + 'px">'
        + '<div class="margin-card-header">'
        + '<div class="margin-card-user">'
        + renderAvatar(cAuthorName, c.authorEmail, c.photoURL || c.authorPhotoURL || null, false)
        + '<span class="margin-card-name">' + escapeHtml(cAuthorName) + '</span>'
        + '</div>'
        + '<div class="margin-card-actions">' + cActionsHtml + '</div>'
        + '</div>'
        + '<div class="margin-card-body">'
        + '<span class="margin-card-quote">"' + escapeHtml(truncate(c.selectedText, 60)) + '"</span>'
        + '<p class="margin-card-comment-text" data-comment-id="' + c.id + '">' + highlightMentions(c.commentText, c.mentionedUsers) + (c.editedAt ? ' <span class="margin-card-edited">(edited)</span>' : '') + '</p>'
        + '</div>'
        + cThreadHtml
        + '<div class="margin-card-time">' + timeAgo(cTime) + '</div>'
        + '</div>';
    }
  }

  // Render stale accept cards (from 409 conflicts) at the top of the panel
  for (const [hunkId, sd] of staleCards) {
    var suggHtml = '';
    if (sd.type === 'deletion') {
      suggHtml = '<span class="margin-card-del">' + escapeHtml(truncate(sd.origText, 60)) + '</span>';
    } else if (sd.type === 'insertion') {
      suggHtml = '<span class="margin-card-ins">' + escapeHtml(truncate(sd.newText, 60)) + '</span>';
    } else if (sd.origText || sd.newText) {
      suggHtml = '<span class="margin-card-del">' + escapeHtml(truncate(sd.origText, 40)) + '</span>'
        + ' <span class="margin-card-arrow">&rarr;</span> '
        + '<span class="margin-card-ins">' + escapeHtml(truncate(sd.newText, 40)) + '</span>';
    }
    var retryBtnHtml = sd.onRetry
      ? '<button class="edit-btn edit-btn--primary" data-action="retry-stale" data-hunk-id="' + hunkId + '">Try again</button>'
      : '';
    html = '<div class="margin-card margin-card--suggestion margin-card--stale" data-hunk-id="' + hunkId + '" style="top:0px">'
      + '<div class="margin-card-body">'
      + '<div class="margin-card-status margin-card-status--stale">'
      + (sd.cannotReapply
        ? '\u26A0 Cannot re-apply \u2014 the original text no longer exists.'
        : '\u26A0 The text you suggested an edit to has changed.')
      + '</div>'
      + (suggHtml ? '<div><span class="margin-card-stale-label">Your suggestion was:</span>' + suggHtml + '</div>' : '')
      + '<div class="margin-card-stale-actions">'
      + retryBtnHtml
      + '<button class="edit-btn" data-action="dismiss-stale" data-hunk-id="' + hunkId + '">Dismiss</button>'
      + '</div></div></div>'
      + html;
  }

  const cardCount = (html.match(/margin-card margin-card--suggestion/g) || []).length;
  const commentCardCount = (html.match(/margin-card margin-card--comment/g) || []).length;
  console.log('[MARGIN] rendered HTML has', cardCount, 'suggestion cards +', commentCardCount, 'comment cards');
  marginEl.innerHTML = html;

  // Re-append cards that are mid-removal animation
  preservedCards.forEach(function(card) { marginEl.appendChild(card); });

  // Bind action buttons (suggestions)
  marginEl.querySelectorAll('[data-action]').forEach(function (btn) {
    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      var action = btn.getAttribute('data-action');
      if (action === 'accept') {
        var hunkId = btn.getAttribute('data-hunk-id');
        if (onAcceptHunk) onAcceptHunk(hunkId);
      } else if (action === 'reject') {
        var hunkId = btn.getAttribute('data-hunk-id');
        if (onRejectHunk) onRejectHunk(hunkId);
      } else if (action === 'resolve-comment') {
        var commentId = btn.getAttribute('data-comment-id');
        if (onResolveComment) onResolveComment(commentId);
      } else if (action === 'edit-comment') {
        var commentId = btn.getAttribute('data-comment-id');
        startEditComment(commentId);
      } else if (action === 'edit-reply') {
        var replyId = btn.getAttribute('data-reply-id');
        startEditReply(replyId);
      } else if (action === 'dismiss-stale') {
        var hunkId = btn.getAttribute('data-hunk-id');
        var sd = staleCards.get(hunkId);
        if (sd && sd.onDismiss) sd.onDismiss(hunkId);
        staleCards.delete(hunkId);
      } else if (action === 'retry-stale') {
        var hunkId = btn.getAttribute('data-hunk-id');
        var sd = staleCards.get(hunkId);
        if (sd && sd.onRetry) sd.onRetry(hunkId, sd);
      }
    });
  });

  // Bind reply send buttons
  marginEl.querySelectorAll('.margin-reply-send').forEach(function(btn) {
    btn.addEventListener('click', function(e) {
      e.stopPropagation();
      var parentId = btn.getAttribute('data-parent-id');
      var parentType = btn.getAttribute('data-parent-type');
      var input = btn.previousElementSibling;
      var text = input ? input.value.trim() : '';
      if (!text || !onPostReply) return;
      btn.disabled = true;
      var mentions = getPendingMentions();
      clearPendingMentions();
      onPostReply(parentId, parentType, text, mentions).then(function(reply) {
        currentReplies.push(reply);
        renderAllCards();
      }).catch(function() {
        btn.disabled = false;
      });
    });
  });

  // Bind reply input Enter key + @-mention autocomplete
  marginEl.querySelectorAll('.margin-reply-field').forEach(function(input) {
    attachMentionToElement(input);
    input.addEventListener('keydown', function(e) {
      // Don't submit if Tribute dropdown is open
      if (document.querySelector('.tribute-container:not([style*="display: none"])')) return;
      if (e.key === 'Enter') {
        e.preventDefault();
        var sendBtn = input.nextElementSibling;
        if (sendBtn) sendBtn.click();
      }
    });
  });

  // Click card → scroll editor to inline text + pulse
  marginEl.querySelectorAll('.margin-card').forEach(function(card) {
    card.addEventListener('click', function(e) {
      // Don't trigger if clicking a button, input, or link inside the card
      if (e.target.closest('button, input, textarea, a')) return;
      if (!editorView) return;
      var hunkId = card.getAttribute('data-hunk-id');
      var commentId = card.getAttribute('data-comment-id');
      var id = hunkId || commentId;

      // Use the registry position to scroll CM6 — DOM elements may not exist
      // for content outside the virtualized viewport
      var registry = window.__annotationRegistry ? editorView.state.field(window.__annotationRegistry) : null;
      var entry = registry ? registry.get(id) : null;
      if (entry && entry.currentFrom != null) {
        editorView.dispatch({ effects: [], selection: { anchor: entry.currentFrom }, scrollIntoView: true });
        // After CM6 scrolls, the inline element should now be rendered
        setTimeout(function() {
          var target = null;
          if (hunkId) target = editorView.dom.querySelector('[data-hunk-id="' + hunkId + '"]');
          if (commentId) target = editorView.dom.querySelector('[data-comment-id="' + commentId + '"]');
          if (target) {
            target.classList.add('cm-inline-pulse');
            setTimeout(function() { target.classList.remove('cm-inline-pulse'); }, 700);
          }
        }, 100);
      } else {
        // Fallback: try DOM search directly (for draft hunks not in registry)
        var target = null;
        if (hunkId) target = editorView.dom.querySelector('[data-hunk-id="' + hunkId + '"]');
        if (commentId) target = editorView.dom.querySelector('[data-comment-id="' + commentId + '"]');
        if (target) {
          target.scrollIntoView({ behavior: 'smooth', block: 'center' });
          target.classList.add('cm-inline-pulse');
          setTimeout(function() { target.classList.remove('cm-inline-pulse'); }, 700);
        }
      }
    });
    card.style.cursor = 'pointer';
  });

  // Resolve overlapping cards
  resolveOverlaps();
  } catch (err) {
    console.error('[MARGIN] renderAllCards ERROR:', err.message, err.stack);
  }
}

// --- Inline editing for comments ---
function startEditComment(commentId) {
  var textEl = marginEl.querySelector('.margin-card-comment-text[data-comment-id="' + commentId + '"]');
  if (!textEl) return;
  var comment = currentComments.find(function(c) { return c.id === commentId; });
  if (!comment) return;
  var card = textEl.closest('.margin-card');
  if (!card) return;

  // Replace text paragraph with textarea + buttons
  var currentText = comment.commentText;
  var editContainer = document.createElement('div');
  editContainer.className = 'margin-card-edit-container';
  editContainer.innerHTML = '<textarea class="margin-card-edit-textarea" rows="3">' + escapeHtml(currentText) + '</textarea>'
    + '<div class="margin-card-edit-actions">'
    + '<button class="margin-card-edit-save" data-comment-id="' + commentId + '">Save</button>'
    + '<button class="margin-card-edit-cancel">Cancel</button>'
    + '</div>';
  textEl.replaceWith(editContainer);

  var textarea = editContainer.querySelector('textarea');
  textarea.focus();
  textarea.setSelectionRange(textarea.value.length, textarea.value.length);

  editContainer.querySelector('.margin-card-edit-cancel').addEventListener('click', function(e) {
    e.stopPropagation();
    renderAllCards();
  });

  editContainer.querySelector('.margin-card-edit-save').addEventListener('click', function(e) {
    e.stopPropagation();
    var newText = textarea.value.trim();
    if (!newText || newText === currentText) { renderAllCards(); return; }
    var saveBtn = editContainer.querySelector('.margin-card-edit-save');
    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving...';
    fetch('/api/suggestions/comments/' + commentId, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ commentText: newText }),
    }).then(function(res) {
      if (!res.ok) throw new Error('Failed to save');
      comment.commentText = newText;
      comment.editedAt = { _seconds: Date.now() / 1000 };
      renderAllCards();
    }).catch(function(err) {
      window.showToast && window.showToast('Error saving comment: ' + err.message, 'error');
      saveBtn.disabled = false;
      saveBtn.textContent = 'Save';
    });
  });
}

// --- Inline editing for replies ---
function startEditReply(replyId) {
  var textEl = marginEl.querySelector('.margin-card-reply-text[data-reply-id="' + replyId + '"]');
  if (!textEl) return;
  var reply = currentReplies.find(function(r) { return r.id === replyId; });
  if (!reply) return;

  var currentText = reply.text;
  var editContainer = document.createElement('div');
  editContainer.className = 'margin-card-edit-container margin-card-edit-container--reply';
  editContainer.innerHTML = '<input type="text" class="margin-card-edit-input" value="' + escapeHtml(currentText) + '">'
    + '<div class="margin-card-edit-actions">'
    + '<button class="margin-card-edit-save" data-reply-id="' + replyId + '">Save</button>'
    + '<button class="margin-card-edit-cancel">Cancel</button>'
    + '</div>';
  textEl.replaceWith(editContainer);

  var input = editContainer.querySelector('input');
  input.focus();
  input.setSelectionRange(input.value.length, input.value.length);

  editContainer.querySelector('.margin-card-edit-cancel').addEventListener('click', function(e) {
    e.stopPropagation();
    renderAllCards();
  });

  editContainer.querySelector('.margin-card-edit-save').addEventListener('click', function(e) {
    e.stopPropagation();
    var newText = input.value.trim();
    if (!newText || newText === currentText) { renderAllCards(); return; }
    var saveBtn = editContainer.querySelector('.margin-card-edit-save');
    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving...';
    fetch('/api/suggestions/replies/' + replyId, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: newText }),
    }).then(function(res) {
      if (!res.ok) throw new Error('Failed to save');
      reply.text = newText;
      reply.editedAt = { _seconds: Date.now() / 1000 };
      renderAllCards();
    }).catch(function(err) {
      window.showToast && window.showToast('Error saving reply: ' + err.message, 'error');
      saveBtn.disabled = false;
      saveBtn.textContent = 'Save';
    });
  });

  // Enter key saves
  input.addEventListener('keydown', function(e) {
    if (e.key === 'Enter') {
      e.preventDefault();
      editContainer.querySelector('.margin-card-edit-save').click();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      renderAllCards();
    }
  });
}

function resolveOverlaps() {
  const cards = marginEl.querySelectorAll('.margin-card');
  let lastBottom = 0;
  const GAP = 6;

  cards.forEach(card => {
    let top = parseFloat(card.style.top) || 0;
    if (top < lastBottom + GAP) {
      top = lastBottom + GAP;
      card.style.top = top + 'px';
    }
    lastBottom = top + card.offsetHeight;
  });
}

// Set a card's status (loading, success, stale, error)
export function setCardStatus(hunkId, status, message) {
  if (!marginEl) return;
  var card = marginEl.querySelector('.margin-card[data-hunk-id="' + hunkId + '"]');
  if (!card) return;

  var body = card.querySelector('.margin-card-body');
  var thread = card.querySelector('.margin-card-thread');
  var time = card.querySelector('.margin-card-time');
  var actions = card.querySelector('.margin-card-actions');

  if (actions) actions.style.display = 'none';
  if (thread) thread.style.display = 'none';
  if (time) time.style.display = 'none';

  if (status === 'loading') {
    body.innerHTML = '<div class="margin-card-status margin-card-status--loading">'
      + '<span class="margin-card-spinner"></span>' + escapeHtml(message) + '</div>';
  } else if (status === 'success') {
    body.innerHTML = '<div class="margin-card-status margin-card-status--success">'
      + '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>'
      + escapeHtml(message) + '</div>';
    card.classList.add('margin-card--success');
  } else if (status === 'stale') {
    // Show what the suggestion was using saved data attributes
    var origText = card.dataset.origText || '';
    var newText = card.dataset.newText || '';
    var hunkType = card.dataset.hunkType || '';
    var suggHtml = '';
    if (hunkType === 'deletion') {
      suggHtml = '<span class="margin-card-del">' + escapeHtml(truncate(origText, 60)) + '</span>';
    } else if (hunkType === 'insertion') {
      suggHtml = '<span class="margin-card-ins">' + escapeHtml(truncate(newText, 60)) + '</span>';
    } else if (origText || newText) {
      suggHtml = '<span class="margin-card-del">' + escapeHtml(truncate(origText, 40)) + '</span>'
        + ' <span class="margin-card-arrow">&rarr;</span> '
        + '<span class="margin-card-ins">' + escapeHtml(truncate(newText, 40)) + '</span>';
    }
    body.innerHTML = '<div class="margin-card-status margin-card-status--stale">'
      + '\u26A0 The text you suggested an edit to has changed.</div>'
      + (suggHtml ? '<div><span class="margin-card-stale-label">Your suggestion was:</span>' + suggHtml + '</div>' : '')
      + '<div class="margin-card-stale-actions">'
      + '<button class="edit-btn" data-action="dismiss-stale" data-hunk-id="' + hunkId + '">Dismiss</button>'
      + '</div>';
    card.classList.add('margin-card--stale');
    // Bind dismiss button
    var dismissBtn = card.querySelector('[data-action="dismiss-stale"]');
    if (dismissBtn && onDismissStale) {
      dismissBtn.addEventListener('click', function(e) { e.stopPropagation(); onDismissStale(hunkId); });
    }
  } else if (status === 'error') {
    body.innerHTML = '<div class="margin-card-status margin-card-status--error">'
      + escapeHtml(message) + '</div>';
    if (actions) actions.style.display = '';
  }
}

// Disable all accept/reject buttons across all cards
export function disableAllCardActions() {
  if (!marginEl) return;
  marginEl.querySelectorAll('.margin-action--accept, .margin-action--reject').forEach(function(btn) {
    btn.disabled = true;
  });
}

// Re-enable all accept/reject buttons
export function enableAllCardActions() {
  if (!marginEl) return;
  marginEl.querySelectorAll('.margin-action--accept, .margin-action--reject').forEach(function(btn) {
    btn.disabled = false;
  });
}

// Animate a card removal — slides out, then removes from DOM
export function animateCardRemoval(selector) {
  if (!marginEl) return;
  var card = marginEl.querySelector(selector);
  if (!card) return;
  var cardId = selector;
  removingCards.add(cardId);
  card.classList.add('margin-card--removing');
  setTimeout(function() {
    removingCards.delete(cardId);
    if (card.parentNode) card.remove();
  }, 400);
}

// Focus a margin card — scroll into view + pulse animation
export function focusMarginCard(type, id) {
  if (!marginEl) return;
  var selector = type === 'comment'
    ? '.margin-card[data-comment-id="' + id + '"]'
    : '.margin-card[data-hunk-id="' + id + '"]';
  var card = marginEl.querySelector(selector);
  if (!card) return;

  // Scroll into view within the margin panel
  card.scrollIntoView({ behavior: 'smooth', block: 'center' });

  // Pulse animation
  card.classList.remove('margin-card--focused');
  // Force reflow so re-adding triggers the animation
  void card.offsetWidth;
  card.classList.add('margin-card--focused');
  setTimeout(function() { card.classList.remove('margin-card--focused'); }, 700);
}

// Add a stale card to the rendering pipeline (replaces DOM injection)
export function addStaleCard(hunkId, staleData, onDismiss, onRetry) {
  staleCards.set(hunkId, { ...staleData, onDismiss, onRetry });
  renderAllCards();
}

// Remove a stale card from the rendering pipeline
export function removeStaleCard(hunkId) {
  staleCards.delete(hunkId);
}

// Update a stale card in-place and re-render (survives margin rebuilds)
export function updateStaleCard(hunkId, updates) {
  const existing = staleCards.get(hunkId);
  if (existing) {
    Object.assign(existing, updates);
    renderAllCards();
  }
}

// Reposition cards on scroll or resize
let repositionTimer = null;
export function repositionCards() {
  if (isHistoryMode) return; // History cards are static — no repositioning needed
  if (!editorView || !marginEl || (currentHunks.length === 0 && currentComments.length === 0)) return;
  // Debounce reposition to let CM6 finish height recalculations
  clearTimeout(repositionTimer);
  repositionTimer = setTimeout(() => {
    renderAllCards();
  }, 100);
}

// --- History view ---
let isHistoryMode = false;

export function renderHistoryCards(data) {
  if (!marginEl) return;
  isHistoryMode = true;
  const suggestions = data.suggestions || [];
  const comments = data.comments || [];

  if (suggestions.length === 0 && comments.length === 0) {
    marginEl.innerHTML = '<div class="margin-empty">No editing history for this file</div>';
    return;
  }

  // Merge and sort by resolvedAt descending
  const items = [];
  for (const s of suggestions) items.push({ kind: 'suggestion', data: s, resolvedAt: s.resolvedAt });
  for (const c of comments) items.push({ kind: 'comment', data: c, resolvedAt: c.resolvedAt });
  items.sort((a, b) => {
    const ta = a.resolvedAt?._seconds || a.resolvedAt?.seconds || 0;
    const tb = b.resolvedAt?._seconds || b.resolvedAt?.seconds || 0;
    return tb - ta;
  });

  let html = '';
  for (const item of items) {
    if (item.kind === 'suggestion') {
      const s = item.data;
      const statusClass = s.status === 'accepted' ? 'accepted' : s.status === 'rejected' ? 'rejected' : 'stale';
      const statusLabel = s.status === 'accepted' ? 'Accepted' : s.status === 'rejected' ? 'Rejected' : 'Stale';
      const resolvedDate = s.resolvedAt ? new Date((s.resolvedAt._seconds || s.resolvedAt.seconds || 0) * 1000) : null;

      let bodyHtml = '';
      if (s.type === 'deletion') {
        bodyHtml = '<span class="margin-card-del">' + escapeHtml(truncate(s.originalText, 80)) + '</span>';
      } else if (s.type === 'insertion') {
        bodyHtml = '<span class="margin-card-ins">' + escapeHtml(truncate(s.newText, 80)) + '</span>';
      } else {
        bodyHtml = '<span class="margin-card-del">' + escapeHtml(truncate(s.originalText, 40)) + '</span>'
          + ' <span class="margin-card-arrow">&rarr;</span> '
          + '<span class="margin-card-ins">' + escapeHtml(truncate(s.newText, 40)) + '</span>';
      }

      const locationHtml = buildLocationHtml(s.resolvedLineNumber, s.resolvedHeading);
      const threadHtml = buildHistoryThreadHtml(s.replies || []);

      html += '<div class="margin-card margin-card--history">'
        + '<div class="margin-card-header">'
        + '<div class="margin-card-user">'
        + renderAvatar(s.authorName || s.authorEmail, s.authorEmail, null, false)
        + '<span class="margin-card-name">' + escapeHtml(s.authorName || s.authorEmail || 'Unknown') + '</span>'
        + '</div>'
        + '<span class="margin-card-status-badge margin-card-status-badge--' + statusClass + '">' + statusLabel + '</span>'
        + '</div>'
        + '<div class="margin-card-body">' + bodyHtml + '</div>'
        + (s.rejectionReason ? '<div class="margin-card-reject-reason">Reason: ' + escapeHtml(s.rejectionReason) + '</div>' : '')
        + locationHtml
        + threadHtml
        + '<div class="margin-card-time">'
        + (resolvedDate ? timeAgo(resolvedDate) : '')
        + (s.resolvedBy ? ' by ' + escapeHtml(s.resolvedBy) : '')
        + '</div>'
        + '</div>';

    } else {
      const c = item.data;
      const resolvedDate = c.resolvedAt ? new Date((c.resolvedAt._seconds || c.resolvedAt.seconds || 0) * 1000) : null;
      const locationHtml = buildLocationHtml(c.resolvedLineNumber, c.resolvedHeading);
      const threadHtml = buildHistoryThreadHtml(c.replies || []);

      html += '<div class="margin-card margin-card--history">'
        + '<div class="margin-card-header">'
        + '<div class="margin-card-user">'
        + renderAvatar(c.authorName || c.authorEmail, c.authorEmail, null, false)
        + '<span class="margin-card-name">' + escapeHtml(c.authorName || c.authorEmail || 'Unknown') + '</span>'
        + '</div>'
        + '<span class="margin-card-status-badge margin-card-status-badge--resolved">Resolved</span>'
        + '</div>'
        + '<div class="margin-card-body">'
        + '<span class="margin-card-quote">"' + escapeHtml(truncate(c.selectedText, 60)) + '"</span>'
        + '<p class="margin-card-comment-text">' + escapeHtml(c.commentText) + '</p>'
        + '</div>'
        + locationHtml
        + threadHtml
        + '<div class="margin-card-time">'
        + (resolvedDate ? timeAgo(resolvedDate) : '')
        + (c.resolvedBy ? ' by ' + escapeHtml(c.resolvedBy) : '')
        + '</div>'
        + '</div>';
    }
  }

  marginEl.innerHTML = html;
}

function buildLocationHtml(lineNumber, heading) {
  if (!lineNumber && !heading) return '';
  const parts = [];
  if (lineNumber) parts.push('Line ' + lineNumber);
  if (heading) parts.push(escapeHtml(heading));
  return '<div class="margin-card-location">' + parts.join(' &middot; ') + '</div>';
}

function buildHistoryThreadHtml(replies) {
  if (!replies || replies.length === 0) return '';
  var html = '<div class="margin-card-thread">';
  for (var i = 0; i < replies.length; i++) {
    var r = replies[i];
    var rName = r.authorName || r.authorEmail || 'Unknown';
    var rTime = r.createdAt ? (r.createdAt._seconds ? new Date(r.createdAt._seconds * 1000) : new Date(r.createdAt)) : new Date();
    html += '<div class="margin-card-reply">'
      + renderAvatar(rName, r.authorEmail, r.authorPhotoURL || null, true)
      + '<div class="margin-card-reply-content">'
      + '<span class="margin-card-reply-author">' + escapeHtml(rName) + '</span>'
      + '<span class="margin-card-reply-time">' + timeAgo(rTime) + '</span>'
      + '<div class="margin-card-reply-text">' + escapeHtml(r.text) + '</div>'
      + '</div>'
      + '</div>';
  }
  html += '</div>';
  return html;
}

export function clearHistoryCards() {
  isHistoryMode = false;
  renderAllCards();
}
