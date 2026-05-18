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

    // Get all text-bearing elements
    const els = contentEl.querySelectorAll('p, li, h1, h2, h3, h4, h5, h6, blockquote, td, strong, em');
    segmentMap = [];

    for (const seg of timestamps.segments) {
      // Strip trailing period that TTS preprocessor added to headings
      let segText = seg.text;
      const needle = norm(segText).replace(/\.\s*$/, '');
      if (needle.length < 8) continue;

      // Use first 40 chars for matching to handle sentence fragments
      const matchStr = needle.substring(0, 40);

      for (const el of els) {
        const elText = norm(el.textContent || '');
        if (elText.includes(matchStr)) {
          segmentMap.push({
            start: seg.start,
            end: seg.end,
            needle: needle,
            matchStr: matchStr,
            el: el,
          });
          break;
        }
      }
    }
    console.log(`[audio] Mapped ${segmentMap.length}/${timestamps.segments.length} segments`);
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
    const matchStr = seg.matchStr;
    const needle = seg.needle;

    // For short segments, highlight the whole element
    if (needle.length < 15) {
      const rect = el.getBoundingClientRect();
      const containerRect = overlayContainer.parentElement.getBoundingClientRect();
      addOverlayRect(rect.left - containerRect.left, rect.top - containerRect.top + window.scrollY - overlayContainer.parentElement.offsetTop, rect.width, rect.height);
      return;
    }

    // Find the text range for this sentence
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let textNode;
    while ((textNode = walker.nextNode())) {
      const raw = textNode.textContent;
      const tnNorm = norm(raw);
      const idx = tnNorm.indexOf(matchStr);
      if (idx < 0) continue;

      // Find raw start position using multi-word anchor for uniqueness
      const anchorWords = matchStr.split(' ').slice(0, 4).join(' ');
      let rawStart = -1;
      for (let ri = 0; ri < raw.length; ri++) {
        const slice = norm(raw.substring(ri, ri + anchorWords.length + 20));
        if (slice.startsWith(anchorWords)) {
          rawStart = ri;
          while (rawStart < raw.length && /\s/.test(raw[rawStart])) rawStart++;
          break;
        }
      }
      if (rawStart < 0) continue;

      // Find raw end
      let rawEnd = rawStart, normCov = 0;
      while (normCov < needle.length && rawEnd < raw.length) {
        rawEnd++;
        normCov = norm(raw.substring(rawStart, rawEnd)).length;
      }

      try {
        const range = document.createRange();
        range.setStart(textNode, rawStart);
        range.setEnd(textNode, Math.min(rawEnd, raw.length));

        // Get pixel rectangles for this range (handles line wrapping)
        const rects = range.getClientRects();
        const containerRect = overlayContainer.parentElement.getBoundingClientRect();
        const offsetTop = overlayContainer.parentElement.offsetTop;

        for (const rect of rects) {
          if (rect.width > 0 && rect.height > 0) {
            addOverlayRect(
              rect.left - containerRect.left,
              rect.top + window.scrollY - offsetTop,
              rect.width,
              rect.height
            );
          }
        }
        return;
      } catch {
        // Fallback: highlight whole element
        const rect = el.getBoundingClientRect();
        const containerRect = overlayContainer.parentElement.getBoundingClientRect();
        addOverlayRect(rect.left - containerRect.left, rect.top + window.scrollY - overlayContainer.parentElement.offsetTop, rect.width, rect.height);
        return;
      }
    }

    // Final fallback: highlight whole element
    const rect = el.getBoundingClientRect();
    const containerRect = overlayContainer.parentElement.getBoundingClientRect();
    addOverlayRect(rect.left - containerRect.left, rect.top + window.scrollY - overlayContainer.parentElement.offsetTop, rect.width, rect.height);
  }

  function addOverlayRect(left, top, width, height) {
    const div = document.createElement('div');
    div.style.cssText = `position:absolute;left:${left}px;top:${top}px;width:${width}px;height:${height}px;background:rgba(100,160,220,0.15);border-radius:3px;pointer-events:none;`;
    overlayContainer.appendChild(div);
  }

  // --- Sync loop ---
  function syncLoop() {
    if (!audioEl || audioEl.paused) return;

    if (segmentMap && segmentMap.length > 0) {
      const t = audioEl.currentTime;
      let newIdx = -1;

      for (let i = 0; i < segmentMap.length; i++) {
        if (t >= segmentMap[i].start && t < segmentMap[i].end) { newIdx = i; break; }
        if (t >= segmentMap[i].start) newIdx = i;
      }

      if (newIdx !== activeSegIdx && newIdx >= 0) {
        applySentenceHighlight(segmentMap[newIdx]);
        activeSegIdx = newIdx;

        // Scroll to the first overlay rect or the element
        const firstOverlay = overlayContainer.firstChild;
        const scrollTarget = firstOverlay || segmentMap[newIdx].el;
        if (!userScrolledRecently && scrollTarget) {
          (segmentMap[newIdx].el).scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      }
    }

    requestAnimationFrame(syncLoop);
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
    player.style.display = 'flex';
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

  scrubber.addEventListener('mousedown', () => { scrubber._dragging = true; });
  scrubber.addEventListener('touchstart', () => { scrubber._dragging = true; }, { passive: true });
  scrubber.addEventListener('input', () => {
    if (audioEl) currentTimeEl.textContent = formatTime((scrubber.value / 1000) * audioEl.duration);
  });
  scrubber.addEventListener('change', () => {
    scrubber._dragging = false;
    if (audioEl) audioEl.currentTime = (scrubber.value / 1000) * audioEl.duration;
  });

  speedSelect.addEventListener('change', () => {
    if (audioEl) audioEl.playbackRate = parseFloat(speedSelect.value);
  });

  skipBack.addEventListener('click', () => {
    if (audioEl) audioEl.currentTime = Math.max(0, audioEl.currentTime - 15);
  });
  skipFwd.addEventListener('click', () => {
    if (audioEl) audioEl.currentTime = Math.min(audioEl.duration, audioEl.currentTime + 15);
  });
})();
