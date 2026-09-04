/**
 * ajax-nav.js — AJAX session navigation for continuous audiobook playback.
 *
 * Only used for audio auto-advance: when a chapter's audio finishes, the
 * ended handler calls navigateToSession() to swap content without a full
 * page reload, keeping the <audio> element alive so the browser's
 * gesture-unlock persists on mobile.
 *
 * Manual navigation (sidebar clicks, prev/next arrows, breadcrumbs) always
 * does a full page reload to avoid breaking the editor system.
 *
 * Falls back to full page reload on error.
 */

(function () {
  'use strict';

  var main = document.querySelector('main.main');
  if (!main) return; // not a session page

  var bookUrl = main.dataset.bookUrl;
  if (!bookUrl) return; // no book context — not a session page

  var currentAbortController = null;
  var loadingTimer = null;
  var progressBar = null;

  // --- Loading indicator ---

  function showLoadingBar() {
    if (progressBar) return;
    progressBar = document.createElement('div');
    progressBar.className = 'ajax-nav-progress';
    document.body.appendChild(progressBar);
    // Trigger reflow then animate
    progressBar.offsetWidth; // force reflow
    progressBar.classList.add('ajax-nav-progress--active');
  }

  function hideLoadingBar() {
    if (loadingTimer) { clearTimeout(loadingTimer); loadingTimer = null; }
    if (progressBar) {
      progressBar.classList.add('ajax-nav-progress--done');
      var bar = progressBar;
      setTimeout(function () { if (bar.parentNode) bar.parentNode.removeChild(bar); }, 300);
      progressBar = null;
    }
  }

  // --- URL helpers ---

  /** Check if a URL is a session within the current book */
  function isSessionUrl(href) {
    if (!href) return false;
    // Must start with bookUrl + one more segment
    if (!href.startsWith(bookUrl + '/')) return false;
    // The part after bookUrl should be a single slug (no more slashes)
    var rest = href.substring(bookUrl.length + 1);
    return rest.length > 0 && rest.indexOf('/') === -1 && rest.indexOf('#') === -1;
  }

  /** Convert a page URL to the API endpoint URL */
  function toApiUrl(pageUrl) {
    // pageUrl like /series/subseries/book/session → /api/session-data/series/subseries/book/session
    return '/api/session-data' + pageUrl;
  }

  // --- DOM swap ---

  function swapContent(data) {
    // 1. Sidebar inner content
    var sidebar = document.querySelector('.sidebar');
    if (sidebar && data.sidebarHtml) {
      sidebar.innerHTML = data.sidebarHtml;
    }

    // 2. Mobile TOC label
    var mobileLabel = document.querySelector('.mobile-toc-label');
    if (mobileLabel && data.mobileLabel) {
      mobileLabel.textContent = data.mobileLabel;
    }

    // 3. Breadcrumb
    var breadcrumb = document.querySelector('.breadcrumb');
    if (breadcrumb && data.breadcrumbHtml) {
      breadcrumb.innerHTML = data.breadcrumbHtml;
    }

    // 4. Edit toolbar — replace or remove
    var oldToolbar = document.getElementById('edit-toolbar');
    if (oldToolbar) oldToolbar.remove();
    if (data.editToolbarHtml && data.editToolbarHtml.trim()) {
      var readingTop = document.querySelector('.reading-top');
      if (readingTop) {
        readingTop.insertAdjacentHTML('afterend', data.editToolbarHtml);
      }
    }

    // 5. Reading content (session HTML + session nav)
    var readingContent = document.getElementById('reading-content');
    if (readingContent) {
      readingContent.innerHTML =
        '<div class="session-content">' + data.sessionHtml + '</div>' +
        '<div class="session-nav">' + data.sessionNavHtml + '</div>';
    }

    // 6. Audio FAB data attributes
    var fab = document.getElementById('audio-fab');
    if (fab && data.audioSession) {
      fab.dataset.bookPath = data.bookPath;
      fab.dataset.audioFile = data.audioSession.audioFile;
      fab.dataset.timestampsFile = data.audioSession.timestampsFile || '';
      fab.dataset.duration = data.audioSession.durationSeconds || 0;
      fab.dataset.nextUrl = data.nextSessionUrl || '';
      // Update duration display
      var durationEl = document.getElementById('audio-duration');
      if (durationEl && data.audioDurationFormatted) {
        durationEl.textContent = data.audioDurationFormatted;
      }
    } else if (fab && !data.audioSession) {
      // New session has no audio — update next URL at minimum
      fab.dataset.nextUrl = data.nextSessionUrl || '';
    }

    // 7. Update book URL on main (in case subseries changes — unlikely but safe)
    if (data.bookUrl) {
      main.dataset.bookUrl = data.bookUrl;
      bookUrl = data.bookUrl;
    }
  }

  // --- Navigation ---

  async function navigateToSession(url, options) {
    options = options || {};

    // Abort any in-flight request
    if (currentAbortController) {
      currentAbortController.abort();
    }
    currentAbortController = new AbortController();

    // Show loading indicator after 300ms (avoids flash for fast loads)
    loadingTimer = setTimeout(showLoadingBar, 300);

    try {
      // If editor is active, bail out to full page reload — AJAX swap breaks editor state
      if (window.__editorView) {
        if (options.autoplay) {
          localStorage.setItem('audio-autoplay', 'true');
        }
        window.location.href = url;
        return;
      }

      // Fetch session data
      var apiUrl = toApiUrl(url);
      var res = await fetch(apiUrl, { signal: currentAbortController.signal });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      var data = await res.json();
      if (data.error) throw new Error(data.error);

      // Swap DOM
      swapContent(data);

      // Update browser history (unless this is a popstate-triggered navigation)
      if (!options._popstate) {
        history.pushState({ ajaxNav: true, url: url }, '', url);
      }

      // Update document title
      document.title = data.title;

      // Scroll to top
      window.scrollTo(0, 0);

      // Reinit mobile TOC and sidebar toggle
      if (typeof window.__reinitAfterSwap === 'function') {
        window.__reinitAfterSwap();
      }

      // Reader per-user data layer: re-bind highlights/notes/bookmarks/answers + re-inject the
      // sidebar controls (the swap replaced .session-content and wiped .sidebar).
      if (typeof window.__ncReattach === 'function' && data.readerContext) {
        window.__ncReattach(data.readerContext);
      }

      // Audio player integration
      if (window.__audioPlayer) {
        // Rebuild highlight container inside the new session-content
        window.__audioPlayer.rebuildHighlightContainer();

        if (window.__audioPlayer.isPlaying()) {
          // Audio was playing — load new timestamps for the new content
          window.__audioPlayer.loadNewTimestamps();
        }

        if (options.autoplay && data.audioSession) {
          // Chapter ended → auto-advance: update session config and play
          window.__audioPlayer.updateSession({
            bookPath: data.bookPath,
            audioFile: data.audioSession.audioFile,
            timestampsFile: data.audioSession.timestampsFile || '',
            duration: data.audioSession.durationSeconds || 0,
            nextUrl: data.nextSessionUrl || '',
            durationFormatted: data.audioDurationFormatted || '',
          });
          window.__audioPlayer.playNextChapter();
        }
      }

      // Editor data — set up for potential re-entry into edit mode
      if (data.editData) {
        window.__EDITOR_DATA = data.editData;
      } else {
        window.__EDITOR_DATA = null;
      }

      hideLoadingBar();
    } catch (err) {
      hideLoadingBar();
      if (err.name === 'AbortError') return; // navigation was superseded

      // Fallback to full page reload
      console.warn('[ajax-nav] Failed, falling back to full reload:', err.message);
      window.location.href = url;
    }
  }

  // --- Browser back/forward ---
  // After an auto-advance pushState, back/forward just reloads the page.
  // No DOM swapping — keeps things simple and avoids editor state issues.

  window.addEventListener('popstate', function () {
    window.location.reload();
  });

  // --- Expose API ---

  window.__ajaxNav = {
    navigateToSession: navigateToSession,
  };
})();
