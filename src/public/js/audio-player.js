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
  // Highlight sync (window.NCNarration = the shared @noble-collective/userdata/narration engine —
  // the same alignment the mobile app uses; see Collective-Shared ARCHITECTURE §9b).
  let segs = null;        // prepared segments: timings repaired, Bible sentences split at verse starts
  let align = null;       // NarrationAlignment over blockEls
  let blockEls = [];      // the rendered blocks, reading order
  let activeShown = -1;   // the segment whose highlight is painted
  let pinnedIdx = -1;     // a heading playback was just started at (wins during its lead-in)
  let userScrolledAway = false;
  let programmaticScroll = false;
  const N = window.NCNarration;

  function getStorageKey() { return `audio-pos:${getBookPath()}/${getAudioFile()}`; }

  function formatTime(s) {
    if (!s || isNaN(s)) return '0:00';
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${sec.toString().padStart(2, '0')}`;
  }

  // --- Fetch signed URL ---
  async function ensureAudioUrl() {
    if (signedUrl) return signedUrl;
    const res = await fetch(`/api/audio/url/${getBookPath()}/${getAudioFile()}`);
    if (!res.ok) throw new Error('Failed to get audio URL');
    signedUrl = (await res.json()).url;
    return signedUrl;
  }

  // --- Fetch timestamps and align them to the page ---
  // Only the latest load may land: an auto-advance can start one for the next session while an
  // earlier one is still in flight, and the older response must not overwrite the newer.
  let timestampsLoadSeq = 0;
  async function loadTimestamps() {
    if (timestamps || !getTimestampsFile()) return;
    const seq = ++timestampsLoadSeq;
    try {
      const res = await fetch(`/api/audio/url/${getBookPath()}/${getTimestampsFile()}`);
      if (!res.ok || seq !== timestampsLoadSeq) return;
      const tsRes = await fetch((await res.json()).url);
      if (!tsRes.ok || seq !== timestampsLoadSeq) return;
      const data = await tsRes.json();
      if (seq !== timestampsLoadSeq) return;
      timestamps = data;
      buildSync();
    } catch (err) {
      console.warn('[audio] Failed to load timestamps:', err);
    }
  }

  // The blocks a sentence can light, in reading order: the innermost of these (a <p> inside an <li>
  // is the block, not the <li>). Pull-quotes repeat text already in the flow, so they're skipped.
  // Keep in step with Collective-Shared scripts/narration-golden/build-inputs.cjs (BLOCKS_FN).
  const BLOCK_SEL = 'h1,h2,h3,h4,h5,h6,p,li,div.attribution,td,th';
  // Text a block shows but the narrator doesn't read, and our own UI: verse numbers + footnote
  // refs (<sup>), bookmark markers ([data-nc-skip]), heading headphones.
  const SKIP_SEL = 'sup,[data-nc-skip],.heading-audio-icon,button,script,style,textarea';

  function collectBlocks(root) {
    const all = Array.from(root.querySelectorAll(BLOCK_SEL))
      .filter(el => !el.closest('aside.pullquote') && !el.closest('#audio-highlight-overlays'));
    const set = new Set(all);
    const hasChild = new Set();
    for (const el of all) {
      for (let p = el.parentElement; p && p !== root; p = p.parentElement) {
        if (set.has(p)) { hasChild.add(p); break; }
      }
    }
    return all.filter(el => !hasChild.has(el));
  }

  // The block's narratable text nodes (in order) — the coordinate the alignment's offsets are in.
  function textNodesOf(el) {
    const out = [];
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (!n.parentElement.closest(SKIP_SEL)) out.push(n);
    }
    return out;
  }
  function blockText(el) { return textNodesOf(el).map(n => n.nodeValue).join(''); }

  // Bible chapter data for the verse split (bible-chapter.ejs): {verses:[{verse,text}], headings}.
  function bibleAudioData() {
    const el = document.getElementById('bible-audio-data');
    if (!el) return null;
    try { return JSON.parse(el.textContent); } catch { return null; }
  }

  function buildSync() {
    if (!timestamps || !N) return;
    const contentEl = document.querySelector('.session-content');
    if (!contentEl) return;
    let s = N.repairSegmentTimings(N.parseNarrationSegments(timestamps));
    const bible = bibleAudioData();
    // One verse lit at a time: a sentence read across verses is cut at the word each verse begins.
    if (bible && bible.verses) s = N.splitSegmentsAtVerses(s, bible.verses, bible.headings || []);
    segs = s;
    verseWins = null; // the A–B loop's verse timeline is rebuilt from these segments
    blockEls = collectBlocks(contentEl);
    align = N.NarrationAlignment.build(blockEls.map(blockText), segs.map(x => x.text));
    activeShown = -1;
    const placed = segs.filter((_, i) => align.spansFor(i).length > 0).length;
    console.log(`[audio] Mapped ${placed}/${segs.length} segments to ${blockEls.length} block elements`);
    renderH2Markers();
    renderHeadingAudioIcons();
  }

  function resetSync() {
    if (loopUi) clearLoop();
    verseWins = null;
    timestamps = null;
    segs = null;
    align = null;
    blockEls = [];
    activeShown = -1;
    pinnedIdx = -1;
  }

  // The first sentence that starts in each heading block → [{el, seg}].
  function headingStarts(tags) {
    const out = [];
    if (!align) return out;
    blockEls.forEach((el, b) => {
      if (!tags.has(el.tagName)) return;
      const seg = align.firstSegmentStartingInBlock(b);
      if (seg !== null) out.push({ el, seg });
    });
    return out;
  }

  // Start playback at sentence `i`, a moment early (a seek lands late and can clip the first word),
  // with its highlight pinned through that lead-in.
  function seekToSegment(i) {
    if (!audioEl || !segs || !segs[i]) return;
    audioEl.currentTime = Math.max(0, segs[i].start - N.leadInBefore(segs, i));
    forceHighlightUpdate();
    pinnedIdx = i;
    updateHighlight(true);
  }

  // --- H2 section markers on the scrubber ---
  function renderH2Markers() {
    if (!segs || !getTotalDuration()) return;

    // Clear existing markers
    scrubberContainer.querySelectorAll('.scrubber-h2-marker').forEach(m => m.remove());

    const h2s = headingStarts(new Set(['H2']));
    if (h2s.length === 0) return;

    for (const { el, seg } of h2s) {
      const pct = (segs[seg].start / getTotalDuration()) * 100;
      const marker = document.createElement('div');
      marker.className = 'scrubber-h2-marker';
      marker.style.left = pct + '%';
      marker.title = blockText(el).trim();
      marker.addEventListener('click', function (e) {
        e.stopPropagation();
        seekToSegment(seg);
      });
      scrubberContainer.appendChild(marker);
    }
    console.log(`[audio] Rendered ${h2s.length} H2 markers on scrubber`);
  }

  // --- Heading audio icons (clickable jump-to-audio links) ---
  function renderHeadingAudioIcons() {
    if (!segs || !getTotalDuration()) return;

    for (const { el, seg } of headingStarts(new Set(['H1', 'H2', 'H3', 'H4', 'H5', 'H6']))) {
      if (el.querySelector('.heading-audio-icon')) continue;
      const icon = document.createElement('a');
      icon.className = 'heading-audio-icon';
      icon.href = '#';
      icon.title = 'Jump to audio';
      icon.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 18v-6a9 9 0 0 1 18 0v6"/><path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3zM3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z"/></svg>';
      icon.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        if (!audioEl) {
          // Start audio and seek after it loads
          togglePlay().then(function () { seekToSegment(seg); });
        } else {
          seekToSegment(seg);
          if (audioEl.paused) {
            audioEl.play();
            showPlaying();
          }
        }
      });
      el.appendChild(icon);
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

  // A DOM Range over raw [s, e) of a block's narratable text (computed fresh: the annotation layer
  // may have split text nodes since, but the text itself — and so the offsets — is unchanged).
  function rangeInBlock(el, s, e) {
    let seen = 0;
    let startNode = null, startOff = 0, endNode = null, endOff = 0;
    for (const n of textNodesOf(el)) {
      const len = n.nodeValue.length;
      if (!startNode && seen + len > s) { startNode = n; startOff = s - seen; }
      if (startNode && seen + len >= e) { endNode = n; endOff = e - seen; break; }
      seen += len;
    }
    if (!startNode || !endNode) return null;
    const range = document.createRange();
    range.setStart(startNode, Math.max(0, startOff));
    range.setEnd(endNode, Math.min(endOff, endNode.nodeValue.length));
    return range;
  }

  // Paint segment `i`'s highlight: its part in every block it covers (a sentence can run across
  // list items, verses in separate paragraphs, …).
  function paintSegment(i) {
    clearHighlight();
    const cp = overlayContainer.parentElement;
    if (!cp || !align || i < 0) return;
    const cRect = cp.getBoundingClientRect();
    for (const span of align.spansFor(i)) {
      const el = blockEls[span.block];
      if (!el || !el.isConnected) continue;
      const [s, e] = align.rawRange(span);
      let rects = null;
      try {
        const range = rangeInBlock(el, s, e);
        if (range) rects = range.getClientRects();
      } catch { /* fall through */ }
      if (!rects) rects = [el.getBoundingClientRect()];
      for (const r of rects) {
        if (r.width > 0 && r.height > 0) {
          addOverlayRect(r.left - cRect.left, r.top + window.scrollY - cp.offsetTop, r.width, r.height);
        }
      }
    }
  }

  function addOverlayRect(left, top, width, height) {
    const div = document.createElement('div');
    div.style.cssText = `position:absolute;left:${left}px;top:${top}px;width:${width}px;height:${height}px;background:rgba(100,160,220,0.15);border-radius:3px;pointer-events:none;`;
    overlayContainer.appendChild(div);
  }

  // Overlays are absolute rects: re-measure when the layout moves under them (resize, font size,
  // a late image, the annotation layer inserting a marker).
  let repaintQueued = false;
  function repaintSoon() {
    if (repaintQueued || activeShown < 0) return;
    repaintQueued = true;
    requestAnimationFrame(function () { repaintQueued = false; if (activeShown >= 0) paintSegment(activeShown); });
  }
  const layoutObserver = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(repaintSoon) : null;
  function observeLayout() {
    if (!layoutObserver) return;
    layoutObserver.disconnect();
    const sc = document.querySelector('.session-content');
    if (sc) layoutObserver.observe(sc);
  }
  observeLayout();
  window.addEventListener('resize', repaintSoon, { passive: true });

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
    scrollToHighlight(true);
    jumpLink.style.display = 'none';
  });

  // The painted highlight's first line, in viewport coordinates (null = nothing painted).
  function highlightTop() {
    const first = overlayContainer.firstChild;
    const cp = overlayContainer.parentElement;
    if (!first || !cp) return null;
    return cp.offsetTop + parseFloat(first.style.top) - window.scrollY;
  }

  // Keep the sentence about a third of the way down the reading area. Like the app, only move when
  // it has drifted more than 22% of the area from there (no scroll on every sentence).
  function scrollToHighlight(force) {
    const top = highlightTop();
    if (top === null) return;
    const { top: visTop, bottom: visBottom } = getVisibleBounds();
    const visHeight = visBottom - visTop;
    const target = visTop + visHeight * 0.33;
    if (!force && Math.abs(top - target) <= visHeight * 0.22) return;
    programmaticScroll = true;
    window.scrollTo({ top: Math.max(0, window.scrollY + top - target), behavior: 'smooth' });
    // Clear flag after smooth scroll settles
    setTimeout(function () { programmaticScroll = false; }, 600);
  }

  // Whether any part of the highlight is on screen (a tall highlight can start above the fold).
  function isHighlightVisible() {
    const { top: visTop, bottom: visBottom } = getVisibleBounds();
    const cp = overlayContainer.parentElement;
    if (!cp || !overlayContainer.firstChild) return true;
    for (const d of overlayContainer.children) {
      const top = cp.offsetTop + parseFloat(d.style.top) - window.scrollY;
      if (top + parseFloat(d.style.height) > visTop && top < visBottom) return true;
    }
    return false;
  }

  function updateJumpLink() {
    if (!audioEl || audioEl.paused || activeShown < 0 || !userScrolledAway) {
      jumpLink.style.display = 'none';
      return;
    }
    jumpLink.style.display = '';
  }

  // --- Update highlight for a given time ---
  function updateHighlight(forceScroll) {
    if (!segs || !align || !audioEl) return;
    const t = audioEl.currentTime;
    if (pinnedIdx >= 0 && segs[pinnedIdx] && t >= segs[pinnedIdx].start) pinnedIdx = -1;
    const i = N.segmentIndexAt(segs, t, pinnedIdx);
    const shown = i < 0 ? -1 : align.shownSegment(i, segs[i].end - segs[i].start);

    if (shown !== activeShown) {
      activeShown = shown;
      if (shown < 0) {
        clearHighlight();
      } else {
        paintSegment(shown);
        // Auto-scroll unless user has scrolled away
        if (forceScroll || !userScrolledAway) scrollToHighlight(forceScroll);
      }
    }
    updateJumpLink();
  }

  // --- Bible A–B loop (Scripture memory) ---
  // Repeat a verse range with a 1 s beat between repeats. A and B snap to WHOLE verses from the
  // verse-split segments (the shared engine's segmentVerses — the same verse placement the
  // highlight, the app's loop and Coram Deo's use): A = start of the verse being read, B = its end;
  // in a heading or a gap, A takes the next verse and B the previous one. Toggling repeat off keeps
  // A/B (× clears), as on Coram Deo. Only on Bible pages (#audio-loop).
  const loopUi = document.getElementById('audio-loop') ? {
    a: document.getElementById('audio-loop-a'),
    b: document.getElementById('audio-loop-b'),
    toggle: document.getElementById('audio-loop-toggle'),
    clear: document.getElementById('audio-loop-clear'),
    range: document.getElementById('audio-loop-range'),
  } : null;
  let loopA = null; // {verse, time, seek}
  let loopB = null; // {verse, time}
  let loopOn = false;
  let loopGapTimer = null; // the 1 s beat between repeats (audio paused, bar still "playing")
  let verseWins = null; // [{verse, start, end, first}] for the current chapter

  function verseWindows() {
    if (verseWins) return verseWins;
    const bible = bibleAudioData();
    if (!segs || !bible || !bible.verses) return [];
    const per = N.segmentVerses(segs, bible.verses, bible.headings || []);
    const by = new Map();
    per.forEach((vs, i) => {
      for (const v of vs) {
        const w = by.get(v);
        if (!w) by.set(v, { verse: v, start: segs[i].start, end: segs[i].end, first: i });
        else w.end = Math.max(w.end, segs[i].end);
      }
    });
    verseWins = [...by.values()].sort((x, y) => x.verse - y.verse);
    return verseWins;
  }

  // Where a repeat starts: a moment before A (a seek lands late and can clip a short first word) —
  // into the pause before the verse, or a hair when the verse begins mid-sentence.
  function loopSeek(w) {
    const lead = N.leadInBefore(segs, w.first);
    return Math.max(0, w.start - (lead > 0 ? lead : 0.05));
  }

  function snapLoopPoint(which) {
    const wins = verseWindows();
    if (!wins.length || !audioEl) return null;
    const t = audioEl.currentTime;
    const inside = wins.filter((w) => t >= w.start && t < w.end);
    if (inside.length) return which === 'A' ? inside[0] : inside[inside.length - 1];
    if (which === 'A') return wins.find((w) => w.start >= t - 0.25) || wins[wins.length - 1];
    return [...wins].reverse().find((w) => w.end <= t + 0.25) || wins[0];
  }

  function chapterTitle() {
    const h1 = document.querySelector('.session-content h1');
    return h1 ? blockText(h1).trim() : '';
  }

  function renderLoop() {
    if (!loopUi) return;
    loopUi.a.classList.toggle('is-set', !!loopA);
    loopUi.b.classList.toggle('is-set', !!loopB);
    loopUi.toggle.disabled = !(loopA && loopB && loopB.time > loopA.time);
    loopUi.toggle.setAttribute('aria-pressed', loopOn ? 'true' : 'false');
    loopUi.clear.hidden = !(loopA || loopB);
    const title = chapterTitle();
    loopUi.range.textContent = !loopA && !loopB ? ''
      : loopA && loopB ? (loopA.verse === loopB.verse ? `${title}:${loopA.verse}` : `${title}:${loopA.verse}–${loopB.verse}`)
      : loopA ? `${title}:${loopA.verse} –` : `– ${title}:${loopB.verse}`;
  }

  function setLoopPoint(which) {
    const w = snapLoopPoint(which);
    if (!w) return;
    if (which === 'A') loopA = { verse: w.verse, time: w.start, seek: loopSeek(w) };
    else loopB = { verse: w.verse, time: w.end };
    // Engages once both ends are set in order.
    loopOn = !!(loopA && loopB && loopB.time > loopA.time);
    renderLoop();
  }

  function cancelLoopGap() {
    if (loopGapTimer) { clearTimeout(loopGapTimer); loopGapTimer = null; }
  }

  function clearLoop() {
    cancelLoopGap();
    loopA = loopB = null;
    loopOn = false;
    verseWins = null;
    renderLoop();
  }

  // Back to A with a 1 s beat. True when it took over (the caller stops).
  function repeatLoop() {
    if (!audioEl || !loopA) return false;
    cancelLoopGap();
    audioEl.pause();
    audioEl.currentTime = loopA.seek;
    forceHighlightUpdate();
    loopGapTimer = setTimeout(function () {
      loopGapTimer = null;
      if (audioEl) audioEl.play().catch(function () {});
    }, 1000);
    return true;
  }

  // Looping, and the playhead is outside [A, B] — B reached (the repeat), or a seek / ±15 s moved
  // it out: back to A.
  function enforceLoop() {
    if (!loopOn || loopGapTimer || !loopA || !loopB || !audioEl) return false;
    const t = audioEl.currentTime;
    if (t >= loopB.time - 0.05 || t < loopA.seek - 0.05) return repeatLoop();
    return false;
  }

  if (loopUi) {
    loopUi.a.addEventListener('click', function (e) { e.stopPropagation(); setLoopPoint('A'); });
    loopUi.b.addEventListener('click', function (e) { e.stopPropagation(); setLoopPoint('B'); });
    loopUi.toggle.addEventListener('click', function (e) {
      e.stopPropagation();
      loopOn = !loopOn && !!(loopA && loopB && loopB.time > loopA.time);
      if (!loopOn) cancelLoopGap();
      renderLoop();
    });
    loopUi.clear.addEventListener('click', function (e) { e.stopPropagation(); clearLoop(); });
  }

  // --- Sync loop ---
  // One loop at a time; (re)started by ANY resume of the element — the lock screen / Control
  // Center play it directly, not through our button.
  let syncRunning = false;
  function syncLoop() {
    if (!audioEl || audioEl.paused) { syncRunning = false; return; }
    if (enforceLoop()) { syncRunning = false; return; } // runs before the highlight (no flash of B)
    updateHighlight(false);
    requestAnimationFrame(syncLoop);
  }
  function startSync() {
    if (syncRunning) return;
    syncRunning = true;
    requestAnimationFrame(syncLoop);
  }

  // Force highlight recalculation after skip/scrub
  function forceHighlightUpdate() {
    activeShown = -1;
    pinnedIdx = -1;
    userScrolledAway = false;
    if (audioEl) updateHighlight(true);
  }

  function onUserScroll() {
    if (programmaticScroll) return;
    // Mark as scrolled away if the highlight is no longer visible
    if (activeShown >= 0 && !isHighlightVisible()) {
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
    audioEl.addEventListener('playing', startSync);
    audioEl.addEventListener('seeked', () => updateHighlight(false));
    audioEl.addEventListener('pause', () => { if (!audioEl.ended && !loopGapTimer) emitAudio('audio_pause'); });
    // The button follows the element, not just our own taps: iOS pauses/resumes it from the lock
    // screen, Control Center, AirPods and phone calls. (The A–B loop's 1 s beat pauses on purpose
    // and the bar stays "playing".)
    audioEl.addEventListener('pause', () => { if (!loopGapTimer) showPaused(); });
    audioEl.addEventListener('play', showPlaying);

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
      // A loop whose B is the chapter's last verse repeats instead of moving on.
      if (loopOn && loopA && repeatLoop()) return;
      emitAudio('audio_ended');
      showPaused();
      localStorage.removeItem(getStorageKey());
      var currentNextUrl = getNextUrl();
      if (window.__ajaxNav && currentNextUrl) {
        window.__ajaxNav.navigateToSession(currentNextUrl, { autoplay: true });
      } else if (currentNextUrl && document.getElementById('bible-audio-data')) {
        swapBibleChapter(currentNextUrl);
      } else if (currentNextUrl) {
        localStorage.setItem('audio-autoplay', 'true');
        window.location.href = currentNextUrl;
      }
    });
  }

  // --- Bible: next chapter in place ---
  // Swap the next chapter into this page and keep playing on the SAME audio element. A full page
  // load + an un-gestured play() on a new element is blocked on phones, so listening stopped at
  // every chapter end; the same element keeps the listener's earlier play gesture.
  let bibleSwapped = false;
  async function swapBibleChapter(url) {
    let doc = null;
    try {
      const res = await fetch(url);
      if (res.ok) doc = new DOMParser().parseFromString(await res.text(), 'text/html');
    } catch { /* fall back below */ }
    const nextReading = doc && doc.querySelector('.reading-content');
    const nextFab = doc && doc.getElementById('audio-fab');
    const reading = document.querySelector('.reading-content');
    if (!nextReading || !nextFab || !reading) {
      localStorage.setItem('audio-autoplay', 'true');
      window.location.href = url;
      return;
    }
    reading.replaceWith(document.importNode(nextReading, true));
    for (const sel of ['.reading-top .breadcrumb', '.sidebar']) {
      const cur = document.querySelector(sel);
      const next = doc.querySelector(sel);
      if (cur && next) cur.replaceWith(document.importNode(next, true));
    }
    document.title = doc.title;
    history.pushState({ bibleSwap: true }, '', url);
    bibleSwapped = true;
    window.scrollTo(0, 0);
    // Mobile TOC + sidebar toggles bind to the (swapped) sidebar.
    if (typeof window.__reinitAfterSwap === 'function') window.__reinitAfterSwap();

    // Annotations (highlights/notes/bookmarks) for the new chapter.
    const ctxEl = document.getElementById('nc-reader-ctx-data');
    if (ctxEl) {
      try {
        const ctx = JSON.parse(ctxEl.textContent);
        window.__READER_CTX = ctx;
        if (typeof window.__ncReattach === 'function') window.__ncReattach(ctx);
      } catch { /* annotations stay as they were */ }
    }
    // Analytics: a pageview for the new chapter.
    const chapter = new URL(url, location.href).searchParams.get('chapter');
    if (window.__analyticsContext && chapter) {
      window.__analyticsContext = Object.assign({}, window.__analyticsContext, { bible_chapter: chapter });
    }
    if (typeof window.__analyticsPageview === 'function') window.__analyticsPageview();

    window.__audioPlayer.updateSession({
      bookPath: nextFab.dataset.bookPath,
      audioFile: nextFab.dataset.audioFile,
      timestampsFile: nextFab.dataset.timestampsFile || '',
      duration: nextFab.dataset.duration || 0,
      nextUrl: nextFab.dataset.nextUrl || '',
      durationFormatted: formatTime(parseFloat(nextFab.dataset.duration) || 0),
    });
    window.__audioPlayer.rebuildHighlightContainer();
    window.__audioPlayer.playNextChapter();
  }
  // Back/forward after an in-place swap: load the page the URL names.
  window.addEventListener('popstate', function () { if (bibleSwapped) location.reload(); });

  // --- UI ---
  function showPlaying() {
    iconPlay.style.display = 'none';
    iconPause.style.display = '';
    player.style.display = '';
    fab.style.display = 'none';
    window.addEventListener('scroll', onUserScroll, { passive: true });
    startSync();
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
    activeShown = -1;
    if (loopUi) clearLoop();
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
    } else if (loopGapTimer) {
      cancelLoopGap(); // tapping pause during the 1 s beat between repeats
      showPaused();
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
      resetSync();
      userScrolledAway = false;
      clearHighlight();

      // Remove old heading audio icons and H2 markers
      document.querySelectorAll('.heading-audio-icon').forEach(function (el) { el.remove(); });
      scrubberContainer.querySelectorAll('.scrubber-h2-marker').forEach(function (m) { m.remove(); });

      // Load the new session's timestamps now, not after play(): on iOS an un-gestured play()
      // rejects (NotAllowedError → "Tap to continue"), and the session then had no highlight.
      window.__audioPlayer.loadNewTimestamps();

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
      observeLayout();
    },

    /** Fetch timestamps for the new session, rebuild segment map and heading icons */
    loadNewTimestamps: function () {
      resetSync();
      loadTimestamps();
    },

    /** Audit/test hook: every sentence and the page text its highlight covers ('' = not placed). */
    debugAlignment: function () {
      if (!segs || !align) return null;
      return segs.map(function (s, i) {
        var sups = 0; // verse numbers strictly inside the highlight (Bible: must stay 0)
        var first = align.spansFor(i)[0];
        var at = first ? first.block + ':' + align.rawRange(first)[0] : null; // where it starts
        var lit = align.spansFor(i).map(function (sp) {
          var r = align.rawRange(sp);
          var range = rangeInBlock(blockEls[sp.block], r[0], r[1]);
          if (range) sups += range.cloneContents().querySelectorAll('sup').length;
          return blockText(blockEls[sp.block]).slice(r[0], r[1]);
        }).join(' ');
        return { start: s.start, end: s.end, text: s.text, lit: lit, sups: sups, at: at };
      });
    },

    /** Test hook: the A–B loop's state. */
    loopState: function () {
      return { a: loopA, b: loopB, on: loopOn, gap: !!loopGapTimer, label: loopUi ? loopUi.range.textContent : null };
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
