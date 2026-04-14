// Noble Imprint — CodeMirror 6 Editor (ES Module)
import { basicSetup, EditorView, EditorState, Compartment, markdown } from '/static/js/codemirror-bundle.js';
import { maskingExtension, setRevealFocusedLine } from '/static/js/editor-masking.js';
import {
  suggestionExtension, setOriginal, originalDocField, setHunksChangedCallback, getCurrentHunks,
  annotationRegistry, setAnnotations, removeAnnotation, addAnnotation, updateAnnotation, isRevert,
} from '/static/js/editor-suggestions.js';
import { initMarginPanel, updateMarginCards, updateCommentCards, updateReplies, removeRepliesForParent, repositionCards, focusMarginCard, animateCardRemoval, setCardStatus, disableAllCardActions, enableAllCardActions } from '/static/js/editor-margin.js';
import { commentExtension, initComments, getComments } from '/static/js/editor-comments.js';
import { constraintExtension, setZones, recomputeZones } from '/static/js/editor-constraints.js';

const data = window.__EDITOR_DATA;
if (data) {
  let editorView = null;
  let editMode = null; // 'suggest' | 'direct' | 'review'
  const originalContent = data.rawContent;

  // --- View Source toggle (compartment for masking) ---
  const maskingCompartment = new Compartment();
  let viewSourceActive = false;

  const readingContent = document.getElementById('reading-content');
  const editorContainer = document.getElementById('editor-container');
  const editToolbar = document.getElementById('edit-toolbar');
  const modeLabel = document.getElementById('editor-mode-label');
  const saveStatus = document.getElementById('editor-save-status');

  // --- Auto-save state ---
  let savedHunks = new Map(); // hunkKey → firestore doc id
  let saveTimer = null;

  function hunkKey(hunk) {
    // Key by position in the ORIGINAL document — stable as the user types,
    // because the original never changes. The position identifies WHERE in the
    // original document this change applies, regardless of what the new text is.
    return hunk.originalFrom + ':' + hunk.originalTo;
  }

  function extractContext(original, from, to) {
    const before = original.substring(Math.max(0, from - 50), from);
    const after = original.substring(to, Math.min(original.length, to + 50));
    return { contextBefore: before, contextAfter: after };
  }

  // Find a saved hunk that overlaps with this hunk's original position range
  function findOverlappingSavedHunk(hunk) {
    const hFrom = hunk.originalFrom;
    const hTo = hunk.originalTo;
    for (const [key, docId] of savedHunks) {
      const [kFrom, kTo] = key.split(':').map(Number);
      // Overlapping or adjacent ranges in the original document
      if (hFrom <= kTo + 1 && hTo >= kFrom - 1) {
        return { key, docId };
      }
    }
    return null;
  }

  async function autoSave(hunks) {
    if (!data.sessionFilePath || !data.bookRepoPath || editMode !== 'suggest') return;

    // Build set of current hunk position ranges
    const currentKeys = new Set(hunks.map(hunkKey));

    // Delete saved hunks that no longer exist (user reverted)
    // BUT: never auto-delete suggestions that are in the annotation registry —
    // those should only be removed by explicit user action (discard)
    const registry = editorView ? editorView.state.field(annotationRegistry) : new Map();
    for (const [key, docId] of savedHunks) {
      // Skip if this suggestion is in the registry (it's a saved, tracked suggestion)
      if (registry.has(docId)) continue;

      const [kFrom, kTo] = key.split(':').map(Number);
      const stillExists = hunks.some(h => h.originalFrom <= kTo + 1 && h.originalTo >= kFrom - 1);
      if (!stillExists) {
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
      const hunkData = {
        type: hunk.type, originalFrom: hunk.originalFrom, originalTo: hunk.originalTo,
        originalText: hunk.originalText, newText: hunk.newText, ...ctx,
      };

      // Check exact key match first, then overlapping match
      const existing = savedHunks.has(key)
        ? { key, docId: savedHunks.get(key) }
        : findOverlappingSavedHunk(hunk);

      if (existing) {
        // Update existing Firestore record
        try {
          await fetch('/api/suggestions/hunk/' + existing.docId, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(hunkData),
          });
          // Update the key if it changed (merge threshold shifted the range)
          if (existing.key !== key) {
            savedHunks.delete(existing.key);
            savedHunks.set(key, existing.docId);
          }
          // Keep registry in sync
          if (editorView) {
            editorView.dispatch({ effects: updateAnnotation.of({
              id: existing.docId,
              originalText: hunk.originalText || '',
              newText: hunk.newText || '',
              originalFrom: hunk.originalFrom,
              originalTo: hunk.originalTo,
              currentFrom: hunk.type === 'deletion' ? hunk.currentPos : hunk.currentFrom,
              currentTo: hunk.type === 'deletion' ? hunk.currentPos : hunk.currentTo,
            }) });
          }
        } catch { /* ignore */ }
      } else {
        // Create new Firestore record
        try {
          const res = await fetch('/api/suggestions/hunk', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              filePath: data.sessionFilePath, bookPath: data.bookRepoPath,
              baseCommitSha: data.contentSha, ...hunkData,
            }),
          });
          if (res.ok) {
            const result = await res.json();
            savedHunks.set(key, result.id);

            // Promote to annotation registry — now this suggestion has a stable ID
            // and will survive document rebuilds during discard operations
            if (editorView) {
              editorView.dispatch({ effects: addAnnotation.of({
                id: result.id,
                kind: 'suggestion',
                type: hunk.type,
                originalText: hunk.originalText || '',
                newText: hunk.newText || '',
                originalFrom: hunk.originalFrom,
                originalTo: hunk.originalTo,
                currentFrom: hunk.type === 'deletion' ? hunk.currentPos : hunk.currentFrom,
                currentTo: hunk.type === 'deletion' ? hunk.currentPos : hunk.currentTo,
                authorEmail: data.user ? data.user.email : '',
                authorName: data.user ? data.user.displayName : '',
                firestoreId: result.id,
              }) });

              // Add to pendingSuggestions for buildWorkingDoc
              if (!data.pendingSuggestions) data.pendingSuggestions = [];
              data.pendingSuggestions.push({
                id: result.id,
                type: hunk.type,
                originalText: hunk.originalText || '',
                newText: hunk.newText || '',
                originalFrom: hunk.originalFrom,
                originalTo: hunk.originalTo,
                ...ctx,
              });
            }
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
    if (type === 'success' || type === 'info') {
      setTimeout(() => { toast.style.display = 'none'; }, 3000);
    } else if (type === 'error') {
      setTimeout(() => { toast.style.display = 'none'; }, 5000);
    }
  }
  // Expose for other modules (editor-comments.js)
  window.showToast = showToast;

  // Click to dismiss toast
  document.getElementById('editor-toast')?.addEventListener('click', function() {
    this.style.display = 'none';
  });

  // --- Refresh overlay ---
  function showRefreshOverlay() {
    const el = document.getElementById('editor-refresh-overlay');
    if (el) el.style.display = '';
  }
  function hideRefreshOverlay() {
    const el = document.getElementById('editor-refresh-overlay');
    if (el) el.style.display = 'none';
  }

  // --- Smart refresh: re-fetch from GitHub and rebuild editor state ---
  async function refreshFromGitHub() {
    showRefreshOverlay();
    try {
      const freshRes = await fetch('/api/suggestions/content?filePath=' + encodeURIComponent(data.sessionFilePath));
      if (!freshRes.ok) { hideRefreshOverlay(); return; }
      const fresh = await freshRes.json();

      const newOriginal = fresh.content;
      const remainingSuggestions = fresh.pendingSuggestions || [];
      const newWorkingDoc = buildWorkingDoc(newOriginal, remainingSuggestions);

      // Clear constraint zones first — the edit protection transactionFilter
      // would block a full-document replacement since position 0 is outside any zone
      editorView.dispatch({ effects: setZones.of([]) });

      // Replace the editor document and original
      editorView.dispatch({
        changes: { from: 0, to: editorView.state.doc.length, insert: newWorkingDoc },
        effects: setOriginal.of(newOriginal),
      });

      // Restore constraint zones from the new document
      if (editMode === 'suggest') {
        const zones = recomputeZones(editorView.state.doc);
        editorView.dispatch({ effects: setZones.of(zones) });
      }

      // Update local data
      data.pendingSuggestions = remainingSuggestions;
      data.pendingComments = fresh.pendingComments || [];
      data.pendingReplies = fresh.pendingReplies || [];

      // Refresh comment and reply cards
      const existingComments = fresh.pendingComments || [];
      const { initComments } = await import('/static/js/editor-comments.js');
      initComments(editorView, existingComments, (comments) => {
        updateCommentCards(comments);
      });
      if (existingComments.length > 0) updateCommentCards(existingComments);
      updateReplies(fresh.pendingReplies || []);
    } catch { /* ignore refresh errors */ }
    hideRefreshOverlay();
  }

  // --- Accept a hunk via API ---
  let acceptingInProgress = false;
  async function acceptHunk(hunkId) {
    if (acceptingInProgress) return;
    acceptingInProgress = true;

    const firestoreId = findFirestoreId(hunkId);
    if (!firestoreId) {
      showToast('Could not find this suggestion. It may not be saved yet.', 'error');
      acceptingInProgress = false;
      return;
    }

    // Save hunk details on the card before replacing its content
    const hunks = getCurrentHunks();
    const hunk = hunks.find(h => h.id === hunkId);
    if (hunk) {
      const card = document.querySelector('.margin-card[data-hunk-id="' + hunkId + '"]');
      if (card) {
        card.dataset.origText = hunk.originalText || '';
        card.dataset.newText = hunk.newText || '';
        card.dataset.hunkType = hunk.type || '';
      }
    }

    // Transform card to loading state, disable all other cards
    setCardStatus(hunkId, 'loading', 'Committing to GitHub...');
    disableAllCardActions();

    try {
      const res = await fetch('/api/suggestions/hunk/' + firestoreId + '/accept', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
      });

      if (!res.ok) {
        const err = await res.json();
        if (res.status === 409) {
          setCardStatus(hunkId, 'stale', err.message || 'Stale');
        } else {
          setCardStatus(hunkId, 'error', err.message || err.error || 'Failed to accept');
        }
        acceptingInProgress = false;
        enableAllCardActions();
        return;
      }

      // Success — card turns green
      setCardStatus(hunkId, 'success', 'Committed to GitHub');
      removeRepliesForParent(firestoreId);

      // Smart refresh: fetch latest from GitHub and rebuild editor
      await refreshFromGitHub();

      acceptingInProgress = false;
      enableAllCardActions();

      // Slide out after 1.5s
      setTimeout(() => animateCardRemoval('.margin-card[data-hunk-id="' + hunkId + '"]'), 1500);

    } catch (err) {
      setCardStatus(hunkId, 'error', err.message || 'Network error');
      acceptingInProgress = false;
      enableAllCardActions();
    }
  }

  // --- Dismiss a stale suggestion ---
  async function dismissStaleSuggestion(hunkId) {
    const firestoreId = findFirestoreId(hunkId);
    if (firestoreId) {
      try { await fetch('/api/suggestions/hunk/' + firestoreId, { method: 'DELETE' }); } catch { /* ignore */ }
    }
    animateCardRemoval('.margin-card[data-hunk-id="' + hunkId + '"]');
  }

  // --- Reject/delete a hunk ---
  async function rejectOrDeleteHunk(hunkId) {
    const firestoreId = findFirestoreId(hunkId);

    // Remove from the annotation registry
    if (firestoreId) {
      editorView.dispatch({ effects: removeAnnotation.of(firestoreId) });
    }

    // Rebuild the document from scratch: original + remaining registry suggestions
    // This is safe — other suggestions' positions are preserved because we rebuild
    // from the registry rather than reverting text and hoping the diff recomputes correctly.
    if (editorView && editMode === 'suggest') {
      const registry = editorView.state.field(annotationRegistry);
      const remainingSuggestions = [];
      for (const [, a] of registry) {
        if (a.kind === 'suggestion') {
          remainingSuggestions.push(a);
        }
      }
      const newWorkingDoc = buildWorkingDoc(originalContent, remainingSuggestions.length > 0
        ? data.pendingSuggestions.filter(s => s.id !== firestoreId && !s.resolvedStale)
        : []);

      // Clear zones, replace document, restore zones
      editorView.dispatch({ effects: setZones.of([]) });
      editorView.dispatch({
        changes: { from: 0, to: editorView.state.doc.length, insert: newWorkingDoc },
        annotations: isRevert.of(true),
      });
      const zones = recomputeZones(editorView.state.doc);
      editorView.dispatch({ effects: setZones.of(zones) });
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

    // Clean up replies
    if (firestoreId) removeRepliesForParent(firestoreId);
    removeRepliesForParent(hunkId);
    try {
      if (firestoreId) fetch('/api/suggestions/replies/by-parent/' + firestoreId, { method: 'DELETE' });
      fetch('/api/suggestions/replies/by-parent/' + hunkId, { method: 'DELETE' });
    } catch { /* ignore */ }
    if (firestoreId && data.pendingSuggestions) {
      data.pendingSuggestions = data.pendingSuggestions.filter(s => s.id !== firestoreId);
    }
    const hunks = getCurrentHunks();
    const hunk = hunks.find(h => h.id === hunkId);
    if (hunk) {
      const key = hunkKey(hunk);
      savedHunks.delete(key);
    }

    // Animate card removal
    animateCardRemoval('.margin-card[data-hunk-id="' + hunkId + '"]');

    showToast(editMode === 'review' ? 'Suggestion rejected' : 'Suggestion discarded', 'info');

    if (editMode === 'review') {
      setTimeout(() => window.location.reload(), 1200);
    }
  }

  // --- Build working document from original + existing suggestions ---
  // Uses server-resolved positions when available, falls back to text-based find-and-replace
  function buildWorkingDoc(original, existingSuggestions) {
    if (!existingSuggestions || existingSuggestions.length === 0) return original;

    // Filter out stale suggestions
    const valid = existingSuggestions.filter(s => !s.resolvedStale);

    // Sort by position descending so we apply from end to start (avoids position shifts)
    const sorted = [...valid].sort((a, b) => {
      const posA = a.resolvedFrom != null ? a.resolvedFrom : a.originalFrom;
      const posB = b.resolvedFrom != null ? b.resolvedFrom : b.originalFrom;
      return posB - posA;
    });
    let doc = original;

    for (const s of sorted) {
      // Use server-resolved position if available
      const hasResolved = s.resolvedFrom != null && s.resolvedTo != null;

      if (s.type === 'insertion') {
        let insertAt = -1;
        if (hasResolved) {
          insertAt = s.resolvedFrom;
        } else if (s.contextBefore || s.contextAfter) {
          const ctx = (s.contextBefore || '') + (s.contextAfter || '');
          const ctxPos = doc.indexOf(ctx);
          if (ctxPos >= 0) insertAt = ctxPos + (s.contextBefore || '').length;
        }
        if (insertAt >= 0) {
          doc = doc.slice(0, insertAt) + s.newText + doc.slice(insertAt);
        }
      } else if (s.type === 'deletion') {
        let pos = -1;
        if (hasResolved) {
          pos = s.resolvedFrom;
        } else {
          pos = doc.indexOf(s.originalText);
        }
        if (pos >= 0) {
          doc = doc.slice(0, pos) + doc.slice(pos + s.originalText.length);
        }
      } else if (s.type === 'replacement') {
        let pos = -1;
        if (hasResolved) {
          pos = s.resolvedFrom;
        } else {
          pos = doc.indexOf(s.originalText);
        }
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

    // Visual mode distinction
    editorContainer.classList.toggle('direct-editing', mode === 'direct');

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
    document.querySelector('.main').classList.add('main--editing');

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
    // All users in suggest mode get edit constraints (single line, within tag boundaries)
    const isConstrained = mode === 'suggest';

    // Direct edit: reveal raw markdown on the focused line
    setRevealFocusedLine(mode === 'direct');

    // Zone recomputation listener — keeps zones fresh as doc changes
    // Uses a flag to prevent infinite dispatch loop (setZones triggers update which triggers setZones...)
    let zonesUpdating = false;
    const zoneUpdater = isConstrained ? EditorView.updateListener.of((update) => {
      if (update.docChanged && !zonesUpdating) {
        zonesUpdating = true;
        const zones = recomputeZones(update.view.state.doc);
        update.view.dispatch({ effects: setZones.of(zones) });
        zonesUpdating = false;
      }
    }) : [];

    viewSourceActive = false;
    const extensions = [
      basicSetup,
      markdown(),
      EditorView.lineWrapping,
      maskingCompartment.of(maskingExtension()),
      ...(isSuggestOrReview ? [suggestionExtension(), commentExtension()] : []),
      ...(isConstrained ? [constraintExtension(), zoneUpdater] : []),
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

      // Populate annotation registry with loaded suggestions
      const registryEntries = [];
      for (const s of existingSuggestions) {
        if (s.resolvedStale) continue;
        // Find position of this suggestion's newText in the working doc
        const pos = s.resolvedFrom != null ? s.resolvedFrom : s.originalFrom;
        const textLen = s.type === 'insertion' ? (s.newText || '').length
          : s.type === 'deletion' ? 0
          : (s.newText || '').length;
        registryEntries.push({
          id: s.id,
          kind: 'suggestion',
          type: s.type,
          originalText: s.originalText || '',
          newText: s.newText || '',
          originalFrom: s.originalFrom,
          originalTo: s.originalTo,
          currentFrom: pos,
          currentTo: pos + textLen,
          authorEmail: s.authorEmail,
          authorName: s.authorName,
          firestoreId: s.id,
        });
      }
      if (registryEntries.length > 0) {
        editorView.dispatch({ effects: setAnnotations.of(registryEntries) });
      }
    }

    // Initialize editable zones for constrained mode
    if (isConstrained) {
      const zones = recomputeZones(editorView.state.doc);
      editorView.dispatch({ effects: setZones.of(zones) });
    }

    // Init margin panel + comments
    if (isSuggestOrReview && marginEl) {
      const userInfo = data.user ? { ...data.user, editRole: data.editRole } : null;
      initMarginPanel(marginEl, editorView, userInfo, {
        onAccept: acceptHunk,
        onReject: rejectOrDeleteHunk,
        onResolveComment: resolveComment,
        onPostReply: postReply,
        onDismissStale: dismissStaleSuggestion,
      });

      // Load existing comments
      const existingComments = data.pendingComments || [];
      initComments(editorView, existingComments, (comments) => {
        updateCommentCards(comments);
      });
      if (existingComments.length > 0) {
        updateCommentCards(existingComments);
      }

      // Load existing replies
      const existingReplies = data.pendingReplies || [];
      if (existingReplies.length > 0) {
        updateReplies(existingReplies);
      }
    }

    // Reposition margin on scroll
    const scroller = host.querySelector('.cm-scroller');
    if (scroller && isSuggestOrReview) {
      scroller.addEventListener('scroll', repositionCards);
    }

    // Click inline decoration → focus margin card
    if (isSuggestOrReview) {
      host.addEventListener('click', (e) => {
        const target = e.target.closest('[data-hunk-id], [data-comment-id]');
        if (!target) return;
        const hunkId = target.getAttribute('data-hunk-id');
        const commentId = target.getAttribute('data-comment-id');
        if (hunkId) focusMarginCard('hunk', hunkId);
        else if (commentId) focusMarginCard('comment', commentId);
      });
    }

    // Expose for testing
    window.__editorView = editorView;

    editorView.focus();
  }

  function exitEditor() {
    setRevealFocusedLine(false);
    editorContainer.classList.remove('direct-editing');
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
    document.querySelector('.main').classList.remove('main--editing');
    editMode = null;
    window.location.reload();
  }

  // --- View Source toggle ---
  function toggleViewSource() {
    if (!editorView) return;
    viewSourceActive = !viewSourceActive;
    editorView.dispatch({
      effects: maskingCompartment.reconfigure(viewSourceActive ? [] : maskingExtension()),
    });
    const btn = document.getElementById('btn-view-source');
    if (btn) btn.classList.toggle('active', viewSourceActive);
  }

  // --- Direct edit save ---
  function showCommitModal() {
    const modal = document.getElementById('commit-modal');
    const input = document.getElementById('commit-message');
    if (!modal) return;
    input.value = '';
    modal.style.display = '';
    input.focus();
  }

  function hideCommitModal() {
    const modal = document.getElementById('commit-modal');
    if (modal) modal.style.display = 'none';
  }

  async function directSave(comment) {
    if (!editorView) return;
    const currentContent = editorView.state.doc.toString();

    hideCommitModal();

    const doneBtn = document.getElementById('btn-editor-done');
    doneBtn.disabled = true;
    doneBtn.textContent = 'Saving...';
    showToast('Committing to GitHub...', 'info');

    try {
      const res = await fetch('/api/suggestions/direct-edit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filePath: data.sessionFilePath, bookPath: data.bookRepoPath,
          content: currentContent, sha: data.contentSha,
          comment: comment || '',
        }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to save');
      }
      showToast('Changes committed successfully', 'success');
      setTimeout(() => window.location.reload(), 1500);
    } catch (err) {
      showToast('Error: ' + err.message, 'error');
      doneBtn.disabled = false;
      doneBtn.textContent = 'Done';
    }
  }

  // Commit modal event bindings
  document.getElementById('commit-cancel')?.addEventListener('click', hideCommitModal);
  document.getElementById('commit-confirm')?.addEventListener('click', () => {
    const msg = document.getElementById('commit-message')?.value?.trim() || '';
    directSave(msg);
  });
  document.getElementById('commit-modal')?.addEventListener('click', (e) => {
    if (e.target.classList.contains('editor-modal-overlay')) hideCommitModal();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      const modal = document.getElementById('commit-modal');
      if (modal && modal.style.display !== 'none') hideCommitModal();
    }
  });

  // --- Resolve a comment ---
  async function resolveComment(commentId) {
    try {
      const res = await fetch('/api/suggestions/comments/' + commentId + '/resolve', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
      });
      if (!res.ok) {
        const err = await res.json();
        showToast('Error: ' + (err.error || 'Failed to resolve'), 'error');
        return;
      }
      // Remove from local state
      const { removeComment } = await import('/static/js/editor-comments.js');
      removeComment(commentId);
      removeRepliesForParent(commentId);
    } catch (err) {
      showToast('Error: ' + err.message, 'error');
    }
  }

  // --- Post a reply to a suggestion or comment ---
  async function postReply(parentId, parentType, text) {
    const res = await fetch('/api/suggestions/replies', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        parentId, parentType, text,
        filePath: data.sessionFilePath,
        bookPath: data.bookRepoPath,
      }),
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Failed to post reply');
    }
    const result = await res.json();
    return {
      id: result.id,
      parentId,
      parentType,
      text,
      authorEmail: data.user ? data.user.email : '',
      authorName: data.user ? data.user.displayName : '',
      createdAt: new Date(),
    };
  }

  // --- Bind buttons ---
  document.getElementById('btn-suggest-edit')?.addEventListener('click', () => initEditor('suggest'));
  document.getElementById('btn-direct-edit')?.addEventListener('click', () => initEditor('direct'));
  document.getElementById('btn-review')?.addEventListener('click', () => initEditor('review'));
  document.getElementById('btn-view-source')?.addEventListener('click', toggleViewSource);
  document.getElementById('chk-line-numbers')?.addEventListener('change', (e) => {
    if (editorView) {
      editorView.dom.classList.toggle('cm-hide-gutters', !e.target.checked);
    }
  });
  document.getElementById('btn-editor-done')?.addEventListener('click', () => {
    if (editMode === 'direct') {
      const currentContent = editorView ? editorView.state.doc.toString() : originalContent;
      if (currentContent !== originalContent) {
        showCommitModal();
      } else {
        exitEditor();
      }
    } else {
      exitEditor();
    }
  });
}
