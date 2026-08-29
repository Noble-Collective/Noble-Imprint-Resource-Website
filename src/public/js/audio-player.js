/**
 * audio-player.js — Floating icon + sticky bottom bar audio player with text sync.
 */

(function () {
  const fab = document.getElementById('audio-fab');
  const player = document.getElementById('audio-player');
  if (!fab || !player) return;

  // Read from FAB data attributes dynamically — AJAX nav updates these on session swap
  function getBookPath() { return fab.dataset.bookPath; }
  function getAudioFile() { return fab.dataset.audioFile; }
  function getTimestampsFile() { return fab.dataset.timestampsFile; }
  function getTotalDuration() { return parseFloat(fab.dataset.duration) || 0; }
  function getNextUrl() { return fab.dataset.nextUrl || ''; }

  const playBtn = document.getElementById('audio-play-btn');
  const iconPlay = playBtn.querySelector('.icon-play');
  const iconPause = playBtn.querySelector('.icon-pause');
  const scrubber = document.getElementById('audio-scrubber');
  const currentTimeEl = document.getElementById('audio-current-time');
  const durationEl = document.getElementById('audio-duration');
  const speedSelect = document.getElementById('audio-speed');
  const skipBack = document.getElementById('audio-skip-back');
  const skipFwd = document.getElementById('audio-skip-fwd');

  // Wrap scrubber in a container for H2 markers
  const scrubberContainer = document.createElement('div');
  scrubberContainer.className = 'audio-scrubber-container';
  scrubber.parentNode.insertBefore(scrubberContainer, scrubber);
  scrubberContainer.appendChild(scrubber);

  let audioEl = null;
  let signedUrl = null;
  let timestamps = null;
  let segmentMap = null; // [{start, end, needle, parentEl}]
  let activeSegIdx = -1;
  let highlightSpan = null;
  let userScrolledAway = false;
  let programmaticScroll = false;

  function getStorageKey() { return `audio-pos:${getBookPath()}/${getAudioFile()}`; }

  function formatTime(s) {
    if (!s || isNaN(s)) return '0:00';
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${sec.toString().padStart(2, '0')}`;
  }

  function norm(s) {
    return s.replace(/[\u201c\u201d\u2018\u2019\u00ab\u00bb\u201e\u201f""'']/g, '"')
            .replace(/[\u2014\u2013]/g, '-')
            .replace(/\u2026/g, '...')
            .replace(/\s+/g, ' ')
            .trim();
  }

  // --- Fetch signed URL ---
  async function ensureAudioUrl() {
    if (signedUrl) return signedUrl;
    const res = await fetch(`/api/audio/url/${getBookPath()}/${getAudioFile()}`);
    if (!res.ok) throw new Error('Failed to get audio URL');
    signedUrl = (await res.json()).url;
    return signedUrl;
  }

  // --- Fetch timestamps and build segment map ---
  async function loadTimestamps() {
    if (timestamps || !getTimestampsFile()) return;
    try {
      const res = await fetch(`/api/audio/url/${getBookPath()}/${getTimestampsFile()}`);
      if (!res.ok) return;
      const tsRes = await fetch((await res.json()).url);
      if (!tsRes.ok) return;
      timestamps = await tsRes.json();
      buildSegmentMap();
    } catch (err) {
      console.warn('[audio] Failed to load timestamps:', err);
    }
  }

  function buildSegmentMap() {
    if (!timestamps || !timestamps.segments) return;
    const contentEl = document.querySelector('.session-content');
    if (!contentEl) return;

    const blockEls = Array.from(contentEl.querySelectorAll('h1, h2, h3, h4, h5, h6, p'));
    segmentMap = [];

    // Pre-compute normalized text for all DOM elements once
    const blockTexts = blockEls.map(el => norm(el.textContent));

    // Hybrid matching: use blockIndex as a starting hint, then search nearby
    // for the element whose text matches. Track which elements are already
    // matched to avoid duplicate assignments (e.g., "Conclusion" matching
    // an H6 when the H2 is the correct target).
    let offsetAdjust = 0;
    const matchedEls = new Set();

    for (const seg of timestamps.segments) {
      const needle = norm(seg.text).replace(/\.\s*$/, '');
      if (!needle) continue;

      const shortNeedle = needle.substring(0, 30);
      const hintIdx = (seg.blockIndex || 0) + offsetAdjust;
      let el = null;
      let foundIdx = -1;

      // Search outward from hint in expanding distance — finds the CLOSEST
      // matching element, not just the first forward or backward match.
      // Critical for duplicate headings like "Core Principle", "Introduction".
      const center = Math.max(0, Math.min(hintIdx, blockEls.length - 1));
      for (let dist = 0; dist < blockEls.length; dist++) {
        for (const i of (dist === 0 ? [center] : [center + dist, center - dist])) {
          if (i < 0 || i >= blockEls.length) continue;
          if (!blockTexts[i].includes(shortNeedle)) continue;
          if (seg.sentenceIndex === 0 && matchedEls.has(i)) continue;
          el = blockEls[i];
          foundIdx = i;
          break;
        }
        if (el) break;
      }

      if (!el) continue;

      if (seg.sentenceIndex === 0) matchedEls.add(foundIdx);

      // Update offset adjustment for future segments
      const expectedIdx = seg.blockIndex || 0;
      offsetAdjust = foundIdx - expectedIdx;

      segmentMap.push({
        start: seg.start,
        end: seg.end,
        el: el,
        sentenceIndex: seg.sentenceIndex,
        needle: needle,
        matchStr: shortNeedle,
      });
    }
    console.log(`[audio] Mapped ${segmentMap.length}/${timestamps.segments.length} segments to ${blockEls.length} block elements`);
    renderH2Markers();
    renderHeadingAudioIcons();
  }

  // --- H2 section markers on the scrubber ---
  function renderH2Markers() {
    if (!segmentMap || !getTotalDuration()) return;

    // Clear existing markers
    scrubberContainer.querySelectorAll('.scrubber-h2-marker').forEach(m => m.remove());

    // Collect unique H2 segments (first segment per H2 element)
    const seen = new Set();
    const h2Segments = [];
    for (const seg of segmentMap) {
      if (seg.el && seg.el.tagName === 'H2' && !seen.has(seg.el)) {
        seen.add(seg.el);
        h2Segments.push(seg);
      }
    }

    if (h2Segments.length === 0) return;

    for (const seg of h2Segments) {
      const pct = (seg.start / getTotalDuration()) * 100;
      const marker = document.createElement('div');
      marker.className = 'scrubber-h2-marker';
      marker.style.left = pct + '%';
      marker.title = seg.el.textContent.trim();
      marker.addEventListener('click', function (e) {
        e.stopPropagation();
        if (audioEl) {
          audioEl.currentTime = seg.start;
          forceHighlightUpdate();
        }
      });
      scrubberContainer.appendChild(marker);
    }
    console.log(`[audio] Rendered ${h2Segments.length} H2 markers on scrubber`);
  }

  // --- Heading audio icons (clickable jump-to-audio links) ---
  function renderHeadingAudioIcons() {
    if (!segmentMap || !getTotalDuration()) return;

    const headingTags = new Set(['H1', 'H2', 'H3', 'H4', 'H5', 'H6']);
    const seen = new Set();

    for (const seg of segmentMap) {
      if (!seg.el || !headingTags.has(seg.el.tagName) || seen.has(seg.el)) continue;
      seen.add(seg.el);

      const icon = document.createElement('a');
      icon.className = 'heading-audio-icon';
      icon.href = '#';
      icon.title = 'Jump to audio';
      icon.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 18v-6a9 9 0 0 1 18 0v6"/><path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3zM3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z"/></svg>';
      const startTime = seg.start;
      icon.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        if (!audioEl) {
          // Start audio and seek after it loads
          togglePlay().then(function () {
            if (audioEl) {
              audioEl.currentTime = startTime;
              forceHighlightUpdate();
            }
          });
        } else {
          audioEl.currentTime = startTime;
          if (audioEl.paused) {
            audioEl.play();
            showPlaying();
          }
          forceHighlightUpdate();
        }
      });
      seg.el.appendChild(icon);
    }
  }

  // --- Highlight via positioned overlay (no DOM modification) ---
  // Using let so AJAX nav can replace the container after DOM swap
  let overlayContainer = document.createElement('div');
  overlayContainer.id = 'audio-highlight-overlays';
  overlayContainer.style.cssText = 'position:absolute;top:0;left:0;pointer-events:none;z-index:1;';
  document.querySelector('.session-content')?.appendChild(overlayContainer);

  function clearHighlight() {
    overlayContainer.innerHTML = '';
  }

  function applySentenceHighlight(seg) {
    clearHighlight();

    const el = seg.el;
    if (!el) return;
    const cp = overlayContainer.parentElement;
    if (!cp) return;

    // Step 1: element found by blockIndex (no text matching needed)
    // Step 2: split element text into sentences, find sentenceIndex
    const fullText = el.textContent || '';
    const elSentences = fullText.split(/(?<=[.!?])\s+/).filter(s => s.trim());

    // Single sentence or no sentenceIndex — highlight whole element
    if (elSentences.length <= 1 || seg.sentenceIndex === undefined) {
      highlightWholeElement(el, cp);
      return;
    }

    const target = elSentences[seg.sentenceIndex];
    if (!target) {
      highlightWholeElement(el, cp);
      return;
    }

    // Step 3: find sentence position in element text (reliable — correct element)
    const sentStart = fullText.indexOf(target);
    if (sentStart < 0) {
      highlightWholeElement(el, cp);
      return;
    }
    const sentEnd = sentStart + target.length;

    // Step 4: walk text nodes to build Range spanning the sentence
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let charsSeen = 0;
    let startNode = null, startOff = 0, endNode = null, endOff = 0;
    let tn;
    while ((tn = walker.nextNode())) {
      const len = tn.textContent.length;
      if (!startNode && charsSeen + len > sentStart) {
        startNode = tn;
        startOff = sentStart - charsSeen;
      }
      if (charsSeen + len >= sentEnd) {
        endNode = tn;
        endOff = sentEnd - charsSeen;
        break;
      }
      charsSeen += len;
    }

    if (!startNode || !endNode) {
      highlightWholeElement(el, cp);
      return;
    }

    try {
      const range = document.createRange();
      range.setStart(startNode, Math.max(0, startOff));
      range.setEnd(endNode, Math.min(endOff, endNode.textContent.length));

      const rects = range.getClientRects();
      const cRect = cp.getBoundingClientRect();
      for (const r of rects) {
        if (r.width > 0 && r.height > 0) {
          addOverlayRect(r.left - cRect.left, r.top + window.scrollY - cp.offsetTop, r.width, r.height);
        }
      }
    } catch {
      highlightWholeElement(el, cp);
    }
  }

  function highlightWholeElement(el, cp) {
    const r = el.getBoundingClientRect();
    const cRect = cp.getBoundingClientRect();
    addOverlayRect(r.left - cRect.left, r.top + window.scrollY - cp.offsetTop, r.width, r.height);
  }

  function addOverlayRect(left, top, width, height) {
    const div = document.createElement('div');
    div.style.cssText = `position:absolute;left:${left}px;top:${top}px;width:${width}px;height:${height}px;background:rgba(100,160,220,0.15);border-radius:3px;pointer-events:none;`;
    overlayContainer.appendChild(div);
  }

  // --- Compute the visible reading area (between header/TOC and player) ---
  function getVisibleBounds() {
    const header = document.querySelector('.site-header');
    const tocBar = document.querySelector('.mobile-toc-bar');
    let top = header ? header.getBoundingClientRect().bottom : 0;
    if (tocBar && !tocBar.classList.contains('is-hidden')) {
      top = Math.max(top, tocBar.getBoundingClientRect().bottom);
    }
    const playerRect = player.style.display !== 'none' ? player.getBoundingClientRect() : null;
    const bottom = playerRect ? playerRect.top : window.innerHeight;
    return { top, bottom };
  }

  // --- "Jump to audio" link above the player ---
  const jumpLink = document.createElement('a');
  jumpLink.className = 'audio-jump-link';
  jumpLink.textContent = 'Jump to audio location';
  jumpLink.href = '#';
  jumpLink.style.display = 'none';
  player.parentElement.insertBefore(jumpLink, player);

  jumpLink.addEventListener('click', function (e) {
    e.preventDefault();
    userScrolledAway = false;
    scrollToHighlight();
    jumpLink.style.display = 'none';
  });

  function scrollToHighlight() {
    programmaticScroll = true;
    const firstOverlay = overlayContainer.firstChild;
    if (firstOverlay) {
      const overlayTop = parseFloat(firstOverlay.style.top);
      const cp = overlayContainer.parentElement;
      const docTop = cp ? cp.offsetTop + overlayTop : overlayTop;
      const { top: visTop, bottom: visBottom } = getVisibleBounds();
      const visHeight = visBottom - visTop;
      const targetY = docTop - visTop - visHeight * 0.33;
      window.scrollTo({ top: Math.max(0, targetY), behavior: 'smooth' });
    } else if (activeSegIdx >= 0 && segmentMap[activeSegIdx]) {
      const rect = segmentMap[activeSegIdx].el.getBoundingClientRect();
      const { top: visTop } = getVisibleBounds();
      const targetY = window.scrollY + rect.top - visTop - 20;
      window.scrollTo({ top: Math.max(0, targetY), behavior: 'smooth' });
    }
    // Clear flag after smooth scroll settles
    setTimeout(function () { programmaticScroll = false; }, 600);
  }

  function isHighlightVisible() {
    if (activeSegIdx < 0 || !segmentMap[activeSegIdx]) return true;
    const el = segmentMap[activeSegIdx].el;
    const rect = el.getBoundingClientRect();
    const { top: visTop, bottom: visBottom } = getVisibleBounds();
    return rect.bottom > visTop && rect.top < visBottom;
  }

  function updateJumpLink() {
    if (!audioEl || audioEl.paused || activeSegIdx < 0 || !userScrolledAway) {
      jumpLink.style.display = 'none';
      return;
    }
    jumpLink.style.display = '';
  }

  // --- Update highlight for a given time ---
  function updateHighlight(forceScroll) {
    if (!segmentMap || segmentMap.length === 0) return;
    const t = audioEl.currentTime;
    let newIdx = -1;

    // Find the segment that contains the current time (strict match only)
    for (let i = 0; i < segmentMap.length; i++) {
      if (t >= segmentMap[i].start && t < segmentMap[i].end) { newIdx = i; break; }
    }

    // If we're in a gap between segments, clear the highlight
    if (newIdx < 0) {
      if (activeSegIdx >= 0) {
        clearHighlight();
        activeSegIdx = -1;
        updateJumpLink();
      }
      return;
    }

    if (newIdx !== activeSegIdx) {
      applySentenceHighlight(segmentMap[newIdx]);
      activeSegIdx = newIdx;

      // Auto-scroll unless user has scrolled away
      if (forceScroll || !userScrolledAway) {
        scrollToHighlight();
      }
    }

    updateJumpLink();
  }

  // --- Sync loop ---
  function syncLoop() {
    if (!audioEl || audioEl.paused) return;
    updateHighlight(false);
    requestAnimationFrame(syncLoop);
  }

  // Force highlight recalculation after skip/scrub
  function forceHighlightUpdate() {
    activeSegIdx = -1;
    userScrolledAway = false;
    if (audioEl) updateHighlight(true);
  }

  function onUserScroll() {
    if (programmaticScroll) return;
    // Mark as scrolled away if the highlight is no longer visible
    if (activeSegIdx >= 0 && !isHighlightVisible()) {
      userScrolledAway = true;
    }
  }

  // --- Audio element ---
  function createAudio(url) {
    audioEl = new Audio(url);
    audioEl.preload = 'auto';

    // Analytics: emit listen events to the first-party hook (no-op if absent).
    // Uses native media events so it fires however play/pause is triggered.
    let lastAudioProgress = 0;
    function emitAudio(type) {
      if (!window.__analyticsAudio) return;
      window.__analyticsAudio(type, {
        position: audioEl.currentTime,
        duration: (audioEl.duration && isFinite(audioEl.duration)) ? audioEl.duration : getTotalDuration(),
      });
    }
    audioEl.addEventListener('play', () => emitAudio('audio_play'));
    audioEl.addEventListener('pause', () => { if (!audioEl.ended) emitAudio('audio_pause'); });

    const saved = localStorage.getItem(getStorageKey());
    if (saved) {
      const pos = parseFloat(saved);
      if (pos > 0 && pos < getTotalDuration() - 5) audioEl.currentTime = pos;
    }

    audioEl.addEventListener('timeupdate', () => {
      if (!scrubber._dragging) {
        scrubber.value = (audioEl.currentTime / audioEl.duration) * 1000;
        currentTimeEl.textContent = formatTime(audioEl.currentTime);
      }
      localStorage.setItem(getStorageKey(), audioEl.currentTime.toFixed(1));
      const _now = Date.now();
      if (_now - lastAudioProgress >= 30000) { lastAudioProgress = _now; emitAudio('audio_progress'); }
    });

    audioEl.addEventListener('loadedmetadata', () => {
      durationEl.textContent = formatTime(audioEl.duration);
    });

    audioEl.addEventListener('ended', () => {
      emitAudio('audio_ended');
      showPaused();
      localStorage.removeItem(getStorageKey());
      var currentNextUrl = getNextUrl();
      if (window.__ajaxNav && currentNextUrl) {
        window.__ajaxNav.navigateToSession(currentNextUrl, { autoplay: true });
      } else if (currentNextUrl) {
        localStorage.setItem('audio-autoplay', 'true');
        window.location.href = currentNextUrl;
      }
    });
  }

  // --- UI ---
  function showPlaying() {
    iconPlay.style.display = 'none';
    iconPause.style.display = '';
    player.style.display = '';
    fab.style.display = 'none';
    window.addEventListener('scroll', onUserScroll, { passive: true });
    requestAnimationFrame(syncLoop);
  }

  function showPaused() {
    iconPlay.style.display = '';
    iconPause.style.display = 'none';
  }

  function hidePlayerBar() {
    player.style.display = 'none';
    player.classList.remove('is-expanded');
    fab.style.display = '';
    clearHighlight();
    activeSegIdx = -1;
    window.removeEventListener('scroll', onUserScroll);
  }

  async function togglePlay() {
    if (!audioEl) {
      fab.classList.add('audio-fab--loading');
      try {
        const url = await ensureAudioUrl();
        createAudio(url);
        loadTimestamps();
        await audioEl.play();
        fab.classList.remove('audio-fab--loading');
        showPlaying();
      } catch (err) {
        fab.classList.remove('audio-fab--loading');
        console.error('[audio] Playback failed:', err);
      }
    } else if (audioEl.paused) {
      await audioEl.play();
      showPlaying();
    } else {
      audioEl.pause();
      showPaused();
    }
  }

  // --- Auto-play from previous chapter ---
  if (localStorage.getItem('audio-autoplay') === 'true') {
    localStorage.removeItem('audio-autoplay');
    setTimeout(() => togglePlay(), 500);
  }

  // --- Event bindings ---
  fab.addEventListener('click', togglePlay);
  playBtn.addEventListener('click', togglePlay);

  const closeBtn = document.getElementById('audio-close-btn');
  if (closeBtn) {
    closeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (audioEl && !audioEl.paused) audioEl.pause();
      showPaused();
      hidePlayerBar();
    });
  }

  const expandBtn = document.getElementById('audio-expand-btn');
  if (expandBtn) {
    expandBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      player.classList.toggle('is-expanded');
    });
  }

  scrubber.addEventListener('mousedown', () => { scrubber._dragging = true; });
  scrubber.addEventListener('touchstart', () => { scrubber._dragging = true; }, { passive: true });
  scrubber.addEventListener('input', () => {
    if (audioEl) currentTimeEl.textContent = formatTime((scrubber.value / 1000) * audioEl.duration);
  });
  scrubber.addEventListener('change', () => {
    scrubber._dragging = false;
    if (audioEl) {
      audioEl.currentTime = (scrubber.value / 1000) * audioEl.duration;
      forceHighlightUpdate();
    }
  });

  speedSelect.addEventListener('change', () => {
    if (audioEl) audioEl.playbackRate = parseFloat(speedSelect.value);
  });

  skipBack.addEventListener('click', () => {
    if (audioEl) {
      audioEl.currentTime = Math.max(0, audioEl.currentTime - 15);
      forceHighlightUpdate();
    }
  });
  skipFwd.addEventListener('click', () => {
    if (audioEl) {
      audioEl.currentTime = Math.min(audioEl.duration, audioEl.currentTime + 15);
      forceHighlightUpdate();
    }
  });

  // Load timestamps eagerly so heading icons and scrubber markers
  // appear immediately, not after first play
  loadTimestamps();

  // --- Expose API for AJAX navigation ---
  window.__audioPlayer = {
    /** Update session config after AJAX DOM swap (does NOT start playback) */
    updateSession: function (opts) {
      // Update the FAB data attributes and internal state for the new session
      if (opts.bookPath != null) fab.dataset.bookPath = opts.bookPath;
      if (opts.audioFile != null) fab.dataset.audioFile = opts.audioFile;
      if (opts.timestampsFile != null) fab.dataset.timestampsFile = opts.timestampsFile;
      if (opts.duration != null) fab.dataset.duration = opts.duration;
      if (opts.nextUrl != null) fab.dataset.nextUrl = opts.nextUrl;
      if (opts.durationFormatted != null) durationEl.textContent = opts.durationFormatted;
    },

    /** Fetch new signed URL, change src, and play. Shows banner on NotAllowedError. */
    playNextChapter: async function () {
      // Clear old state
      signedUrl = null;
      timestamps = null;
      segmentMap = null;
      activeSegIdx = -1;
      userScrolledAway = false;
      clearHighlight();

      // Remove old heading audio icons and H2 markers
      document.querySelectorAll('.heading-audio-icon').forEach(function (el) { el.remove(); });
      scrubberContainer.querySelectorAll('.scrubber-h2-marker').forEach(function (m) { m.remove(); });

      try {
        // Fetch new signed audio URL (getters read from updated FAB data attributes)
        var res = await fetch('/api/audio/url/' + getBookPath() + '/' + getAudioFile());
        if (!res.ok) throw new Error('Failed to get audio URL');
        signedUrl = (await res.json()).url;

        // Set new source and play
        audioEl.src = signedUrl;
        audioEl.currentTime = 0;
        scrubber.value = 0;
        currentTimeEl.textContent = '0:00';

        await audioEl.play();
        showPlaying();

        // Load timestamps for the new session
        window.__audioPlayer.loadNewTimestamps();
      } catch (err) {
        if (err.name === 'NotAllowedError') {
          // Safari iOS: show tap-to-continue banner
          showTapToContinueBanner();
        } else {
          console.error('[audio] playNextChapter failed:', err);
        }
      }
    },

    /** Rebuild the highlight overlay container inside the (swapped) .session-content */
    rebuildHighlightContainer: function () {
      // Remove old overlay container (may have been detached by DOM swap)
      var old = document.getElementById('audio-highlight-overlays');
      if (old) old.remove();

      // Create new one inside the new .session-content
      overlayContainer = document.createElement('div');
      overlayContainer.id = 'audio-highlight-overlays';
      overlayContainer.style.cssText = 'position:absolute;top:0;left:0;pointer-events:none;z-index:1;';
      var sc = document.querySelector('.session-content');
      if (sc) sc.appendChild(overlayContainer);
    },

    /** Fetch timestamps for the new session, rebuild segment map and heading icons */
    loadNewTimestamps: function () {
      timestamps = null;
      segmentMap = null;
      activeSegIdx = -1;
      loadTimestamps();
    },

    /** Returns whether audio is currently playing */
    isPlaying: function () {
      return audioEl && !audioEl.paused;
    },

    /** Get the audio element (for AJAX nav to check state) */
    getAudioElement: function () {
      return audioEl;
    },
  };

  // --- "Tap to continue listening" banner for Safari iOS autoplay failure ---
  function showTapToContinueBanner() {
    // Remove existing banner if any
    var existing = document.getElementById('audio-tap-banner');
    if (existing) existing.remove();

    var banner = document.createElement('div');
    banner.id = 'audio-tap-banner';
    banner.className = 'audio-tap-banner';
    banner.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" style="flex-shrink:0"><polygon points="5,3 19,12 5,21"/></svg> <span>Tap to continue listening</span>';
    banner.addEventListener('click', function () {
      if (audioEl) {
        audioEl.play().then(function () {
          showPlaying();
        }).catch(function () {});
      }
      banner.remove();
    });

    // Insert at the top of reading content
    var readingContent = document.getElementById('reading-content');
    if (readingContent) {
      readingContent.insertBefore(banner, readingContent.firstChild);
    } else {
      document.querySelector('.main').appendChild(banner);
    }
  }
})();
