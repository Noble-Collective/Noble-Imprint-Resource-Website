// POST /api/client-error — the client error beacon (src/public/js/error-beacon.js; Collective-Shared
// plans/2026-10-01-safari-quality.md, Layer 5). One structured ERROR log line per report, so the "Resource Website —
// runtime errors" alert emails a browser-only crash instead of it staying invisible. Unauthenticated, so: field caps,
// a per-instance rate limit, browser/OS from the server's own UA parse (never the raw UA or the IP), URLs without
// query strings or token-like segments. Always 204.
const { parseUserAgent } = require('./analytics');

const KINDS = new Set(['error', 'rejection', 'boot-stuck']);

function redactUrl(raw) {
  if (typeof raw !== 'string' || !raw) return '';
  try {
    const u = new URL(raw);
    const p = u.pathname.split('/').map((s) => (s.length >= 24 && /^[A-Za-z0-9_-]+$/.test(s) ? '…' : s)).join('/');
    return (u.origin + p).slice(0, 300);
  } catch {
    return raw.slice(0, 100);
  }
}

function normalize(body) {
  if (!body || typeof body !== 'object') return null;
  if (!KINDS.has(body.kind) || typeof body.message !== 'string' || !body.message) return null;
  const stack = typeof body.stack === 'string'
    ? body.stack.slice(0, 4000).replace(/https?:\/\/[^\s)]+?(?=:\d+:\d+|[\s)]|$)/g, (u) => redactUrl(u))
    : '';
  return { kind: body.kind, error: body.message.slice(0, 500), stack, page: redactUrl(body.url) };
}

function createRateLimiter(limit, windowMs, now = Date.now) {
  let start = now();
  let count = 0;
  return () => {
    const t = now();
    if (t - start > windowMs) { start = t; count = 0; }
    if (count >= limit) return false;
    count++;
    return true;
  };
}

const allow = createRateLimiter(30, 60 * 1000);

function handler(req, res) {
  try {
    const r = normalize(req.body);
    if (r && allow()) {
      const { browser, os, device_type } = parseUserAgent(req.headers['user-agent']);
      console.log(JSON.stringify({
        severity: 'ERROR',
        message: `Client ${r.kind} (${browser}, ${os}): ${r.error}`,
        type: 'client-error', ...r, browser, os, device: device_type,
      }));
    }
  } catch { /* best effort */ }
  res.status(204).end();
}

module.exports = { handler, normalize, redactUrl, createRateLimiter };
