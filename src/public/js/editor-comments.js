// Noble Imprint — Comment System
// Select text → floating popup appears → enter comment → saves to margin.
import { Decoration, ViewPlugin, EditorView } from '/static/js/codemirror-bundle.js';

let comments = [];
let editorViewRef = null;
let onCommentsChanged = null;

// --- Decoration plugin: highlight commented ranges ---
const commentPlugin = ViewPlugin.fromClass(
  class {
    constructor(view) {
      this.decorations = buildCommentDecorations(view);
    }
    update(update) {
      if (update.docChanged || this._dirty) {
        this.decorations = buildCommentDecorations(update.view);
        this._dirty = false;
      }
    }
  },
  { decorations: (v) => v.decorations }
);

function buildCommentDecorations(view) {
  if (comments.length === 0) return Decoration.none;
  const doc = view.state.doc.toString();
  const decorations = [];

  for (const c of comments) {
    // Use server-resolved positions if available, fall back to indexOf
    let pos = -1;
    let end = -1;
    if (c.resolvedFrom != null && c.resolvedTo != null && !c.resolvedStale) {
      pos = c.resolvedFrom;
      end = c.resolvedTo;
    } else if (c.currentFrom != null && c.currentTo != null) {
      pos = c.currentFrom;
      end = c.currentTo;
    } else {
      pos = doc.indexOf(c.selectedText);
      end = pos >= 0 ? pos + c.selectedText.length : -1;
    }

    if (pos >= 0 && end > pos && end <= doc.length) {
      decorations.push(
        Decoration.mark({
          class: 'cm-comment-highlight',
          attributes: { 'data-comment-id': c.id },
        }).range(pos, end)
      );
    }
  }

  decorations.sort((a, b) => a.from - b.from);
  return Decoration.set(decorations, true);
}

const commentTheme = EditorView.theme({
  '.cm-comment-highlight': {
    background: 'rgba(251, 188, 4, 0.25)',
    borderBottom: '2px solid #fbbc04',
  },
});

// --- Selection listener: show "Add Comment" tooltip on text selection ---
const selectionListener = EditorView.updateListener.of((update) => {
  if (!update.selectionSet && !update.focusChanged) return;
  const sel = update.view.state.selection.main;
  if (sel.empty) {
    hideCommentTooltip();
    return;
  }
  // Show tooltip near the selection
  const coords = update.view.coordsAtPos(sel.head);
  if (coords) {
    showCommentTooltip(coords.left, coords.top);
  }
});

let tooltipEl = null;

function showCommentTooltip(x, y) {
  if (!tooltipEl) {
    tooltipEl = document.createElement('button');
    tooltipEl.className = 'comment-tooltip';
    tooltipEl.textContent = '+ Comment';
    tooltipEl.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      hideCommentTooltip();
      showCommentPopup();
    });
    document.body.appendChild(tooltipEl);
  }
  tooltipEl.style.display = 'block';
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

  // Position popup near the editor
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
  return [commentPlugin, commentTheme, selectionListener];
}

export function initComments(view, existingComments, callback) {
  editorViewRef = view;
  comments = existingComments || [];
  onCommentsChanged = callback;

  // Bind popup buttons
  document.getElementById('comment-popup-cancel')?.addEventListener('click', () => {
    document.getElementById('comment-popup').style.display = 'none';
  });

  document.getElementById('comment-popup-submit')?.addEventListener('click', () => {
    submitComment();
  });

  // Enter key in textarea submits (Shift+Enter for newline)
  document.getElementById('comment-popup-input')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submitComment();
    }
  });

  refreshDecorations();
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
    addComment({
      id: result.id,
      from: sel.from,
      to: sel.to,
      selectedText,
      commentText,
      authorEmail: editorData.user ? editorData.user.email : '',
      authorName: editorData.user ? editorData.user.displayName : '',
      createdAt: new Date(),
    });

    popup.style.display = 'none';
  } catch (err) {
    window.showToast('Error: ' + err.message, 'error');
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = 'Comment';
  }
}

export function addComment(commentData) {
  comments.push(commentData);
  refreshDecorations();
  if (onCommentsChanged) onCommentsChanged(comments);
}

export function removeComment(commentId) {
  comments = comments.filter(c => c.id !== commentId);
  refreshDecorations();
  if (onCommentsChanged) onCommentsChanged(comments);
}

export function getComments() {
  return comments;
}

function refreshDecorations() {
  if (editorViewRef) {
    const plugin = editorViewRef.plugin(commentPlugin);
    if (plugin) {
      plugin._dirty = true;
      editorViewRef.dispatch({});
    }
  }
}
