// Noble Imprint — Margin Panel for Suggestions and Comments
// Shows cards alongside the editor, positioned to align with document text.

let marginEl = null;
let editorView = null;
let currentHunks = [];
let userData = null; // { email, displayName, photoURL, editRole }
let onAcceptHunk = null;
let onRejectHunk = null;

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
}

export function updateMarginCards(hunks) {
  if (!marginEl || !editorView) return;
  currentHunks = hunks;

  if (hunks.length === 0) {
    marginEl.innerHTML = '<div class="margin-empty">No changes yet</div>';
    return;
  }

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

    // Find author info — for loaded suggestions use their author, for live edits use current user
    var loaded = loadedSuggestions.find(function(s) { return s.id === hunk.id; });
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

    html += '<div class="margin-card margin-card--suggestion" data-hunk-id="' + hunk.id + '" style="top:' + top + 'px">'
      + '<div class="margin-card-header">'
      + '<div class="margin-card-user">'
      + avatarHtml
      + '<span class="margin-card-name">' + escapeHtml(authorName) + '</span>'
      + '</div>'
      + '<div class="margin-card-actions">' + actionsHtml + '</div>'
      + '</div>'
      + '<div class="margin-card-body">' + bodyHtml + '</div>'
      + '<div class="margin-card-time">' + timeAgo(hunkTime) + '</div>'
      + '</div>';
  }

  marginEl.innerHTML = html;

  // Bind action buttons
  marginEl.querySelectorAll('[data-action]').forEach(function (btn) {
    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      var action = btn.getAttribute('data-action');
      var hunkId = btn.getAttribute('data-hunk-id');
      if (action === 'accept' && onAcceptHunk) onAcceptHunk(hunkId);
      if (action === 'reject' && onRejectHunk) onRejectHunk(hunkId);
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

// Reposition cards on scroll or resize
export function repositionCards() {
  if (!editorView || !marginEl || currentHunks.length === 0) return;
  updateMarginCards(currentHunks);
}
