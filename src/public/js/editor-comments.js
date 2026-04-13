// Noble Imprint — Comment System
// Highlight text, add comments, show in margin alongside suggestions.
import { Decoration, ViewPlugin, EditorView } from '/static/js/codemirror-bundle.js';

let comments = []; // Array of { id, from, to, selectedText, commentText, authorEmail, authorName, createdAt }
let editorViewRef = null;
let onCommentsChanged = null;

// --- Decoration plugin: highlight commented ranges ---
const commentPlugin = ViewPlugin.fromClass(
  class {
    constructor(view) {
      this.decorations = buildCommentDecorations(view);
    }
    update(update) {
      // Rebuild when comments change (triggered externally by setting a flag)
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
    // Find the commented text in the current document
    const pos = doc.indexOf(c.selectedText);
    if (pos >= 0) {
      decorations.push(
        Decoration.mark({
          class: 'cm-comment-highlight',
          attributes: { 'data-comment-id': c.id },
        }).range(pos, pos + c.selectedText.length)
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
    cursor: 'pointer',
  },
});

// --- Public API ---

export function commentExtension() {
  return [commentPlugin, commentTheme];
}

export function initComments(view, existingComments, callback) {
  editorViewRef = view;
  comments = existingComments || [];
  onCommentsChanged = callback;
  // Force rebuild decorations
  refreshDecorations();
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
      // Trigger a trivial update to rebuild decorations
      editorViewRef.dispatch({});
    }
  }
}

// --- Add comment flow ---

export async function promptAddComment(view, editorData) {
  const sel = view.state.selection.main;
  if (sel.empty) {
    alert('Select some text first, then click Comment.');
    return;
  }

  const selectedText = view.state.sliceDoc(sel.from, sel.to);
  if (selectedText.trim().length === 0) {
    alert('Select some text first.');
    return;
  }

  const commentText = prompt('Add your comment:');
  if (!commentText || commentText.trim().length === 0) return;

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
        selectedText: selectedText,
        commentText: commentText.trim(),
      }),
    });

    if (!res.ok) {
      const err = await res.json();
      alert('Error: ' + (err.error || 'Failed to save comment'));
      return;
    }

    const result = await res.json();
    addComment({
      id: result.id,
      from: sel.from,
      to: sel.to,
      selectedText,
      commentText: commentText.trim(),
      authorEmail: editorData.user ? editorData.user.email : '',
      authorName: editorData.user ? editorData.user.displayName : '',
      createdAt: new Date(),
    });
  } catch (err) {
    alert('Error: ' + err.message);
  }
}
