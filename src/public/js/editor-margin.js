// Noble Imprint — Margin Panel for Suggestions and Comments
// Shows cards alongside the editor, positioned to align with document text.

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

function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
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
}

export function updateReplies(replies) {
  currentReplies = replies || [];
  renderAllCards();
}

export function removeRepliesForParent(parentId) {
  currentReplies = currentReplies.filter(r => r.parentId !== parentId);
}

export function updateCommentCards(comments) {
  currentComments = comments || [];
  renderAllCards();
}

export function updateMarginCards(hunks) {
  if (!marginEl || !editorView) return;
  currentHunks = hunks;
  renderAllCards();
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
    html += '<div class="margin-card-reply">'
      + '<span class="margin-card-avatar margin-card-avatar--initials margin-card-avatar--small">' + escapeHtml(rInitial) + '</span>'
      + '<div class="margin-card-reply-content">'
      + '<span class="margin-card-reply-author">' + escapeHtml(rName) + '</span>'
      + '<span class="margin-card-reply-time">' + timeAgo(rTime) + '</span>'
      + '<div class="margin-card-reply-text">' + escapeHtml(r.text) + '</div>'
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

  if (currentHunks.length === 0 && currentComments.length === 0) {
    marginEl.innerHTML = '<div class="margin-empty">No changes yet</div>';
    return;
  }

  const hunks = currentHunks;

  const canAccept = userData && (userData.editRole === 'admin' || userData.editRole === 'manuscript-owner');
  const userEmail = userData ? userData.email : '';
  const now = new Date();

  // Check if we have loaded suggestions from Firestore (for author info)
  const loadedSuggestions = window.__EDITOR_DATA ? (window.__EDITOR_DATA.pendingSuggestions || []) : [];

  let html = '';
  for (const hunk of hunks) {
    // Get vertical position from the editor
    let top = 0;
    try {
      const pos = hunk.type === 'deletion' ? hunk.currentPos : hunk.currentFrom;
      const coords = editorView.coordsAtPos(pos);
      if (coords) {
        const editorRect = editorView.dom.getBoundingClientRect();
        top = coords.top - editorRect.top;
      }
    } catch { /* ignore */ }

    // Change summary
    let bodyHtml = '';
    if (hunk.type === 'deletion') {
      bodyHtml = '<span class="margin-card-del">' + escapeHtml(truncate(hunk.originalText, 80)) + '</span>';
    } else if (hunk.type === 'insertion') {
      bodyHtml = '<span class="margin-card-ins">' + escapeHtml(truncate(hunk.newText, 80)) + '</span>';
    } else if (hunk.type === 'replacement') {
      bodyHtml = '<span class="margin-card-del">' + escapeHtml(truncate(hunk.originalText, 40)) + '</span>'
        + ' <span class="margin-card-arrow">&rarr;</span> '
        + '<span class="margin-card-ins">' + escapeHtml(truncate(hunk.newText, 40)) + '</span>';
    }

    // Find author info — match loaded suggestions by content, not ID
    var loaded = loadedSuggestions.find(function(s) {
      if (s.originalText === hunk.originalText && s.newText === hunk.newText) return true;
      if (s.type === hunk.type && s.originalText === hunk.originalText) return true;
      return s.id === hunk.id;
    });
    var authorName = loaded ? (loaded.authorName || loaded.authorEmail) : (userData ? (userData.displayName || userData.email) : 'Unknown');
    var authorPhoto = loaded ? null : (userData ? userData.photoURL : null);
    var authorInitial = (authorName || '?')[0].toUpperCase();
    var isAuthor = loaded ? (loaded.authorEmail === userEmail) : true;
    var hunkTime = loaded && loaded.createdAt ? new Date(loaded.createdAt._seconds ? loaded.createdAt._seconds * 1000 : loaded.createdAt) : now;

    // Avatar
    var avatarHtml = '';
    if (authorPhoto) {
      avatarHtml = '<img src="' + escapeHtml(authorPhoto) + '" alt="" class="margin-card-avatar" referrerpolicy="no-referrer">';
    } else {
      avatarHtml = '<span class="margin-card-avatar margin-card-avatar--initials">' + escapeHtml(authorInitial) + '</span>';
    }

    // Action buttons
    var actionsHtml = '';
    if (canAccept) {
      actionsHtml += '<button class="margin-action margin-action--accept" data-action="accept" data-hunk-id="' + hunk.id + '" title="Accept">'
        + '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>'
        + '</button>';
    }
    if (isAuthor || canAccept) {
      actionsHtml += '<button class="margin-action margin-action--reject" data-action="reject" data-hunk-id="' + hunk.id + '" title="' + (isAuthor ? 'Discard' : 'Reject') + '">'
        + '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>'
        + '</button>';
    }

    // Thread replies — keyed by Firestore ID of the parent suggestion
    var firestoreId = loaded ? loaded.id : null;
    var threadHtml = firestoreId ? buildThreadHtml(firestoreId, 'suggestion') : '';

    html += '<div class="margin-card margin-card--suggestion" data-hunk-id="' + hunk.id + '" style="top:' + top + 'px">'
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
  }

  // --- Comment cards ---
  for (const c of currentComments) {
    var top = 0;
    try {
      var doc = editorView.state.doc.toString();
      var cPos = doc.indexOf(c.selectedText);
      if (cPos >= 0) {
        var coords = editorView.coordsAtPos(cPos);
        if (coords) {
          var editorRect = editorView.dom.getBoundingClientRect();
          top = coords.top - editorRect.top;
        }
      }
    } catch { /* ignore */ }

    var cAuthorName = c.authorName || c.authorEmail || 'Unknown';
    var cInitial = cAuthorName[0].toUpperCase();
    var cTime = c.createdAt ? (c.createdAt._seconds ? new Date(c.createdAt._seconds * 1000) : new Date(c.createdAt)) : new Date();
    var canResolve = userData && (userData.editRole === 'admin' || userData.editRole === 'manuscript-owner' || userData.email === c.authorEmail);

    var cActionsHtml = '';
    if (canResolve) {
      cActionsHtml = '<button class="margin-action margin-action--resolve" data-action="resolve-comment" data-comment-id="' + c.id + '" title="Resolve">'
        + '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>'
        + '</button>';
    }

    var cThreadHtml = c.id ? buildThreadHtml(c.id, 'comment') : '';

    html += '<div class="margin-card margin-card--comment" data-comment-id="' + c.id + '" style="top:' + top + 'px">'
      + '<div class="margin-card-header">'
      + '<div class="margin-card-user">'
      + '<span class="margin-card-avatar margin-card-avatar--initials">' + escapeHtml(cInitial) + '</span>'
      + '<span class="margin-card-name">' + escapeHtml(cAuthorName) + '</span>'
      + '</div>'
      + '<div class="margin-card-actions">' + cActionsHtml + '</div>'
      + '</div>'
      + '<div class="margin-card-body">'
      + '<span class="margin-card-quote">"' + escapeHtml(truncate(c.selectedText, 60)) + '"</span>'
      + '<p class="margin-card-comment-text">' + escapeHtml(c.commentText) + '</p>'
      + '</div>'
      + cThreadHtml
      + '<div class="margin-card-time">' + timeAgo(cTime) + '</div>'
      + '</div>';
  }

  marginEl.innerHTML = html;

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
      onPostReply(parentId, parentType, text).then(function(reply) {
        currentReplies.push(reply);
        renderAllCards();
      }).catch(function() {
        btn.disabled = false;
      });
    });
  });

  // Bind reply input Enter key
  marginEl.querySelectorAll('.margin-reply-field').forEach(function(input) {
    input.addEventListener('keydown', function(e) {
      if (e.key === 'Enter') {
        e.preventDefault();
        var sendBtn = input.nextElementSibling;
        if (sendBtn) sendBtn.click();
      }
    });
  });

  // Resolve overlapping cards
  resolveOverlaps();
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

// Reposition cards on scroll or resize
export function repositionCards() {
  if (!editorView || !marginEl || currentHunks.length === 0) return;
  updateMarginCards(currentHunks);
}
