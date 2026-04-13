// Noble Imprint — CodeMirror 6 Editor (ES Module)
import { basicSetup, EditorView, EditorState, markdown } from '/static/js/codemirror-bundle.js';
import { maskingExtension } from '/static/js/editor-masking.js';
import {
  suggestionExtension, setOriginal, setHunksChangedCallback, getCurrentHunks,
} from '/static/js/editor-suggestions.js';
import { initMarginPanel, updateMarginCards, updateCommentCards, repositionCards } from '/static/js/editor-margin.js';
import { commentExtension, initComments, getComments } from '/static/js/editor-comments.js';

const data = window.__EDITOR_DATA;
if (data) {
  let editorView = null;
  let editMode = null; // 'suggest' | 'direct' | 'review'
  const originalContent = data.rawContent;

  const readingContent = document.getElementById('reading-content');
  const editorContainer = document.getElementById('editor-container');
  const editToolbar = document.getElementById('edit-toolbar');
  const modeLabel = document.getElementById('editor-mode-label');
  const saveStatus = document.getElementById('editor-save-status');

  // --- Auto-save state ---
  let savedHunks = new Map(); // hunkKey → firestore doc id
  let saveTimer = null;

  function hunkKey(hunk) {
    // Key by content — stable across diff recomputations
    // For insertions (no originalText), use the context position
    if (hunk.type === 'insertion') {
      return 'ins:' + hunk.originalFrom + ':' + (hunk.newText || '').substring(0, 50);
    }
    // For deletions/replacements, the original text is the stable anchor
    return hunk.type + ':' + (hunk.originalText || '');
  }

  function extractContext(original, from, to) {
    const before = original.substring(Math.max(0, from - 50), from);
    const after = original.substring(to, Math.min(original.length, to + 50));
    return { contextBefore: before, contextAfter: after };
  }

  async function autoSave(hunks) {
    if (!data.sessionFilePath || !data.bookRepoPath || editMode !== 'suggest') return;

    const currentKeys = new Set(hunks.map(hunkKey));

    // Delete hunks that no longer exist
    for (const [key, docId] of savedHunks) {
      if (!currentKeys.has(key)) {
        try {
          await fetch('/api/suggestions/hunk/' + docId, { method: 'DELETE' });
          savedHunks.delete(key);
        } catch { /* ignore */ }
      }
    }

    // Create or update hunks
    for (const hunk of hunks) {
      const key = hunkKey(hunk);
      const ctx = extractContext(originalContent, hunk.originalFrom, hunk.originalTo);

      if (savedHunks.has(key)) {
        try {
          await fetch('/api/suggestions/hunk/' + savedHunks.get(key), {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              type: hunk.type, originalFrom: hunk.originalFrom, originalTo: hunk.originalTo,
              originalText: hunk.originalText, newText: hunk.newText, ...ctx,
            }),
          });
        } catch { /* ignore */ }
      } else {
        try {
          const res = await fetch('/api/suggestions/hunk', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              filePath: data.sessionFilePath, bookPath: data.bookRepoPath,
              baseCommitSha: data.contentSha, type: hunk.type,
              originalFrom: hunk.originalFrom, originalTo: hunk.originalTo,
              originalText: hunk.originalText, newText: hunk.newText, ...ctx,
            }),
          });
          if (res.ok) {
            const result = await res.json();
            savedHunks.set(key, result.id);
          }
        } catch { /* ignore */ }
      }
    }

    if (saveStatus) {
      saveStatus.textContent = 'Saved';
      setTimeout(() => { saveStatus.textContent = ''; }, 2000);
    }
  }

  // --- Find the Firestore ID for a hunk ---
  function findFirestoreId(hunkId) {
    // Get the actual hunk object from the diff engine
    const hunks = getCurrentHunks();
    const hunk = hunks.find(h => h.id === hunkId);

    // Check savedHunks Map using the hunkKey (type:from:to), not the hunk ID
    if (hunk) {
      const key = hunkKey(hunk);
      if (savedHunks.has(key)) return savedHunks.get(key);
    }

    // Match against loaded suggestions by content
    if (hunk && data.pendingSuggestions) {
      for (const s of data.pendingSuggestions) {
        if (s.originalText === hunk.originalText && s.newText === hunk.newText) return s.id;
        if (s.type === hunk.type && s.originalText === hunk.originalText) return s.id;
      }
    }

    // Direct match by ID
    if (data.pendingSuggestions) {
      const direct = data.pendingSuggestions.find(s => s.id === hunkId);
      if (direct) return direct.id;
    }

    return null;
  }

  // --- Toast notification ---
  function showToast(message, type) {
    const toast = document.getElementById('editor-toast');
    if (!toast) return;
    toast.textContent = message;
    toast.className = 'editor-toast editor-toast--' + (type || 'info');
    toast.style.display = 'block';
    if (type === 'success') {
      setTimeout(() => { toast.style.display = 'none'; }, 3000);
    }
  }

  // --- Accept a hunk via API ---
  let acceptingInProgress = false;
  async function acceptHunk(hunkId) {
    if (acceptingInProgress) return;
    acceptingInProgress = true;

    const firestoreId = findFirestoreId(hunkId);
    if (!firestoreId) {
      alert('Could not find this suggestion. It may not be saved yet.');
      acceptingInProgress = false;
      return;
    }

    // Disable the button visually
    const btn = document.querySelector('[data-action="accept"][data-hunk-id="' + hunkId + '"]');
    if (btn) { btn.disabled = true; btn.style.opacity = '0.4'; }

    showToast('Committing to GitHub...', 'info');

    try {
      const res = await fetch('/api/suggestions/hunk/' + firestoreId + '/accept', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
      });
      if (!res.ok) {
        const err = await res.json();
        showToast('Error: ' + (err.message || err.error), 'error');
        acceptingInProgress = false;
        if (btn) { btn.disabled = false; btn.style.opacity = ''; }
        return;
      }

      showToast('GitHub updated successfully', 'success');
      acceptingInProgress = false;

      // Remove the accepted suggestion's card from the margin
      const card = document.querySelector('.margin-card[data-hunk-id="' + hunkId + '"]');
      if (card) card.remove();

      // Remove from pendingSuggestions data so it doesn't reappear
      if (data.pendingSuggestions) {
        data.pendingSuggestions = data.pendingSuggestions.filter(s => s.id !== firestoreId);
      }

    } catch (err) {
      showToast('Error: ' + err.message, 'error');
      acceptingInProgress = false;
      if (btn) { btn.disabled = false; btn.style.opacity = ''; }
    }
  }

  // --- Reject/delete a hunk ---
  async function rejectOrDeleteHunk(hunkId) {
    const firestoreId = findFirestoreId(hunkId);

    // Revert the change in the editor
    const hunks = getCurrentHunks();
    const hunk = hunks.find(h => h.id === hunkId);
    if (hunk && editorView && editMode === 'suggest') {
      if (hunk.type === 'insertion') {
        editorView.dispatch({ changes: { from: hunk.currentFrom, to: hunk.currentTo, insert: '' } });
      } else if (hunk.type === 'deletion') {
        editorView.dispatch({ changes: { from: hunk.currentPos, insert: hunk.originalText } });
      } else if (hunk.type === 'replacement') {
        editorView.dispatch({ changes: { from: hunk.currentFrom, to: hunk.currentTo, insert: hunk.originalText } });
      }
    }

    // Delete or reject from Firestore immediately
    if (firestoreId) {
      try {
        if (editMode === 'review') {
          await fetch('/api/suggestions/hunk/' + firestoreId + '/reject', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
          });
        } else {
          await fetch('/api/suggestions/hunk/' + firestoreId, { method: 'DELETE' });
        }
      } catch { /* ignore */ }
    }

    // Clean up local tracking
    if (hunk) {
      const key = hunkKey(hunk);
      savedHunks.delete(key);
    }

    // In review mode, reload to reflect the change
    if (editMode === 'review') {
      window.location.reload();
    }
  }

  // --- Build working document from original + existing suggestions ---
  // Uses text-based find-and-replace, not position-based (matches server accept logic)
  function buildWorkingDoc(original, existingSuggestions) {
    if (!existingSuggestions || existingSuggestions.length === 0) return original;

    // Sort by originalFrom descending so we apply from end to start (avoids position shifts)
    const sorted = [...existingSuggestions].sort((a, b) => b.originalFrom - a.originalFrom);
    let doc = original;

    for (const s of sorted) {
      if (s.type === 'insertion') {
        // Find insertion point using context
        if (s.contextBefore || s.contextAfter) {
          const ctx = (s.contextBefore || '') + (s.contextAfter || '');
          const ctxPos = doc.indexOf(ctx);
          if (ctxPos >= 0) {
            const insertAt = ctxPos + (s.contextBefore || '').length;
            doc = doc.slice(0, insertAt) + s.newText + doc.slice(insertAt);
          }
        }
      } else if (s.type === 'deletion') {
        const pos = doc.indexOf(s.originalText);
        if (pos >= 0) {
          doc = doc.slice(0, pos) + doc.slice(pos + s.originalText.length);
        }
      } else if (s.type === 'replacement') {
        const pos = doc.indexOf(s.originalText);
        if (pos >= 0) {
          doc = doc.slice(0, pos) + s.newText + doc.slice(pos + s.originalText.length);
        }
      }
    }
    return doc;
  }

  // --- Editor init ---
  function initEditor(mode) {
    editMode = mode;
    modeLabel.textContent = mode === 'direct' ? 'Direct Editing'
      : mode === 'review' ? 'Reviewing Suggestions'
      : 'Suggesting Edits';

    // Swap views
    readingContent.style.display = 'none';
    editToolbar.style.display = 'none';
    editorContainer.style.display = 'block';
    var sidebar = document.querySelector('.sidebar');
    var readingTop = document.querySelector('.reading-top');
    var mobileToc = document.querySelector('.mobile-toc-bar');
    if (sidebar) sidebar.style.display = 'none';
    if (readingTop) readingTop.style.display = 'none';
    if (mobileToc) mobileToc.style.display = 'none';
    document.querySelector('.main').style.padding = '0.5rem 1.5rem';
    document.querySelector('.main').style.maxWidth = 'none';

    const marginEl = document.getElementById('suggestion-margin');
    const isSuggestOrReview = mode === 'suggest' || mode === 'review';

    // Build the working document (apply existing suggestions)
    const existingSuggestions = data.pendingSuggestions || [];
    const workingDoc = isSuggestOrReview && existingSuggestions.length > 0
      ? buildWorkingDoc(originalContent, existingSuggestions)
      : originalContent;

    // Wire up margin panel callback
    if (isSuggestOrReview) {
      setHunksChangedCallback((hunks) => {
        if (editorView) updateMarginCards(hunks);
        if (mode === 'suggest') {
          clearTimeout(saveTimer);
          saveTimer = setTimeout(() => autoSave(hunks), 1500);
        }
      });
    }

    // Create CodeMirror
    const host = document.getElementById('codemirror-host');
    host.innerHTML = '';

    // For suggest/review mode, pre-set the original content in the initial state
    const extensions = [
      basicSetup,
      markdown(),
      EditorView.lineWrapping,
      maskingExtension(),
      ...(isSuggestOrReview ? [suggestionExtension(), commentExtension()] : []),
      ...(mode === 'review' ? [EditorState.readOnly.of(true)] : []),
    ];

    editorView = new EditorView({
      state: EditorState.create({
        doc: workingDoc,
        extensions,
      }),
      parent: host,
    });

    // Set original for diff tracking
    if (isSuggestOrReview) {
      editorView.dispatch({ effects: setOriginal.of(originalContent) });
    }

    // Init margin panel + comments
    if (isSuggestOrReview && marginEl) {
      const userInfo = data.user ? { ...data.user, editRole: data.editRole } : null;
      initMarginPanel(marginEl, editorView, userInfo, {
        onAccept: acceptHunk,
        onReject: rejectOrDeleteHunk,
        onResolveComment: resolveComment,
      });

      // Load existing comments
      const existingComments = data.pendingComments || [];
      initComments(editorView, existingComments, (comments) => {
        updateCommentCards(comments);
      });
      if (existingComments.length > 0) {
        updateCommentCards(existingComments);
      }
    }

    // Reposition margin on scroll
    const scroller = host.querySelector('.cm-scroller');
    if (scroller && isSuggestOrReview) {
      scroller.addEventListener('scroll', repositionCards);
    }

    // Expose for testing
    window.__editorView = editorView;

    editorView.focus();
  }

  function exitEditor() {
    if (editorView) {
      editorView.destroy();
      editorView = null;
    }
    editorContainer.style.display = 'none';
    readingContent.style.display = '';
    editToolbar.style.display = '';
    var sidebar = document.querySelector('.sidebar');
    var readingTop = document.querySelector('.reading-top');
    var mobileToc = document.querySelector('.mobile-toc-bar');
    if (sidebar) sidebar.style.display = '';
    if (readingTop) readingTop.style.display = '';
    if (mobileToc) mobileToc.style.display = '';
    document.querySelector('.main').style.padding = '';
    document.querySelector('.main').style.maxWidth = '';
    editMode = null;
    window.location.reload();
  }

  // --- Direct edit save ---
  async function directSave() {
    if (!editorView) return;
    const currentContent = editorView.state.doc.toString();
    if (currentContent === originalContent) {
      alert('No changes were made.');
      return;
    }
    if (!confirm('Commit these changes directly to the repository?')) return;

    const doneBtn = document.getElementById('btn-editor-done');
    doneBtn.disabled = true;
    doneBtn.textContent = 'Saving...';

    try {
      const res = await fetch('/api/suggestions/direct-edit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filePath: data.sessionFilePath, bookPath: data.bookRepoPath,
          content: currentContent, sha: data.contentSha,
        }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to save');
      }
      window.location.reload();
    } catch (err) {
      alert('Error: ' + err.message);
      doneBtn.disabled = false;
      doneBtn.textContent = 'Done';
    }
  }

  // --- Resolve a comment ---
  async function resolveComment(commentId) {
    try {
      const res = await fetch('/api/suggestions/comments/' + commentId + '/resolve', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
      });
      if (!res.ok) {
        const err = await res.json();
        alert('Error: ' + (err.error || 'Failed to resolve'));
        return;
      }
      // Remove from local state
      const { removeComment } = await import('/static/js/editor-comments.js');
      removeComment(commentId);
    } catch (err) {
      alert('Error: ' + err.message);
    }
  }

  // --- Bind buttons ---
  document.getElementById('btn-suggest-edit')?.addEventListener('click', () => initEditor('suggest'));
  document.getElementById('btn-direct-edit')?.addEventListener('click', () => initEditor('direct'));
  document.getElementById('btn-review')?.addEventListener('click', () => initEditor('review'));
  document.getElementById('btn-editor-done')?.addEventListener('click', () => {
    if (editMode === 'direct') {
      const currentContent = editorView ? editorView.state.doc.toString() : originalContent;
      if (currentContent !== originalContent) {
        directSave();
      } else {
        exitEditor();
      }
    } else {
      exitEditor();
    }
  });
}
