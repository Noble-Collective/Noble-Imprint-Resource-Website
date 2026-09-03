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
