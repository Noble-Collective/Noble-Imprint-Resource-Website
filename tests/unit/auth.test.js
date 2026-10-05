const { test } = require('node:test');
const assert = require('node:assert');

const auth = require('../../src/server/auth');

// --- timingSafeEqualStr -------------------------------------------------------

test('timingSafeEqualStr: equal strings match', () => {
  assert.strictEqual(auth.timingSafeEqualStr('s3cret-value', 's3cret-value'), true);
});

test('timingSafeEqualStr: different values do not match', () => {
  assert.strictEqual(auth.timingSafeEqualStr('s3cret-value', 's3cret-wrong'), false);
});

test('timingSafeEqualStr: different lengths do not match', () => {
  assert.strictEqual(auth.timingSafeEqualStr('short', 'a-much-longer-secret'), false);
});

test('timingSafeEqualStr: empty / non-string inputs never match', () => {
  assert.strictEqual(auth.timingSafeEqualStr('', ''), false);
  assert.strictEqual(auth.timingSafeEqualStr('x', ''), false);
  assert.strictEqual(auth.timingSafeEqualStr(undefined, 'x'), false);
  assert.strictEqual(auth.timingSafeEqualStr(null, null), false);
  assert.strictEqual(auth.timingSafeEqualStr(123, 123), false);
});

// --- requireRefreshSecret -----------------------------------------------------

// Minimal Express req/res/next doubles.
function mkReq({ user = null, headers = {} } = {}) {
  return { user, headers };
}
function mkRes() {
  return {
    statusCode: null,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
  };
}
function run(mw, req) {
  const res = mkRes();
  let nextCalled = false;
  mw(req, res, () => { nextCalled = true; });
  return { res, nextCalled };
}

// Save/restore env around each scenario.
function withEnv(env, fn) {
  const saved = {};
  for (const k of Object.keys(env)) { saved[k] = process.env[k]; }
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
  try { fn(); } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  }
}

test('requireRefreshSecret: admin session always passes', () => {
  withEnv({ NODE_ENV: 'production', REFRESH_SECRET: 'the-secret' }, () => {
    const { nextCalled } = run(auth.requireRefreshSecret, mkReq({ user: { isAdmin: true } }));
    assert.strictEqual(nextCalled, true);
  });
});

test('requireRefreshSecret: correct Bearer secret passes in production', () => {
  withEnv({ NODE_ENV: 'production', REFRESH_SECRET: 'the-secret' }, () => {
    const req = mkReq({ headers: { authorization: 'Bearer the-secret' } });
    const { nextCalled } = run(auth.requireRefreshSecret, req);
    assert.strictEqual(nextCalled, true);
  });
});

test('requireRefreshSecret: correct x-refresh-key secret passes in production', () => {
  withEnv({ NODE_ENV: 'production', REFRESH_SECRET: 'the-secret' }, () => {
    const req = mkReq({ headers: { 'x-refresh-key': 'the-secret' } });
    const { nextCalled } = run(auth.requireRefreshSecret, req);
    assert.strictEqual(nextCalled, true);
  });
});

test('requireRefreshSecret: wrong secret is rejected 403 in production', () => {
  withEnv({ NODE_ENV: 'production', REFRESH_SECRET: 'the-secret' }, () => {
    const req = mkReq({ headers: { authorization: 'Bearer nope' } });
    const { res, nextCalled } = run(auth.requireRefreshSecret, req);
    assert.strictEqual(nextCalled, false);
    assert.strictEqual(res.statusCode, 403);
  });
});

test('requireRefreshSecret: FAILS CLOSED — unset secret rejects 500 in production', () => {
  withEnv({ NODE_ENV: 'production', REFRESH_SECRET: undefined }, () => {
    const { res, nextCalled } = run(auth.requireRefreshSecret, mkReq());
    assert.strictEqual(nextCalled, false);
    assert.strictEqual(res.statusCode, 500);
  });
});

test('requireRefreshSecret: local dev (non-production) falls through without a secret', () => {
  withEnv({ NODE_ENV: 'development', REFRESH_SECRET: undefined }, () => {
    const { nextCalled } = run(auth.requireRefreshSecret, mkReq());
    assert.strictEqual(nextCalled, true);
  });
});

// --- verified email for every authorization decision (sign-in plan P2, ARCHITECTURE §9a.7) ------

const fs = require('node:fs');
const path = require('node:path');

test('trustedEmail: only a verified, non-empty email (trimmed, lower-cased)', () => {
  assert.strictEqual(auth.trustedEmail({ email: ' Steve@NobleCollective.org ', email_verified: true }), 'steve@noblecollective.org');
  assert.strictEqual(auth.trustedEmail({ email: 'a@b.c', email_verified: false }), null);
  assert.strictEqual(auth.trustedEmail({ email: 'a@b.c', email_verified: 'true' }), null);
  assert.strictEqual(auth.trustedEmail({ email: 'a@b.c' }), null);
  assert.strictEqual(auth.trustedEmail({ email_verified: true }), null);
  assert.strictEqual(auth.trustedEmail({ email: '   ', email_verified: true }), null);
  assert.strictEqual(auth.trustedEmail(null), null);
});

test('trustedEmail: the vendored server copy matches the SDK installed from vendor/ (no drift)', async () => {
  const strip = (s) => s.replace(/\r\n/g, '\n').replace(/^\/\/ VENDORED.*\n\/\/ Regenerate.*\n/, '').replace(/\n\/\/# sourceMappingURL=.*$/, '').trim();
  const sdkFile = path.join(__dirname, '../../node_modules/@noble-collective/userdata/dist/session-identity.cjs');
  const vendored = fs.readFileSync(path.join(__dirname, '../../src/vendor/session-identity.cjs'), 'utf8');
  assert.strictEqual(strip(vendored), strip(fs.readFileSync(sdkFile, 'utf8')),
    'src/vendor/session-identity.cjs is stale — run bash scripts/vendor-session-identity.sh');
});

test('userFromDecoded: unverified or email-less session cookie → no server user (no roles)', () => {
  const flags = { isAdmin: true, isEditor: true };
  assert.strictEqual(auth.userFromDecoded({ uid: 'u1', email: 'steve@noblecollective.org', email_verified: false }, flags), null);
  assert.strictEqual(auth.userFromDecoded({ uid: 'u1', email_verified: true }, flags), null);
});

test('userFromDecoded: verified → trusted lower-cased email drives super-admin + role flags', () => {
  const u = auth.userFromDecoded(
    { uid: 'u1', email: 'Steve@NobleCollective.org', email_verified: true, name: 'Steve' },
    { isAdmin: false, isEditor: false, displayName: 'Stored', photoURL: 'https://x/p.png' },
  );
  assert.strictEqual(u.email, 'steve@noblecollective.org');
  assert.strictEqual(u.isSuperAdmin, true);
  assert.strictEqual(u.isAdmin, true);
  assert.strictEqual(u.isEditor, true);
  assert.strictEqual(u.displayName, 'Steve');
  assert.strictEqual(u.photoURL, 'https://x/p.png'); // the cookie had no picture → the stored profile fills it
});

test('userFromDecoded: no name anywhere → falls back to the email', () => {
  const u = auth.userFromDecoded({ uid: 'u2', email: 'r@x.org', email_verified: true }, { isAdmin: false, isEditor: true });
  assert.strictEqual(u.displayName, 'r@x.org');
  assert.strictEqual(u.isAdmin, false);
  assert.strictEqual(u.isEditor, true);
});

function sessionDeps(decoded) {
  const calls = [];
  return {
    calls,
    deps: {
      verify: async (t) => { calls.push('verify:' + t); return decoded; },
      mint: async (t) => { calls.push('mint:' + t); return 'cookie-for-' + t; },
    },
  };
}

test('establishSession: unverified email → email-not-verified, and NO cookie is minted', async () => {
  const { calls, deps } = sessionDeps({ uid: 'u1', email: 'a@b.c', email_verified: false });
  const r = await auth.establishSession('tok', { displayName: 'A' }, deps);
  assert.deepStrictEqual(r, { error: 'email-not-verified', uid: 'u1' });
  assert.deepStrictEqual(calls, ['verify:tok']);
});

test('establishSession: verifies the token BEFORE minting the cookie', async () => {
  const { calls, deps } = sessionDeps({ uid: 'u1', email: 'A@B.c', email_verified: true, name: 'Ann' });
  const r = await auth.establishSession('tok', null, deps);
  assert.deepStrictEqual(calls, ['verify:tok', 'mint:tok']);
  assert.strictEqual(r.cookie, 'cookie-for-tok');
  assert.strictEqual(r.identity.trustedEmail, 'a@b.c');
  assert.strictEqual(r.identity.displayName, 'Ann');
});

test('establishSession: a bad token rejects before any cookie is minted', async () => {
  const calls = [];
  await assert.rejects(auth.establishSession('bad', null, {
    verify: async () => { calls.push('verify'); throw new Error('auth/argument-error'); },
    mint: async () => { calls.push('mint'); return 'c'; },
  }));
  assert.deepStrictEqual(calls, ['verify']);
});

test('establishSession: the token name wins; a client name only fills a gap and is bounded (≤100)', async () => {
  const withName = await auth.establishSession('t', { displayName: 'Client Name' },
    sessionDeps({ uid: 'u', email: 'a@b.c', email_verified: true, name: 'Token Name' }).deps);
  assert.strictEqual(withName.identity.displayName, 'Token Name');
  // Apple sends no name in the token: the client's (Apple's one-time name / the name prompt) fills it.
  const apple = await auth.establishSession('t', { displayName: '  Jane‮  Doe '.padEnd(300, 'x'), photoURL: 'javascript:alert(1)' },
    sessionDeps({ uid: 'u', email: 'x@privaterelay.appleid.com', email_verified: true }).deps);
  assert.ok(apple.identity.displayName.startsWith('Jane Doe'));
  assert.ok([...apple.identity.displayName].length <= 100);
  assert.strictEqual(apple.identity.photoURL, null); // non-https client photo dropped
});
