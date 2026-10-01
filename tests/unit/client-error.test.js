const { test } = require('node:test');
const assert = require('node:assert/strict');
const { normalize, createRateLimiter } = require('../../src/server/client-error');

test('normalize keeps kind/message/stack/page and redacts URLs, including inside the stack', () => {
  assert.deepEqual(normalize({
    kind: 'rejection',
    message: 'TypeError: Load failed',
    stack: 'f@https://resources.noblecollective.org/static/js/audio-player.js?v=35:10:4',
    url: 'https://resources.noblecollective.org/bible/bsb/John?chapter=3',
  }), {
    kind: 'rejection',
    error: 'TypeError: Load failed',
    stack: 'f@https://resources.noblecollective.org/static/js/audio-player.js:10:4',
    page: 'https://resources.noblecollective.org/bible/bsb/John',
  });
});

test('normalize refuses unknown kinds, empty messages and non-objects', () => {
  assert.equal(normalize({ kind: 'spam', message: 'x' }), null);
  assert.equal(normalize({ kind: 'error', message: '' }), null);
  assert.equal(normalize('x'), null);
  assert.equal(normalize(null), null);
});

test('normalize caps long fields', () => {
  const r = normalize({ kind: 'error', message: 'm'.repeat(900), stack: 's'.repeat(9000) });
  assert.equal(r.error.length, 500);
  assert.equal(r.stack.length, 4000);
});

test('the rate limiter allows `limit` per window', () => {
  let now = 0;
  const allow = createRateLimiter(2, 1000, () => now);
  assert.deepEqual([allow(), allow(), allow()], [true, true, false]);
  now = 1001;
  assert.equal(allow(), true);
});
