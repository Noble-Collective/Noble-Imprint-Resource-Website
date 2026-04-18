// Noble Imprint — CodeMirror 6 Editor (ES Module)
import { basicSetup, EditorView, EditorState, Compartment, markdown } from '/static/js/codemirror-bundle.js';
import { maskingExtension, setRevealFocusedLine } from '/static/js/editor-masking.js';
import {
  suggestionExtension, setOriginal, originalDocField, setHunksChangedCallback, getCurrentHunks,
  annotationRegistry, setAnnotations, removeAnnotation, addAnnotation, updateAnnotation, isRevert,
} from '/static/js/editor-suggestions.js';
import { initMarginPanel, updateMarginCards, updateCommentCards, updateReplies, removeRepliesForParent, repositionCards, focusMarginCard, animateCardRemoval, setCardStatus, disableAllCardActions, enableAllCardActions, injectStaleCard } from '/static/js/editor-margin.js';
import { commentExtension, initComments, getPendingFormatGroups, clearPendingFormatGroup } from '/static/js/editor-comments.js';
import { getRegistryAnnotations } from '/static/js/editor-suggestions.js';
import { constraintExtension, setZones, recomputeZones } from '/static/js/editor-constraints.js';

const data = window.__EDITOR_DATA;
if (data) {
  let editorView = null;
  let editMode = null; // 'suggest' | 'direct' | 'review'
  const originalContent = data.rawContent;

  // --- View Source toggle (compartments for masking + read-only) ---
  const maskingCompartment = new Compartment();
  const viewSourceCompartment = new Compartment();
  let viewSourceActive = false;

  const readingContent = document.getElementById('reading-content');
  const editorContainer = document.getElementById('editor-container');
  const editToolbar = document.getElementById('edit-toolbar');
  const modeLabel = document.getElementById('editor-mode-label');
  const saveStatus = document.getElementById('editor-save-status');

  // --- Auto-save state ---
  let savedHunks = new Map(); // hunkKey → firestore doc id
  let saveTimer = null;
  let saveFailCount = 0; // consecutive failures — show error after 2
  let fileStale = false;  // set when file-version check detects a SHA change
  let pollingInterval = null; // 30s polling for file changes + presence heartbeat
  let lastKnownSuggestionCount = (data.pendingSuggestions || []).length;

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
    if (fileStale) return; // file changed underneath us — don't save stale data
    let hadSaveError = false;

    // Check file version before saving — detect if the file changed on GitHub
    // since we loaded it (e.g., another user accepted a suggestion).
    // Advisory only: on failure/timeout, proceed with the save.
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 3000);
      const vRes = await fetch('/api/suggestions/file-version?filePath=' + encodeURIComponent(data.sessionFilePath), { signal: controller.signal });
      clearTimeout(timeout);
      if (vRes.ok) {
        const vData = await vRes.json();
        if (vData.sha && data.contentSha && vData.sha !== data.contentSha) {
          fileStale = true;
          console.warn('[AUTO-SAVE] file version changed:', data.contentSha, '→', vData.sha);
          showStaleBanner('This file was updated by another user.');
          return;
        }
      }
    } catch { /* timeout or network error — proceed with save */ }

    // Build set of current hunk position ranges
    const currentKeys = new Set(hunks.map(hunkKey));

    // Delete saved hunks that no longer exist in the diff.
    // Registry entries that were loaded from server are always protected.
    // Session-created registry entries are protected UNLESS the document matches
    // the original (user undid all edits) — in that case, clean them up.
    const registry = editorView ? editorView.state.field(annotationRegistry) : new Map();
    const docMatchesOriginal = hunks.length === 0 && editorView &&
      editorView.state.doc.toString() === editorView.state.field(originalDocField);

    for (const [key, docId] of savedHunks) {
      const regEntry = registry.get(docId);
      if (regEntry) {
        // Server-loaded entries: always protected
        if (regEntry.loadedFromServer) continue;
        // Session-created entries: protected unless doc matches original (full undo)
        if (!docMatchesOriginal) continue;
      }

      const [kFrom, kTo] = key.split(':').map(Number);
      const stillExists = hunks.some(h => h.originalFrom <= kTo + 1 && h.originalTo >= kFrom - 1);
      if (!stillExists) {
        try {
          await fetch('/api/suggestions/hunk/' + docId, { method: 'DELETE' });
          savedHunks.delete(key);
          if (editorView && registry.has(docId)) {
            editorView.dispatch({ effects: removeAnnotation.of(docId) });
          }
        } catch (err) {
          console.warn('[AUTO-SAVE] delete failed:', err.message);
        }
      }
    }

    // Check for pending format groups — tag linked hunks
    const formatGroups = getPendingFormatGroups();

    // Create or update hunks
    for (const hunk of hunks) {
      const key = hunkKey(hunk);
      // Use the CURRENT original (updated by refreshFromGitHub after accepts),
      // not the stale page-load originalContent. Hunk positions are relative to
      // the current originalDocField, so context must come from the same version.
      const currentOriginal = editorView.state.field(originalDocField);
      const ctx = extractContext(currentOriginal, hunk.originalFrom, hunk.originalTo);
      const hunkData = {
        type: hunk.type, originalFrom: hunk.originalFrom, originalTo: hunk.originalTo,
        originalText: hunk.originalText, newText: hunk.newText, ...ctx,
      };

      // Tag formatting hunks with a linkedGroup so they're treated as one change.
      // Match by marker text AND position proximity — the 2 hunks for a bold/italic
      // wrap bracket the original text position (one just before, one just after).
      if (hunk.type === 'insertion' && formatGroups.length > 0) {
        for (const fg of formatGroups) {
          if (hunk.newText !== fg.marker) continue;
          if (fg._matchCount >= 2) continue; // Already matched 2 hunks for this group
          // Hunk's originalFrom should be near the format group's text range
          const origStart = fg.origFrom;
          const origEnd = fg.origFrom + fg.textLen;
          if (hunk.originalFrom >= origStart - 2 && hunk.originalFrom <= origEnd + 2) {
            hunkData.linkedGroup = fg.groupId;
            hunkData.linkedLabel = fg.label;
            fg._matchCount = (fg._matchCount || 0) + 1;
            break;
          }
        }
      }

      // Check exact key match first, then overlapping match
      const existing = savedHunks.has(key)
        ? { key, docId: savedHunks.get(key) }
        : findOverlappingSavedHunk(hunk);

      if (existing) {
        // Don't overwrite server-loaded suggestions — the diff engine's character-level
        // view (e.g., insertion of "EXTRA") differs from the Firestore replacement
        // (e.g., "philosophy" → "philosophyEXTRA"). Updating would corrupt the data.
        const regEntry = editorView ? editorView.state.field(annotationRegistry).get(existing.docId) : null;
        if (regEntry && regEntry.loadedFromServer) continue;

        // Update existing Firestore record
        try {
          const updateRes = await fetch('/api/suggestions/hunk/' + existing.docId, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(hunkData),
          });
          if (!updateRes.ok) throw new Error('HTTP ' + updateRes.status);
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
        } catch (err) {
          hadSaveError = true;
          console.warn('[AUTO-SAVE] update failed:', err.message);
        }
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
          if (!res.ok) throw new Error('HTTP ' + res.status);
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
                loadedFromServer: false,
                ...(hunkData.linkedGroup ? { linkedGroup: hunkData.linkedGroup, linkedLabel: hunkData.linkedLabel } : {}),
              }) });

              // Legacy: keep pendingSuggestions in sync for findFirestoreId fallback
              if (!data.pendingSuggestions) data.pendingSuggestions = [];
              data.pendingSuggestions.push({
                id: result.id,
                type: hunk.type,
                originalText: hunk.originalText || '',
                newText: hunk.newText || '',
                originalFrom: hunk.originalFrom,
                originalTo: hunk.originalTo,
                authorEmail: data.user ? data.user.email : '',
                authorName: data.user ? data.user.displayName : '',
                ...ctx,
                ...(hunkData.linkedGroup ? { linkedGroup: hunkData.linkedGroup, linkedLabel: hunkData.linkedLabel } : {}),
              });
            }
        } catch (err) {
          hadSaveError = true;
          console.warn('[AUTO-SAVE] create failed:', err.message);
        }
      }
    }

    // Clear pending format groups only if they were actually matched to hunks
    for (const fg of formatGroups) {
      const wasMatched = hunks.some(h => h.type === 'insertion' && h.newText === fg.marker);
      if (wasMatched) clearPendingFormatGroup(fg.groupId);
    }

    if (hadSaveError) {
      saveFailCount++;
      if (saveFailCount >= 2 && saveStatus) {
        saveStatus.textContent = 'Save failed';
        saveStatus.classList.add('save-error');
      }
    } else {
      saveFailCount = 0;
      if (saveStatus) {
        saveStatus.classList.remove('save-error');
        saveStatus.textContent = 'Saved';
        setTimeout(() => { saveStatus.textContent = ''; }, 2000);
      }
    }
  }

  // --- Find the Firestore ID for a hunk ---
  function findFirestoreId(hunkId) {
    // Get the actual hunk object from the diff engine
    const hunks = getCurrentHunks();
    const hunk = hunks.find(h => h.id === hunkId);

    // Check savedHunks Map first (direct mapping from auto-save)
    if (hunk) {
      const key = hunkKey(hunk);
      if (savedHunks.has(key)) return savedHunks.get(key);
    }

    // Check annotation registry by content match
    if (hunk && editorView) {
      const registry = editorView.state.field(annotationRegistry);
      for (const [id, a] of registry) {
        if (a.kind !== 'suggestion') continue;
        if (a.originalText === hunk.originalText && a.newText === hunk.newText) return id;
        if (a.type === hunk.type && a.originalText === hunk.originalText) return id;
      }
    }

    // Direct ID match in registry
    if (editorView) {
      const registry = editorView.state.field(annotationRegistry);
      if (registry.has(hunkId)) return hunkId;
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

  // --- Stale file banner ---
  function showStaleBanner(message) {
    const banner = document.getElementById('editor-stale-banner');
    const bannerText = document.getElementById('stale-banner-text');
    if (banner && bannerText) {
      bannerText.textContent = message;
      banner.style.display = '';
    }
  }

  // --- Polling for file changes + presence heartbeat (Steps 4 & 5) ---
  function startPolling() {
    if (pollingInterval) return;
    // Send initial presence heartbeat + fetch other editors
    sendPresenceHeartbeat();
    updatePresenceDisplay();
    pollingInterval = setInterval(pollForChanges, 30000);
  }

  function stopPolling() {
    if (pollingInterval) {
      clearInterval(pollingInterval);
      pollingInterval = null;
    }
    // Exit presence on stop
    sendPresenceExit();
  }

  async function pollForChanges() {
    if (!data.sessionFilePath) return;
    try {
      // File version check
      const vRes = await fetch('/api/suggestions/file-version?filePath=' + encodeURIComponent(data.sessionFilePath));
      if (vRes.ok) {
        const vData = await vRes.json();

        // Check for file SHA change
        if (vData.sha && data.contentSha && vData.sha !== data.contentSha && !fileStale) {
          fileStale = true;
          showStaleBanner('This file was updated by another user.');
        }

        // Check for new suggestions (only if file itself hasn't changed)
        if (!fileStale && vData.pendingSuggestionCount > lastKnownSuggestionCount) {
          const newCount = vData.pendingSuggestionCount - lastKnownSuggestionCount;
          showStaleBanner(newCount + ' new suggestion' + (newCount > 1 ? 's were' : ' was') + ' added.');
        }
      }

      // Presence heartbeat
      sendPresenceHeartbeat();

      // Fetch active editors and update display
      updatePresenceDisplay();
    } catch (err) {
      console.warn('[POLL] error:', err.message);
    }
  }

  async function sendPresenceHeartbeat() {
    if (!data.sessionFilePath) return;
    try {
      await fetch('/api/suggestions/presence', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filePath: data.sessionFilePath }),
      });
    } catch (err) {
      console.warn('[PRESENCE] heartbeat failed:', err.message);
    }
  }

  function sendPresenceExit() {
    if (!data.sessionFilePath) return;
    // Use sendBeacon for reliability on tab close
    const body = JSON.stringify({ filePath: data.sessionFilePath });
    if (navigator.sendBeacon) {
      navigator.sendBeacon('/api/suggestions/presence/exit', new Blob([body], { type: 'application/json' }));
    } else {
      fetch('/api/suggestions/presence', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body,
        keepalive: true,
      }).catch(() => {});
    }
  }

  async function updatePresenceDisplay() {
    if (!data.sessionFilePath) return;
    const container = document.getElementById('editor-presence');
    if (!container) return;
    try {
      const res = await fetch('/api/suggestions/presence?filePath=' + encodeURIComponent(data.sessionFilePath));
      if (!res.ok) return;
      const { editors } = await res.json();
      const currentEmail = data.user ? data.user.email : '';
      // Filter out self
      const others = editors.filter(e => e.email !== currentEmail);
      container.innerHTML = others.map(e => {
        const initials = getInitials(e.displayName || e.email);
        return '<span class="presence-avatar" title="' + escapeHtml(e.displayName || e.email) + '">' + escapeHtml(initials) + '</span>';
      }).join('');
    } catch (err) {
      console.warn('[PRESENCE] display update failed:', err.message);
    }
  }

  function getInitials(name) {
    const parts = name.trim().split(/\s+/);
    if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    return name.slice(0, 2).toUpperCase();
  }

  function escapeHtml(str) {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // Stale banner: reload button
  document.getElementById('stale-banner-reload')?.addEventListener('click', async () => {
    await refreshFromGitHub();
    lastKnownSuggestionCount = (data.pendingSuggestions || []).length;
    const banner = document.getElementById('editor-stale-banner');
    if (banner) banner.style.display = 'none';
  });

  // Stale banner: dismiss button
  document.getElementById('stale-banner-dismiss')?.addEventListener('click', () => {
    const banner = document.getElementById('editor-stale-banner');
    if (banner) banner.style.display = 'none';
  });

  // Send presence exit on tab close
  window.addEventListener('beforeunload', sendPresenceExit);

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
    // Save scroll position to restore after rebuild
    const scroller = editorView?.scrollDOM;
    const savedScrollTop = scroller ? scroller.scrollTop : 0;
    try {
      const freshRes = await fetch('/api/suggestions/content?filePath=' + encodeURIComponent(data.sessionFilePath));
      if (!freshRes.ok) { hideRefreshOverlay(); return; }
      const fresh = await freshRes.json();

      const newOriginal = fresh.content;
      const remainingSuggestions = fresh.pendingSuggestions || [];
      const newWorkingDoc = buildWorkingDoc(newOriginal, remainingSuggestions);

      console.log('[REFRESH] remaining suggestions:', remainingSuggestions.length,
        remainingSuggestions.map(s => s.id + ' ' + s.type + ' "' + (s.originalText || '').slice(0, 20) + '" resolved:' + s.resolvedFrom + '-' + s.resolvedTo));
      console.log('[REFRESH] newOriginal length:', newOriginal.length, 'workingDoc length:', newWorkingDoc.length, 'same:', newOriginal === newWorkingDoc);

      // Clear constraint zones first — the edit protection transactionFilter
      // would block a full-document replacement since position 0 is outside any zone
      editorView.dispatch({ effects: setZones.of([]) });

      // Replace the editor document and original
      editorView.dispatch({
        changes: { from: 0, to: editorView.state.doc.length, insert: newWorkingDoc },
        effects: setOriginal.of(newOriginal),
      });

      // CRITICAL: A full document replacement makes mapPos meaningless — all positions
      // collapse to 0 or end-of-doc. We must rebuild the registry from scratch with
      // fresh server-resolved positions, and reset savedHunks so auto-save starts clean.
      savedHunks.clear();

      // Repopulate registry with shifted positions + rebuild savedHunks
      const existingComments = fresh.pendingComments || [];
      const registryEntries = buildShiftedRegistryEntries(remainingSuggestions, existingComments, newWorkingDoc);
      // Rebuild savedHunks using the server-resolved positions (position.from/to).
      // The diff engine produces hunks with originalFrom relative to the CURRENT file
      // (originalDocField), which matches the server's resolvedFrom — not the Firestore
      // originalFrom which may be stale from the pre-accept file.
      for (const s of remainingSuggestions) {
        if (s.resolvedStale) continue;
        const from = s.resolvedFrom != null ? s.resolvedFrom : s.originalFrom;
        const to = s.type === 'insertion' ? from : from + (s.originalText || '').length;
        savedHunks.set(from + ':' + to, s.id);
      }
      editorView.dispatch({ effects: setAnnotations.of(registryEntries) });
      console.log('[REFRESH] rebuilt registry with', registryEntries.length, 'entries, savedHunks:', savedHunks.size);

      // Restore constraint zones from the new document
      if (editMode === 'suggest') {
        const zones = recomputeZones(editorView.state.doc);
        editorView.dispatch({ effects: setZones.of(zones) });
      }

      // Update local data — reset stale flag since we now have fresh content
      data.contentSha = fresh.sha || data.contentSha;
      fileStale = false;
      lastKnownSuggestionCount = remainingSuggestions.length;
      data.pendingSuggestions = remainingSuggestions;
      data.pendingComments = existingComments;
      data.pendingReplies = fresh.pendingReplies || [];

      // Refresh comment and reply cards (don't re-init — that overwrites the
      // callback with wrong args and adds duplicate event listeners)
      if (existingComments.length > 0) updateCommentCards(existingComments);
      updateReplies(fresh.pendingReplies || []);
    } catch (err) {
      console.error('[REFRESH] error:', err.message, err.stack);
    }
    // Restore scroll position after rebuild
    if (scroller && savedScrollTop) {
      requestAnimationFrame(() => { scroller.scrollTop = savedScrollTop; });
    }
    hideRefreshOverlay();
  }

  // --- Accept a hunk via API ---
  let acceptingInProgress = false;
  async function acceptHunk(hunkId) {
    if (acceptingInProgress) return;
    acceptingInProgress = true;

    // Check for linked hunks (e.g., bold/italic formatting = 2 insertions)
    const card = document.querySelector('.margin-card[data-hunk-id="' + hunkId + '"]');
    const linkedIds = card?.dataset.linkedIds?.split(',').filter(Boolean) || [];

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
          // Save stale card data before refresh rebuilds the margin panel
          // Try hunk first, fall back to card data attributes (for registry entries)
          const card = document.querySelector('.margin-card[data-hunk-id="' + hunkId + '"]');
          const staleData = {
            hunkId,
            origText: hunk?.originalText || card?.dataset.origText || '',
            newText: hunk?.newText || card?.dataset.newText || '',
            type: hunk?.type || card?.dataset.hunkType || '',
          };
          // Refresh to show the latest content from GitHub
          console.log('[ACCEPT] stale — refreshing from GitHub to show latest content');
          await refreshFromGitHub();
          // Re-inject stale card after refresh (the refresh nuked it)
          injectStaleCard(staleData, dismissStaleSuggestion);
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

      // Accept linked hunks atomically (e.g., bold/italic = 2 insertions)
      for (const lid of linkedIds) {
        if (lid !== firestoreId) {
          try {
            await fetch('/api/suggestions/hunk/' + lid + '/accept', {
              method: 'PUT', headers: { 'Content-Type': 'application/json' },
            });
          } catch { /* linked hunk may already be accepted */ }
        }
      }

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
  let isDiscarding = false; // Guard: suppress auto-save during multi-dispatch discard
  async function rejectOrDeleteHunk(hunkId) {
    const firestoreId = findFirestoreId(hunkId);
    console.log('[DISCARD] hunkId:', hunkId, 'firestoreId:', firestoreId);

    // Check for linked hunks (e.g., bold/italic = 2 insertions)
    const card = document.querySelector('.margin-card[data-hunk-id="' + hunkId + '"]');
    const linkedIds = card?.dataset.linkedIds?.split(',').filter(Boolean) || [];

    // Suppress auto-save during discard — the removeAnnotation and document rebuild
    // happen in separate dispatches, and between them the draftPlugin would see the
    // diff as "new" and auto-save would re-create the suggestion we're deleting.
    isDiscarding = true;

    // Remove from the annotation registry (including linked hunks)
    if (firestoreId) {
      editorView.dispatch({ effects: removeAnnotation.of(firestoreId) });
    }
    for (const lid of linkedIds) {
      if (lid !== firestoreId) {
        editorView.dispatch({ effects: removeAnnotation.of(lid) });
      }
    }

    // Rebuild the document from scratch: original + remaining registry suggestions
    // This is safe — other suggestions' positions are preserved because we rebuild
    // from the registry rather than reverting text and hoping the diff recomputes correctly.
    if (editorView && editMode === 'suggest') {
      const registry = editorView.state.field(annotationRegistry);
      const remainingSuggestions = [];
      const remainingComments = [];
      for (const [, a] of registry) {
        if (a.kind === 'suggestion') remainingSuggestions.push(a);
        else if (a.kind === 'comment') remainingComments.push(a);
      }
      const currentOriginal = editorView.state.field(originalDocField);
      const newWorkingDoc = buildWorkingDoc(currentOriginal, remainingSuggestions);

      // Clear zones, replace document, restore zones
      editorView.dispatch({ effects: setZones.of([]) });
      editorView.dispatch({
        changes: { from: 0, to: editorView.state.doc.length, insert: newWorkingDoc },
        annotations: isRevert.of(true),
      });

      // CRITICAL: Full doc replacement makes mapPos meaningless — all registry
      // positions collapsed to 0. Rebuild the registry with correct working-doc positions.
      const rebuiltEntries = buildShiftedRegistryEntries(remainingSuggestions, remainingComments, newWorkingDoc);
      editorView.dispatch({ effects: setAnnotations.of(rebuiltEntries) });

      const zones = recomputeZones(editorView.state.doc);
      editorView.dispatch({ effects: setZones.of(zones) });
    }

    isDiscarding = false;

    // Delete or reject from Firestore immediately (including linked hunks)
    const allIds = [firestoreId, ...linkedIds.filter(lid => lid !== firestoreId)].filter(Boolean);
    for (const id of allIds) {
      try {
        if (editMode === 'review') {
          await fetch('/api/suggestions/hunk/' + id + '/reject', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
          });
        } else {
          await fetch('/api/suggestions/hunk/' + id, { method: 'DELETE' });
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
    // Clean up savedHunks — check both draft hunks and direct firestoreId lookup
    if (firestoreId) {
      for (const [key, docId] of savedHunks) {
        if (docId === firestoreId) { savedHunks.delete(key); break; }
      }
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
        // Fallback: use originalFrom (position in the original file)
        if (insertAt < 0 && s.originalFrom != null && s.originalFrom >= 0) {
          insertAt = s.originalFrom;
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

  // --- Build registry entries with correct working-doc positions ---
  // buildWorkingDoc applies suggestions end-to-start, which shifts positions.
  // This function computes the correct positions for BOTH suggestions and comments
  // in the working doc by tracking cumulative shifts from suggestion applications.
  function buildShiftedRegistryEntries(suggestions, comments, workingDocContent) {
    const entries = [];
    const validSuggs = (suggestions || []).filter(s => !s.resolvedStale);

    // Sort suggestions by ascending original-file position
    const sorted = [...validSuggs].sort((a, b) => {
      const posA = a.resolvedFrom != null ? a.resolvedFrom : a.originalFrom;
      const posB = b.resolvedFrom != null ? b.resolvedFrom : b.originalFrom;
      return posA - posB;
    });

    // Build suggestions with cumulative shift — each suggestion's working-doc
    // position is shifted only by PRIOR suggestions, not its own delta.
    let cumulativeShift = 0;
    for (const s of sorted) {
      const origPos = s.resolvedFrom != null ? s.resolvedFrom : s.originalFrom;
      const origLen = (s.originalText || '').length;
      const newLen = (s.newText || '').length;
      const wp = origPos + cumulativeShift;

      let curFrom, curTo;
      if (s.type === 'insertion') { curFrom = wp; curTo = wp + newLen; }
      else if (s.type === 'deletion') { curFrom = wp; curTo = wp; }
      else { curFrom = wp; curTo = wp + newLen; }
      entries.push({
        id: s.id, kind: 'suggestion', type: s.type,
        originalText: s.originalText || '', newText: s.newText || '',
        originalFrom: s.originalFrom, originalTo: s.originalTo,
        currentFrom: curFrom, currentTo: curTo,
        authorEmail: s.authorEmail, authorName: s.authorName,
        firestoreId: s.id, loadedFromServer: true,
      });

      // Update cumulative shift for subsequent suggestions
      let delta = 0;
      if (s.type === 'insertion') delta = newLen;
      else if (s.type === 'deletion') delta = -origLen;
      else delta = newLen - origLen;
      cumulativeShift += delta;
    }

    // Comments — shifted by ALL suggestions (full cumulative shift)
    // Rebuild shift table for comment position computation
    const shifts = [];
    for (const s of sorted) {
      const origPos = s.resolvedFrom != null ? s.resolvedFrom : s.originalFrom;
      const origLen = (s.originalText || '').length;
      const newLen = (s.newText || '').length;
      let delta = 0;
      if (s.type === 'insertion') delta = newLen;
      else if (s.type === 'deletion') delta = -origLen;
      else delta = newLen - origLen;
      shifts.push({ pos: origPos, delta });
    }
    function toWorkingPos(origFilePos) {
      let shift = 0;
      for (const s of shifts) {
        if (s.pos < origFilePos) shift += s.delta;
        else break;
      }
      return origFilePos + shift;
    }

    for (const c of (comments || [])) {
      if (c.resolvedStale) continue;
      const from = c.resolvedFrom != null ? c.resolvedFrom : (c.from != null ? c.from : c.originalFrom);
      const to = c.resolvedTo != null ? c.resolvedTo : (c.to != null ? c.to : c.originalTo);

      // Find the comment's actual position in the working doc by searching for its text.
      // The shift-based computation (toWorkingPos) can drift by a few chars when multiple
      // suggestions interact. Direct text search is more reliable for comments.
      let curFrom = toWorkingPos(from);
      let curTo = toWorkingPos(to);
      if (workingDocContent && c.selectedText) {
        // Use context to find the correct occurrence if text appears multiple times
        const shiftedPos = curFrom;
        const searchStart = Math.max(0, shiftedPos - 50);
        const searchEnd = Math.min(workingDocContent.length, shiftedPos + c.selectedText.length + 50);
        const nearbyIdx = workingDocContent.indexOf(c.selectedText, searchStart);
        if (nearbyIdx >= 0 && nearbyIdx < searchEnd) {
          curFrom = nearbyIdx;
          curTo = nearbyIdx + c.selectedText.length;
        } else {
          // Fallback: global search
          const globalIdx = workingDocContent.indexOf(c.selectedText);
          if (globalIdx >= 0) {
            curFrom = globalIdx;
            curTo = globalIdx + c.selectedText.length;
          }
        }
      }

      entries.push({
        id: c.id, kind: 'comment',
        selectedText: c.selectedText || '', commentText: c.commentText || '',
        currentFrom: curFrom, currentTo: curTo,
        originalFrom: from, originalTo: to,
        authorEmail: c.authorEmail, authorName: c.authorName,
        firestoreId: c.id, loadedFromServer: true,
      });
    }

    return entries;
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

    // Helper: read registry and update margin cards with BOTH registry + diff data
    function updateRegistryCards() {
      if (!editorView) return;
      const registry = editorView.state.field(annotationRegistry);
      const regComments = [];
      for (const [, a] of registry) {
        if (a.kind === 'comment') regComments.push(a);
      }
      updateCommentCards(regComments);
      updateMarginCards(buildMarginHunks(getCurrentHunks()));
    }

    // Build margin hunks from BOTH registry suggestions and draft hunks
    function buildMarginHunks(draftHunks) {
      if (!editorView) return draftHunks;
      const registry = editorView.state.field(annotationRegistry);
      const registryHunks = [];
      for (const [, a] of registry) {
        if (a.kind !== 'suggestion') continue;
        // Convert registry annotation to hunk-like object for the margin panel
        registryHunks.push({
          id: a.id,
          type: a.type,
          originalText: a.originalText,
          newText: a.newText,
          currentFrom: a.currentFrom,
          currentTo: a.currentTo,
          currentPos: a.currentFrom, // for deletions
        });
      }
      // Merge: registry hunks first (sorted by position), then draft hunks
      const all = [...registryHunks, ...draftHunks];
      all.sort((a, b) => (a.currentFrom || a.currentPos || 0) - (b.currentFrom || b.currentPos || 0));
      return all;
    }

    // Wire up margin panel callback
    if (isSuggestOrReview) {
      setHunksChangedCallback((hunks) => {
        console.log('[CALLBACK] onHunksChanged received', hunks.length, 'draft hunks');
        if (editorView) {
          const allHunks = buildMarginHunks(hunks);
          console.log('[CALLBACK] margin will show', allHunks.length, 'total cards (draft + registry)');
          updateMarginCards(allHunks);
          // Also update comment cards from registry (positions may have shifted)
          const registry = editorView.state.field(annotationRegistry);
          const regComments = [];
          for (const [, a] of registry) {
            if (a.kind === 'comment') regComments.push(a);
          }
          updateCommentCards(regComments);
        }
        if (mode === 'suggest' && !isDiscarding) {
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

    // In direct mode, update Done button text to "Save Changes" when content differs
    const directEditButtonUpdater = mode === 'direct' ? EditorView.updateListener.of((update) => {
      if (update.docChanged) {
        const doneBtn = document.getElementById('btn-editor-done');
        if (doneBtn) {
          const changed = update.view.state.doc.toString() !== originalContent;
          doneBtn.textContent = changed ? 'Save Changes' : 'Done';
        }
      }
    }) : [];

    // Line number gutter hiding — re-apply on every view update in case CM6 recreates the element
    const gutterHider = EditorView.updateListener.of(() => {
      const chk = document.getElementById('chk-line-numbers');
      if (chk && !chk.checked) {
        const gutters = editorView?.dom?.querySelector('.cm-gutters');
        if (gutters && gutters.style.display !== 'none') gutters.style.display = 'none';
      }
    });

    const extensions = [
      basicSetup,
      markdown(),
      EditorView.lineWrapping,
      maskingCompartment.of(maskingExtension()),
      viewSourceCompartment.of([]),
      ...(isSuggestOrReview ? [suggestionExtension(), commentExtension()] : []),
      ...(isConstrained ? [constraintExtension(), zoneUpdater] : []),
      ...(mode === 'review' ? [EditorState.readOnly.of(true)] : []),
      directEditButtonUpdater,
      gutterHider,
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

      // Populate annotation registry with suggestions + comments.
      // Positions shifted to working-doc coordinates (buildWorkingDoc shifts content).
      const existingComments = data.pendingComments || [];
      const registryEntries = buildShiftedRegistryEntries(existingSuggestions, existingComments, workingDoc);
      if (registryEntries.length > 0) {
        editorView.dispatch({ effects: setAnnotations.of(registryEntries) });
      }

      // Populate savedHunks so auto-save knows these suggestions already exist
      // in Firestore. Without this, the diff engine's draft hunks for loaded
      // suggestions leak through and auto-save re-creates them as duplicates.
      // Use the server-resolved positions (resolvedFrom) for keys — they match
      // what the diff engine produces (relative to the current originalDocField).
      savedHunks.clear();
      for (const s of existingSuggestions) {
        if (s.resolvedStale) continue;
        const from = s.resolvedFrom != null ? s.resolvedFrom : s.originalFrom;
        const to = s.type === 'insertion' ? from : from + (s.originalText || '').length;
        savedHunks.set(from + ':' + to, s.id);
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

      // Init comment popup UI (no module array — comments are in the registry)
      initComments(editorView, (commentData) => {
        // Compute original-file position for the comment so it survives
        // discard rebuilds (which need original-file positions, not working-doc)
        const original = editorView.state.field(originalDocField);
        if (original && commentData.selectedText) {
          const origIdx = original.indexOf(commentData.selectedText);
          if (origIdx >= 0) {
            commentData.originalFrom = origIdx;
            commentData.originalTo = origIdx + commentData.selectedText.length;
          }
        }
        // Add new comment to registry
        editorView.dispatch({ effects: addAnnotation.of(commentData) });
        // Notify margin panel
        updateRegistryCards();
      });

      // Load existing comments and replies into margin panel.
      // Defer the first render so CM6 has finished layout — coordsAtPos() needs
      // final line heights to compute correct card positions.
      const existingComments = data.pendingComments || [];
      const existingReplies = data.pendingReplies || [];
      requestAnimationFrame(() => {
        if (existingComments.length > 0) updateCommentCards(existingComments);
        if (existingReplies.length > 0) updateReplies(existingReplies);
        // Trigger a margin card refresh for registry suggestions too
        updateRegistryCards();
      });
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

    // Sync line numbers visibility with checkbox state
    const chkLineNumbers = document.getElementById('chk-line-numbers');
    if (chkLineNumbers && !chkLineNumbers.checked) {
      const gutters = editorView.dom.querySelector('.cm-gutters');
      if (gutters) gutters.style.display = 'none';
    }

    // Start polling for file changes + presence heartbeat
    if (isSuggestOrReview) startPolling();

    // Expose for testing
    window.__editorView = editorView;
    window.__annotationRegistry = annotationRegistry;
    window.__originalDocField = originalDocField;
    window.__savedHunks = savedHunks;

    editorView.focus();
  }

  function exitEditor() {
    stopPolling();
    setRevealFocusedLine(false);
    editorContainer.classList.remove('direct-editing');
    // Reset Done button text
    const doneBtn = document.getElementById('btn-editor-done');
    if (doneBtn) doneBtn.textContent = 'Done';
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
    const effects = [
      maskingCompartment.reconfigure(viewSourceActive ? [] : maskingExtension()),
    ];
    // In suggest mode, make editor read-only when viewing source
    if (editMode === 'suggest') {
      effects.push(viewSourceCompartment.reconfigure(
        viewSourceActive ? EditorState.readOnly.of(true) : []
      ));
    }
    editorView.dispatch({ effects });
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
      // Remove from registry (decorations will disappear automatically)
      if (editorView) {
        editorView.dispatch({ effects: removeAnnotation.of(commentId) });
      }
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
      const gutters = editorView.dom.querySelector('.cm-gutters');
      if (gutters) gutters.style.display = e.target.checked ? '' : 'none';
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
