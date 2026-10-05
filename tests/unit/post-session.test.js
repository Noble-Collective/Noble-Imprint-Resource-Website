// The reader's ID-token → server __session exchange (sign-in plan P2). The server now answers 403
// { error: 'email-not-verified' } for an account without a verified email; the client must treat
// that as a quiet "no server session" (the reader keeps working client-side) — never a reload loop.
const { test } = require('node:test');
const assert = require('node:assert');

const fakeFetch = (status, body) => async (url, init) => {
  fakeFetch.last = { url, init };
  return { ok: status >= 200 && status < 300, status, json: async () => body };
};

test('postSession: 200 → ok, posts the token + profile as JSON', async () => {
  const { postSession } = await import('../../src/reader-userdata/util.js');
  const r = await postSession('tok', { displayName: 'A', photoURL: null }, fakeFetch(200, { status: 'ok' }));
  assert.strictEqual(r, 'ok');
  assert.strictEqual(fakeFetch.last.url, '/api/auth/session');
  assert.deepStrictEqual(JSON.parse(fakeFetch.last.init.body), { idToken: 'tok', profile: { displayName: 'A', photoURL: null } });
});

test('postSession: 403 email-not-verified → email-not-verified', async () => {
  const { postSession } = await import('../../src/reader-userdata/util.js');
  assert.strictEqual(await postSession('t', {}, fakeFetch(403, { error: 'email-not-verified' })), 'email-not-verified');
});

test('postSession: any other failure (401, network) → error, never throws', async () => {
  const { postSession } = await import('../../src/reader-userdata/util.js');
  assert.strictEqual(await postSession('t', {}, fakeFetch(401, { error: 'Invalid token' })), 'error');
  assert.strictEqual(await postSession('t', {}, async () => { throw new Error('offline') }), 'error');
  assert.strictEqual(await postSession('t', {}, fakeFetch(403, null)), 'error');
});
