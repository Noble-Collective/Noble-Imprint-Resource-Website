// Noble Imprint — Comment System (v3 — Registry-based)
//
// Comments are tracked in the annotationRegistry StateField (in editor-suggestions.js).
// This file only handles: tooltip UI, popup UI, and submitting to the API.
// Decorations are built by the registry decoration plugin, not here.
import { EditorView, keymap, Tribute } from '/static/js/codemirror-bundle.js';
import { originalDocField } from '/static/js/editor-suggestions.js';

let editorViewRef = null;
let onCommentAdded = null; // callback after new comment saved

// --- @-mention autocomplete ---
let taggableUsers = null; // cached user list for this session
let pendingMentions = new Set(); // emails mentioned in the current comment/reply
let tributeInstance = null;

async function fetchTaggableUsers() {
  if (taggableUsers) return taggableUsers;
  const editorData = window.__EDITOR_DATA;
  if (!editorData || !editorData.bookRepoPath) return [];
  try {
    const res = await fetch('/api/suggestions/taggable-users?bookPath=' + encodeURIComponent(editorData.bookRepoPath));
    if (!res.ok) return [];
    const data = await res.json();
    taggableUsers = data.users || [];
    return taggableUsers;
  } catch { return []; }
}

function createTributeInstance() {
  return new Tribute({
    trigger: '@',
    values: function(text, cb) {
      fetchTaggableUsers().then(function(users) {
        cb(users.filter(function(u) {
          var q = text.toLowerCase();
          return (u.displayName || '').toLowerCase().includes(q) || (u.email || '').toLowerCase().includes(q);
        }));
      });
    },
    lookup: function(item) { return item.displayName + ' ' + item.email; },
    fillAttr: 'displayName',
    selectTemplate: function(item) {
      if (!item || !item.original) return '';
      pendingMentions.add(item.original.email);
      return '@' + item.original.displayName;
    },
    menuItemTemplate: function(item) {
      if (!item || !item.original) return '';
      return '<span>' + item.original.displayName + '</span> <small style="color:#888">' + item.original.email + '</small>';
    },
    noMatchTemplate: function() { return '<li style="padding:4px 8px;color:#999;font-size:11px">No users found</li>'; },
    containerClass: 'tribute-container',
    itemClass: 'tribute-item',
    selectClass: 'tribute-item--active',
    menuShowMinLength: 1,
  });
}

export function attachMentionToElement(el) {
  if (!el) return;
  if (!tributeInstance) tributeInstance = createTributeInstance();
  try { tributeInstance.attach(el); } catch { /* already attached or error */ }
}

export function detachMentionFromElement(el) {
  if (!el || !tributeInstance) return;
  try { tributeInstance.detach(el); } catch { /* ignore */ }
}

export function getPendingMentions() { return [...pendingMentions]; }
export function clearPendingMentions() { pendingMentions = new Set(); }

// --- Bold/Italic toggle: wrap/unwrap selected text ---
// Pending format groups: when bold/italic wraps text, the diff engine produces
// 2 insertion hunks. We tag them with a linkedGroup so auto-save, the margin
// panel, and accept/reject treat them as one atomic change.
let pendingFormatGroups = [];
export function getPendingFormatGroups() { return pendingFormatGroups; }
export function clearPendingFormatGroup(groupId) {
  pendingFormatGroups = pendingFormatGroups.filter(g => g.groupId !== groupId);
}

function toggleFormat(marker) {
  if (!editorViewRef) return;
  const sel = editorViewRef.state.selection.main;
  if (sel.empty) return;
  const selected = editorViewRef.state.sliceDoc(sel.from, sel.to);

  // Check if already wrapped — unwrap if so
  if (selected.startsWith(marker) && selected.endsWith(marker) && selected.length > marker.length * 2) {
    const unwrapped = selected.slice(marker.length, -marker.length);
    editorViewRef.dispatch({ changes: { from: sel.from, to: sel.to, insert: unwrapped } });
  } else {
    // Check if the surrounding text already has the markers
    const before = sel.from >= marker.length ? editorViewRef.state.sliceDoc(sel.from - marker.length, sel.from) : '';
    const after = editorViewRef.state.sliceDoc(sel.to, sel.to + marker.length);
    if (before === marker && after === marker) {
      // Remove surrounding markers
      editorViewRef.dispatch({ changes: [
        { from: sel.from - marker.length, to: sel.from, insert: '' },
        { from: sel.to, to: sel.to + marker.length, insert: '' },
      ] });
    } else {
      // Record a pending format group so auto-save links the 2 insertion hunks.
      // Store the original-file position so auto-save can match by position.
      const groupId = 'fmt-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6);
      const original = editorViewRef.state.field(originalDocField);
      const origPos = original ? original.indexOf(selected) : sel.from;
      pendingFormatGroups.push({
        groupId,
        marker,
        textFrom: sel.from,
        origFrom: origPos >= 0 ? origPos : sel.from,
        textLen: selected.length,
        label: (marker === '**' ? 'Bold' : 'Italic') + ': ' + selected,
      });
      // Just insert the markers — the diff engine will produce 2 hunks
      editorViewRef.dispatch({
        changes: { from: sel.from, to: sel.to, insert: marker + selected + marker },
      });
    }
  }
  hideCommentTooltip();
}

// Keyboard shortcuts for bold/italic
const formatKeymap = keymap.of([
  { key: 'Mod-b', run: () => { toggleFormat('**'); return true; } },
  { key: 'Mod-i', run: () => { toggleFormat('_'); return true; } },
]);

// --- Selection listener: show formatting toolbar on text selection ---
const selectionListener = EditorView.updateListener.of((update) => {
  if (!update.selectionSet && !update.focusChanged) return;
  // Don't show tooltip when editor is read-only (View Source or review mode)
  if (update.view.state.readOnly) {
    hideCommentTooltip();
    return;
  }
  const sel = update.view.state.selection.main;
  if (sel.empty) {
    hideCommentTooltip();
    return;
  }
  // Don't show tooltip when search input is focused (search highlights text)
  if (document.activeElement?.id === 'editor-search-input') {
    hideCommentTooltip();
    return;
  }
  const coords = update.view.coordsAtPos(sel.head);
  if (coords) {
    showCommentTooltip(coords.left, coords.top);
  }
});

let tooltipEl = null;

function showCommentTooltip(x, y) {
  if (!tooltipEl) {
    tooltipEl = document.createElement('div');
    tooltipEl.className = 'comment-tooltip';

    const boldBtn = document.createElement('button');
    boldBtn.className = 'comment-tooltip-btn comment-tooltip-bold';
    boldBtn.innerHTML = '<strong>B</strong>';
    boldBtn.title = 'Bold (Ctrl+B)';
    boldBtn.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); toggleFormat('**'); });

    const italicBtn = document.createElement('button');
    italicBtn.className = 'comment-tooltip-btn comment-tooltip-italic';
    italicBtn.innerHTML = '<em>I</em>';
    italicBtn.title = 'Italic (Ctrl+I)';
    italicBtn.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); toggleFormat('_'); });

    const commentBtn = document.createElement('button');
    commentBtn.className = 'comment-tooltip-btn comment-tooltip-comment';
    commentBtn.textContent = '+ Comment';
    commentBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      hideCommentTooltip();
      showCommentPopup();
    });

    tooltipEl.appendChild(commentBtn);
    tooltipEl.appendChild(boldBtn);
    tooltipEl.appendChild(italicBtn);
    document.body.appendChild(tooltipEl);
  }
  tooltipEl.style.display = 'flex';
  tooltipEl.style.left = x + 'px';
  tooltipEl.style.top = (y - 36) + 'px';
}

function hideCommentTooltip() {
  if (tooltipEl) tooltipEl.style.display = 'none';
}

function showCommentPopup() {
  const popup = document.getElementById('comment-popup');
  const input = document.getElementById('comment-popup-input');
  if (!popup || !editorViewRef) return;

  const sel = editorViewRef.state.selection.main;
  if (sel.empty) return;

  const coords = editorViewRef.coordsAtPos(sel.head);
  if (coords) {
    const editorRect = editorViewRef.dom.closest('.editor-body').getBoundingClientRect();
    popup.style.top = (coords.top - editorRect.top + 24) + 'px';
    popup.style.right = '0';
  }

  popup.style.display = 'block';
  input.value = '';
  input.focus();
}

// --- Public API ---

export function commentExtension() {
  return [selectionListener, formatKeymap];
}

export function initComments(view, callback) {
  editorViewRef = view;
  onCommentAdded = callback;

  // Pre-fetch taggable users for autocomplete
  fetchTaggableUsers();

  // Attach @-mention autocomplete to comment popup textarea
  var commentInput = document.getElementById('comment-popup-input');
  if (commentInput) attachMentionToElement(commentInput);

  // Bind popup buttons
  document.getElementById('comment-popup-cancel')?.addEventListener('click', () => {
    document.getElementById('comment-popup').style.display = 'none';
    clearPendingMentions();
  });

  document.getElementById('comment-popup-submit')?.addEventListener('click', () => {
    submitComment();
  });

  document.getElementById('comment-popup-input')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      // Don't submit if Tribute autocomplete dropdown is open — Enter selects the mention
      const tributeOpen = document.querySelector('.tribute-container') &&
        document.querySelector('.tribute-container').style.display !== 'none';
      if (tributeOpen) return;
      e.preventDefault();
      submitComment();
    }
  });
}

async function submitComment() {
  if (!editorViewRef) return;
  const popup = document.getElementById('comment-popup');
  const input = document.getElementById('comment-popup-input');
  const commentText = input.value.trim();
  if (!commentText) return;

  const sel = editorViewRef.state.selection.main;
  const selectedText = editorViewRef.state.sliceDoc(sel.from, sel.to);
  if (!selectedText.trim()) return;

  const editorData = window.__EDITOR_DATA;
  if (!editorData) return;

  const submitBtn = document.getElementById('comment-popup-submit');
  submitBtn.disabled = true;
  submitBtn.textContent = 'Saving...';

  try {
    const mentionedUsers = getPendingMentions();
    const res = await fetch('/api/suggestions/comments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        filePath: editorData.sessionFilePath,
        bookPath: editorData.bookRepoPath,
        baseCommitSha: editorData.contentSha,
        from: sel.from,
        to: sel.to,
        selectedText,
        commentText,
        mentionedUsers,
      }),
    });

    if (!res.ok) {
      const err = await res.json();
      window.showToast('Error: ' + (err.error || 'Failed to save comment'), 'error');
      return;
    }

    const result = await res.json();

    // Notify editor.js to add to registry
    if (onCommentAdded) {
      onCommentAdded({
        id: result.id,
        kind: 'comment',
        selectedText,
        commentText,
        mentionedUsers,
        currentFrom: sel.from,
        currentTo: sel.to,
        authorEmail: editorData.user ? editorData.user.email : '',
        authorName: editorData.user ? editorData.user.displayName : '',
        photoURL: editorData.user ? editorData.user.photoURL : null,
        createdAt: new Date(),
      });
    }

    popup.style.display = 'none';
    clearPendingMentions();
  } catch (err) {
    window.showToast('Error: ' + err.message, 'error');
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = 'Comment';
  }
}
