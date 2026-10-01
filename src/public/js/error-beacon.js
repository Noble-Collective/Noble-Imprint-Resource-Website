/**
 * error-beacon.js — report uncaught errors and unhandled promise rejections to /api/client-error
 * (src/server/client-error.js), so a Safari-only crash shows up in the server log and the error alert
 * instead of staying invisible (Collective-Shared plans/2026-10-01-safari-quality.md, Layer 5).
 * Loaded first in <head>. Tiny and best-effort: at most 5 reports per page, repeats and noise
 * (extensions, opaque cross-origin "Script error.", the ResizeObserver warning) dropped, never throws.
 * The reader has no boot gate to watch (reading never waits on sign-in or audio).
 */
(function () {
  var MAX = 5;
  var sent = 0;
  var seen = {};
  var NOISE = /^(?:Uncaught )?(?:Error: )?(Script error\.?|ResizeObserver loop (limit exceeded|completed with undelivered notifications)\.?)$/i;
  var EXT = /(chrome|moz|safari|safari-web|ms-browser)-extension:\/\//i;
  // Firestore's own transport: Safari reports an aborted WebChannel request as "…/Listen/channel… due to access
  // control checks"; the SDK reconnects by itself.
  var FIRESTORE_CHANNEL = /google\.firestore\.v1\.Firestore\/(Listen|Write)\/channel/;

  function report(kind, message, stack) {
    try {
      message = String(message || '').slice(0, 500);
      stack = String(stack || '').slice(0, 4000);
      if (!message || sent >= MAX || NOISE.test(message.trim()) || EXT.test(stack) || EXT.test(message) || FIRESTORE_CHANNEL.test(message)) return;
      var key = kind + '|' + message;
      if (seen[key]) return;
      seen[key] = true;
      sent++;
      var body = JSON.stringify({ kind: kind, message: message, stack: stack, url: location.href.slice(0, 500) });
      // Also kept in the page for the nightly real-Safari crawl (WebDriver can't read Safari's console).
      (window.__ncErrors = window.__ncErrors || []).push(body);
      var ok = false;
      try { ok = navigator.sendBeacon && navigator.sendBeacon('/api/client-error', new Blob([body], { type: 'application/json' })); } catch (e) { ok = false; }
      if (!ok && window.fetch) {
        fetch('/api/client-error', { method: 'POST', body: body, headers: { 'Content-Type': 'application/json' }, keepalive: true }).catch(function () {});
      }
    } catch (e) { /* best effort */ }
  }

  function describe(reason) {
    if (reason && typeof reason === 'object' && 'message' in reason) {
      return { message: (reason.name ? reason.name + ': ' : '') + reason.message, stack: reason.stack || '' };
    }
    var m;
    try { m = typeof reason === 'string' ? reason : JSON.stringify(reason); } catch (e) { m = String(reason); }
    return { message: m || String(reason), stack: '' };
  }

  window.addEventListener('error', function (e) {
    // Resource load errors (an <img> 404) arrive here too, without a message: not ours to report.
    if (!e.message && !e.error) return;
    var d = e.error ? describe(e.error) : { message: e.message, stack: (e.filename || '') + ':' + e.lineno + ':' + e.colno };
    report('error', d.message, d.stack);
  });
  window.addEventListener('unhandledrejection', function (e) {
    var d = describe(e.reason);
    report('rejection', d.message, d.stack);
  });
})();
