// Noble Imprint — Comment System (v3 — Registry-based)
//
// Comments are tracked in the annotationRegistry StateField (in editor-suggestions.js).
// This file only handles: tooltip UI, popup UI, and submitting to the API.
// Decorations are built by the registry decoration plugin, not here.
import { EditorView, keymap } from '/static/js/codemirror-bundle.js';

let editorViewRef = null;
let onCommentAdded = null; // callback after new comment saved

// --- Bold/Italic toggle: wrap/unwrap selected text ---
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
      // Wrap with markers
      editorViewRef.dispatch({ changes: { from: sel.from, to: sel.to, insert: marker + selected + marker } });
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
  const sel = update.view.state.selection.main;
  if (sel.empty) {
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

    tooltipEl.appendChild(boldBtn);
    tooltipEl.appendChild(italicBtn);
    tooltipEl.appendChild(commentBtn);
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

  // Bind popup buttons
  document.getElementById('comment-popup-cancel')?.addEventListener('click', () => {
    document.getElementById('comment-popup').style.display = 'none';
  });

  document.getElementById('comment-popup-submit')?.addEventListener('click', () => {
    submitComment();
  });

  document.getElementById('comment-popup-input')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
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
        currentFrom: sel.from,
        currentTo: sel.to,
        authorEmail: editorData.user ? editorData.user.email : '',
        authorName: editorData.user ? editorData.user.displayName : '',
        createdAt: new Date(),
      });
    }

    popup.style.display = 'none';
  } catch (err) {
    window.showToast('Error: ' + err.message, 'error');
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = 'Comment';
  }
}
