/**
 * audio-player.js — Floating icon + sticky bottom bar audio player with text sync.
 */

(function () {
  const fab = document.getElementById('audio-fab');
  const player = document.getElementById('audio-player');
  if (!fab || !player) return;

  const bookPath = fab.dataset.bookPath;
  const audioFile = fab.dataset.audioFile;
  const timestampsFile = fab.dataset.timestampsFile;
  const totalDuration = parseFloat(fab.dataset.duration) || 0;
  const nextUrl = fab.dataset.nextUrl || '';

  const playBtn = document.getElementById('audio-play-btn');
  const iconPlay = playBtn.querySelector('.icon-play');
  const iconPause = playBtn.querySelector('.icon-pause');
  const scrubber = document.getElementById('audio-scrubber');
  const currentTimeEl = document.getElementById('audio-current-time');
  const durationEl = document.getElementById('audio-duration');
  const speedSelect = document.getElementById('audio-speed');
  const skipBack = document.getElementById('audio-skip-back');
  const skipFwd = document.getElementById('audio-skip-fwd');

  let audioEl = null;
  let signedUrl = null;
  let timestamps = null;
  let segmentMap = null; // [{start, end, needle, parentEl}]
  let activeSegIdx = -1;
  let highlightSpan = null;
  let userScrolledRecently = false;
  let userScrollTimer = null;

  const storageKey = `audio-pos:${bookPath}/${audioFile}`;

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
    const res = await fetch(`/api/audio/url/${bookPath}/${audioFile}`);
    if (!res.ok) throw new Error('Failed to get audio URL');
    signedUrl = (await res.json()).url;
    return signedUrl;
  }

  // --- Fetch timestamps and build segment map ---
  async function loadTimestamps() {
    if (timestamps || !timestampsFile) return;
    try {
      const res = await fetch(`/api/audio/url/${bookPath}/${timestampsFile}`);
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

    // Build ordered list of block elements (h1-h6, p) — index matches blockIndex
    const blockEls = Array.from(contentEl.querySelectorAll('h1, h2, h3, h4, h5, h6, p'));
    segmentMap = [];

    for (const seg of timestamps.segments) {
      const bi = seg.blockIndex;
      const si = seg.sentenceIndex;

      if (bi === undefined || bi >= blockEls.length) continue;

      const el = blockEls[bi];
      const text = seg.text;
      const needle = norm(text).replace(/\.\s*$/, '');

      segmentMap.push({
        start: seg.start,
        end: seg.end,
        el: el,
        sentenceIndex: si,
        needle: needle,
        matchStr: needle.substring(0, 40),
      });
    }
    console.log(`[audio] Mapped ${segmentMap.length}/${timestamps.segments.length} segments to ${blockEls.length} block elements`);
  }

  // --- Highlight via positioned overlay (no DOM modification) ---
  const overlayContainer = document.createElement('div');
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

  // --- Update highlight and scroll for a given time ---
  function updateHighlight(forceScroll) {
    if (!segmentMap || segmentMap.length === 0) return;
    const t = audioEl.currentTime;
    let newIdx = -1;

    for (let i = 0; i < segmentMap.length; i++) {
      if (t >= segmentMap[i].start && t < segmentMap[i].end) { newIdx = i; break; }
      if (t >= segmentMap[i].start) newIdx = i;
    }

    if (newIdx !== activeSegIdx && newIdx >= 0) {
      applySentenceHighlight(segmentMap[newIdx]);
      activeSegIdx = newIdx;

      // Scroll the highlighted sentence into the visible reading area
      if (forceScroll || !userScrolledRecently) {
        const firstOverlay = overlayContainer.firstChild;
        if (firstOverlay) {
          const overlayTop = parseFloat(firstOverlay.style.top);
          const cp = overlayContainer.parentElement;
          const docTop = cp ? cp.offsetTop + overlayTop : overlayTop;
          const { top: visTop, bottom: visBottom } = getVisibleBounds();
          const visHeight = visBottom - visTop;
          const targetY = docTop - visTop - visHeight * 0.33;
          window.scrollTo({ top: Math.max(0, targetY), behavior: 'smooth' });
        } else {
          const rect = segmentMap[newIdx].el.getBoundingClientRect();
          const { top: visTop } = getVisibleBounds();
          if (rect.top < visTop || rect.bottom > window.innerHeight) {
            const targetY = window.scrollY + rect.top - visTop - 20;
            window.scrollTo({ top: Math.max(0, targetY), behavior: 'smooth' });
          }
        }
      }
    }
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
    userScrolledRecently = false;
    if (audioEl) updateHighlight(true);
  }

  function onUserScroll() {
    userScrolledRecently = true;
    clearTimeout(userScrollTimer);
    userScrollTimer = setTimeout(() => { userScrolledRecently = false; }, 5000);
  }

  // --- Audio element ---
  function createAudio(url) {
    audioEl = new Audio(url);
    audioEl.preload = 'auto';

    const saved = localStorage.getItem(storageKey);
    if (saved) {
      const pos = parseFloat(saved);
      if (pos > 0 && pos < totalDuration - 5) audioEl.currentTime = pos;
    }

    audioEl.addEventListener('timeupdate', () => {
      if (!scrubber._dragging) {
        scrubber.value = (audioEl.currentTime / audioEl.duration) * 1000;
        currentTimeEl.textContent = formatTime(audioEl.currentTime);
      }
      localStorage.setItem(storageKey, audioEl.currentTime.toFixed(1));
    });

    audioEl.addEventListener('loadedmetadata', () => {
      durationEl.textContent = formatTime(audioEl.duration);
    });

    audioEl.addEventListener('ended', () => {
      showPaused();
      localStorage.removeItem(storageKey);
      if (nextUrl) {
        localStorage.setItem('audio-autoplay', 'true');
        window.location.href = nextUrl;
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
})();
