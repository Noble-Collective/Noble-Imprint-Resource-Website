/**
 * audio-player.js — Floating icon + sticky bottom bar audio player with text sync.
 *
 * Idle: floating music icon in bottom-right corner.
 * Playing: expands to sticky bottom bar with play/pause, scrubber, speed, skip.
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
  let segmentElements = null; // { start, end, el }[]
  let currentHighlight = null;
  let userScrolledRecently = false;
  let userScrollTimer = null;
  let collapseTimer = null;

  // --- Storage key for resume ---
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
    const urlPath = `${bookPath}/${audioFile}`;
    const res = await fetch(`/api/audio/url/${urlPath}`);
    if (!res.ok) throw new Error('Failed to get audio URL');
    const data = await res.json();
    signedUrl = data.url;
    return signedUrl;
  }

  // --- Fetch timestamps ---
  async function loadTimestamps() {
    if (timestamps || !timestampsFile) return;
    try {
      const urlPath = `${bookPath}/${timestampsFile}`;
      const res = await fetch(`/api/audio/url/${urlPath}`);
      if (!res.ok) return;
      const { url } = await res.json();
      const tsRes = await fetch(url);
      if (!tsRes.ok) return;
      timestamps = await tsRes.json();
      buildSegmentMap();
    } catch { /* timestamps unavailable — audio still works */ }
  }

  // --- Match timestamp segments to DOM elements ---
  function buildSegmentMap() {
    if (!timestamps || !timestamps.segments) return;
    const contentEl = document.querySelector('.session-content');
    if (!contentEl) return;

    segmentElements = [];
    const textNodes = getTextElements(contentEl);

    for (const seg of timestamps.segments) {
      const needle = seg.text.trim().substring(0, 60); // match on first 60 chars
      if (!needle) continue;

      let bestEl = null;
      for (const el of textNodes) {
        if (el.textContent && el.textContent.includes(needle)) {
          bestEl = el;
          break;
        }
      }
      if (bestEl) {
        segmentElements.push({ start: seg.start, end: seg.end, el: bestEl });
      }
    }
  }

  function getTextElements(root) {
    const els = [];
    const walker = root.querySelectorAll('p, li, h1, h2, h3, h4, h5, h6, blockquote, td');
    walker.forEach(el => els.push(el));
    return els;
  }

  // --- Highlight + scroll loop ---
  function syncLoop() {
    if (!audioEl || audioEl.paused || !segmentElements) return;

    const t = audioEl.currentTime;
    let active = null;
    for (const seg of segmentElements) {
      if (t >= seg.start && t < seg.end) { active = seg; break; }
    }

    if (active && active.el !== currentHighlight) {
      if (currentHighlight) currentHighlight.classList.remove('audio-highlight');
      active.el.classList.add('audio-highlight');
      currentHighlight = active.el;

      // Smooth scroll if user hasn't manually scrolled recently
      if (!userScrolledRecently) {
        active.el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }

    requestAnimationFrame(syncLoop);
  }

  // --- Detect manual scroll (pause auto-scroll for 5s) ---
  function onUserScroll() {
    userScrolledRecently = true;
    clearTimeout(userScrollTimer);
    userScrollTimer = setTimeout(() => { userScrolledRecently = false; }, 5000);
  }

  // --- Create audio element ---
  function createAudio(url) {
    audioEl = new Audio(url);
    audioEl.preload = 'auto';

    // Restore saved position
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
      // Save position periodically
      localStorage.setItem(storageKey, audioEl.currentTime.toFixed(1));
    });

    audioEl.addEventListener('loadedmetadata', () => {
      durationEl.textContent = formatTime(audioEl.duration);
    });

    audioEl.addEventListener('ended', () => {
      showPaused();
      localStorage.removeItem(storageKey);
      scheduleCollapse();
    });

    return audioEl;
  }

  // --- UI state ---
  function showPlaying() {
    iconPlay.style.display = 'none';
    iconPause.style.display = '';
    player.style.display = '';
    fab.classList.add('audio-fab--playing');
    clearTimeout(collapseTimer);
    window.addEventListener('scroll', onUserScroll, { passive: true });
    requestAnimationFrame(syncLoop);
  }

  function showPaused() {
    iconPlay.style.display = '';
    iconPause.style.display = 'none';
    fab.classList.remove('audio-fab--playing');
    if (currentHighlight) {
      currentHighlight.classList.remove('audio-highlight');
      currentHighlight = null;
    }
    window.removeEventListener('scroll', onUserScroll);
  }

  function scheduleCollapse() {
    clearTimeout(collapseTimer);
    collapseTimer = setTimeout(() => {
      if (audioEl && audioEl.paused) {
        player.style.display = 'none';
      }
    }, 3000);
  }

  // --- Play/pause ---
  async function togglePlay() {
    if (!audioEl) {
      fab.classList.add('audio-fab--loading');
      try {
        const url = await ensureAudioUrl();
        createAudio(url);
        loadTimestamps(); // async, don't await
        await audioEl.play();
        fab.classList.remove('audio-fab--loading');
        showPlaying();
      } catch (err) {
        fab.classList.remove('audio-fab--loading');
        console.error('Audio playback failed:', err);
        return;
      }
    } else if (audioEl.paused) {
      await audioEl.play();
      showPlaying();
    } else {
      audioEl.pause();
      showPaused();
      scheduleCollapse();
    }
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
