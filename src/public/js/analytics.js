// First-party analytics beacon (P0: pageview + dwell).
//
// Sends events to /api/analytics/collect via navigator.sendBeacon (survives
// page unload). No cookies — anonymous IDs live in local/sessionStorage, so no
// consent banner is required. Honors Do-Not-Track / Global Privacy Control.
//
// Dwell time counts only while the tab is visible: we accrue active time between
// ticks, heartbeat it every 15s, and flush the remainder when the tab is hidden
// or the page is unloaded. Audio + richer context are added in later phases.
(function () {
  'use strict';

  // Respect Do-Not-Track / Global Privacy Control.
  if (navigator.doNotTrack === '1' || window.doNotTrack === '1' || navigator.globalPrivacyControl === true) return;

  var ENDPOINT = '/api/analytics/collect';
  var HEARTBEAT_MS = 15000;
  var SESSION_IDLE_MS = 30 * 60 * 1000;

  function uuid() {
    if (window.crypto && crypto.randomUUID) { try { return crypto.randomUUID(); } catch (e) {} }
    return Date.now().toString(16) + '-' + Math.random().toString(16).slice(2);
  }

  // Persistent anonymous visitor id.
  var visitorId;
  try {
    visitorId = localStorage.getItem('ni_vid');
    if (!visitorId) { visitorId = uuid(); localStorage.setItem('ni_vid', visitorId); }
  } catch (e) { visitorId = uuid(); }

  // Session id, rotated after 30 min of inactivity.
  function sessionId() {
    var now = Date.now(), id, ts;
    try {
      id = sessionStorage.getItem('ni_sid');
      ts = parseInt(sessionStorage.getItem('ni_sid_ts') || '0', 10);
      if (!id || (now - ts) > SESSION_IDLE_MS) id = uuid();
      sessionStorage.setItem('ni_sid', id);
      sessionStorage.setItem('ni_sid_ts', String(now));
    } catch (e) { id = id || uuid(); }
    return id;
  }

  var ctx = window.__analyticsContext || null; // reserved for P1 (canonical content identity)

  function send(ev) {
    ev.session_id = sessionId();
    ev.visitor_id = visitorId;
    ev.path = location.pathname + location.search;
    if (ctx) ev.context = ctx;
    try {
      var payload = JSON.stringify(ev);
      if (navigator.sendBeacon) {
        navigator.sendBeacon(ENDPOINT, new Blob([payload], { type: 'application/json' }));
      } else {
        fetch(ENDPOINT, { method: 'POST', body: payload, headers: { 'Content-Type': 'application/json' }, keepalive: true });
      }
    } catch (e) { /* best-effort */ }
  }

  // --- pageview ---
  send({ event_type: 'pageview', referrer: document.referrer || '' });

  // --- dwell tracking ---
  var accrued = 0;
  var lastTick = Date.now();
  var visible = document.visibilityState === 'visible';

  function accrue() {
    var now = Date.now();
    if (visible) accrued += now - lastTick;
    lastTick = now;
  }

  function flushDwell(isFinal) {
    accrue();
    if (accrued <= 0) return;
    var ms = accrued;
    accrued = 0;
    send({ event_type: isFinal ? 'dwell_final' : 'heartbeat', dwell_ms: Math.round(ms) });
  }

  var hb = setInterval(function () { flushDwell(false); }, HEARTBEAT_MS);
  if (hb && hb.unref) { /* node only; noop in browser */ }

  document.addEventListener('visibilitychange', function () {
    accrue();
    if (document.visibilityState === 'hidden') { visible = false; flushDwell(false); }
    else { visible = true; lastTick = Date.now(); }
  });

  window.addEventListener('pagehide', function () { flushDwell(true); });

  // AJAX session auto-advance swaps content without a reload — emit a fresh
  // pageview + reset dwell when that happens.
  window.__analyticsPageview = function () {
    flushDwell(true);
    lastTick = Date.now();
    ctx = window.__analyticsContext || null;
    send({ event_type: 'pageview', referrer: document.referrer || '' });
  };
})();
