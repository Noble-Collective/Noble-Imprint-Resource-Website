/**
 * audio-player.js — Floating icon + sticky bottom bar audio player with text sync.
 *
 * Idle: floating headphones icon in bottom-right corner.
 * Playing: icon hides, sticky bottom bar appears with controls.
 * Text sync: highlights current sentence and smooth-scrolls to it.
 */

(function () {
  const fab = document.getElementById('audio-fab');
  const player = document.getElementById('audio-player');
  if (!fab || !player) return;

  const bookPath = fab.dataset.bookPath;
  const audioFile = fab.dataset.audioFile;
  const timestampsFile = fab.dataset.timestampsFile;
  const totalDuration = parseFloat(fab.dataset.duration) || 0;

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
  let segmentElements = null;
  let currentHighlight = null;
  let userScrolledRecently = false;
  let userScrollTimer = null;

  const storageKey = `audio-pos:${bookPath}/${audioFile}`;

  function formatTime(s) {
    if (!s || isNaN(s)) return '0:00';
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${sec.toString().padStart(2, '0')}`;
  }

  // --- Fetch signed URL on demand ---
  async function ensureAudioUrl() {
    if (signedUrl) return signedUrl;
    const res = await fetch(`/api/audio/url/${bookPath}/${audioFile}`);
    if (!res.ok) throw new Error('Failed to get audio URL');
    const data = await res.json();
    signedUrl = data.url;
    return signedUrl;
  }

  // --- Fetch timestamps ---
  async function loadTimestamps() {
    if (timestamps || !timestampsFile) return;
    try {
      const res = await fetch(`/api/audio/url/${bookPath}/${timestampsFile}`);
      if (!res.ok) return;
      const { url } = await res.json();
      const tsRes = await fetch(url);
      if (!tsRes.ok) return;
      timestamps = await tsRes.json();
      buildSegmentMap();
    } catch (err) {
      console.warn('[audio] Failed to load timestamps:', err);
    }
  }

  // --- Match timestamp segments to DOM elements ---
  function buildSegmentMap() {
    if (!timestamps || !timestamps.segments) return;
    const contentEl = document.querySelector('.session-content');
    if (!contentEl) return;

    segmentElements = [];
    const textEls = contentEl.querySelectorAll('p, li, h1, h2, h3, h4, h5, h6, blockquote > p, blockquote');

    // Normalize text for matching: collapse whitespace, strip quotes
    function norm(s) {
      return s.replace(/[\u201c\u201d\u2018\u2019""'']/g, '"')
              .replace(/[\u2014\u2013]/g, '-')
              .replace(/\s+/g, ' ')
              .trim();
    }

    for (const seg of timestamps.segments) {
      const needle = norm(seg.text).substring(0, 50);
      if (!needle || needle.length < 10) continue;

      let bestEl = null;
      let bestScore = 0;

      for (const el of textEls) {
        const elText = norm(el.textContent || '');
        if (elText.includes(needle)) {
          // Prefer longer matches (more specific elements)
          const score = needle.length;
          if (score > bestScore) {
            bestEl = el;
            bestScore = score;
          }
        }
      }

      if (bestEl) {
        segmentElements.push({ start: seg.start, end: seg.end, el: bestEl });
      }
    }

    console.log(`[audio] Mapped ${segmentElements.length}/${timestamps.segments.length} segments to DOM`);
  }

  // --- Highlight + scroll loop ---
  function syncLoop() {
    if (!audioEl || audioEl.paused || !segmentElements || segmentElements.length === 0) return;

    const t = audioEl.currentTime;
    let active = null;

    // Binary-ish search for active segment
    for (const seg of segmentElements) {
      if (t >= seg.start && t < seg.end) { active = seg; break; }
      // Also match if we're past the start but before next segment
      if (t >= seg.start) active = seg;
    }

    if (active && active.el !== currentHighlight) {
      if (currentHighlight) currentHighlight.classList.remove('audio-highlight');
      active.el.classList.add('audio-highlight');
      currentHighlight = active.el;

      if (!userScrolledRecently) {
        active.el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }

    requestAnimationFrame(syncLoop);
  }

  // --- Detect manual scroll ---
  function onUserScroll() {
    userScrolledRecently = true;
    clearTimeout(userScrollTimer);
    userScrollTimer = setTimeout(() => { userScrolledRecently = false; }, 5000);
  }

  // --- Create audio element ---
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
    });

    return audioEl;
  }

  // --- UI state ---
  function showPlaying() {
    iconPlay.style.display = 'none';
    iconPause.style.display = '';
    player.style.display = 'flex';
    fab.style.display = 'none'; // Hide FAB when player bar is visible
    window.addEventListener('scroll', onUserScroll, { passive: true });
    requestAnimationFrame(syncLoop);
  }

  function showPaused() {
    iconPlay.style.display = '';
    iconPause.style.display = 'none';
    // Keep player bar visible when paused — don't auto-collapse
    // User can see where they are and resume easily
  }

  function showPlayerBar() {
    player.style.display = 'flex';
    fab.style.display = 'none';
  }

  function hidePlayerBar() {
    player.style.display = 'none';
    fab.style.display = '';
    if (currentHighlight) {
      currentHighlight.classList.remove('audio-highlight');
      currentHighlight = null;
    }
    window.removeEventListener('scroll', onUserScroll);
  }

  // --- Play/pause ---
  async function togglePlay() {
    if (!audioEl) {
      fab.classList.add('audio-fab--loading');
      try {
        const url = await ensureAudioUrl();
        createAudio(url);
        loadTimestamps(); // async, don't await — sync starts when timestamps arrive
        await audioEl.play();
        fab.classList.remove('audio-fab--loading');
        showPlaying();
      } catch (err) {
        fab.classList.remove('audio-fab--loading');
        console.error('[audio] Playback failed:', err);
        return;
      }
    } else if (audioEl.paused) {
      await audioEl.play();
      showPlaying();
    } else {
      audioEl.pause();
      showPaused();
    }
  }

  // --- Close button (X) to dismiss player bar and go back to FAB ---
  const closeBtn = document.getElementById('audio-close-btn');
  if (closeBtn) {
    closeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (audioEl && !audioEl.paused) audioEl.pause();
      showPaused();
      hidePlayerBar();
    });
  }

  // --- Event handlers ---
  fab.addEventListener('click', togglePlay);
  playBtn.addEventListener('click', togglePlay);

  // Scrubber
  scrubber.addEventListener('mousedown', () => { scrubber._dragging = true; });
  scrubber.addEventListener('touchstart', () => { scrubber._dragging = true; }, { passive: true });
  scrubber.addEventListener('input', () => {
    if (audioEl) {
      const pct = scrubber.value / 1000;
      currentTimeEl.textContent = formatTime(pct * audioEl.duration);
    }
  });
  scrubber.addEventListener('change', () => {
    scrubber._dragging = false;
    if (audioEl) {
      audioEl.currentTime = (scrubber.value / 1000) * audioEl.duration;
    }
  });

  // Speed
  speedSelect.addEventListener('change', () => {
    if (audioEl) audioEl.playbackRate = parseFloat(speedSelect.value);
  });

  // Skip
  skipBack.addEventListener('click', () => {
    if (audioEl) audioEl.currentTime = Math.max(0, audioEl.currentTime - 15);
  });
  skipFwd.addEventListener('click', () => {
    if (audioEl) audioEl.currentTime = Math.min(audioEl.duration, audioEl.currentTime + 15);
  });
})();
