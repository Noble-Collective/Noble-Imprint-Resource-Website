// Shared Playwright test fixture — auto-cleans Test Book suggestion/comment/reply
// state in Firestore before EVERY test, so tests don't inherit leftover state from
// each other (the dominant cause of count/anchor/dedup failures in the suite).
//
// Specs import { test, expect } from THIS file instead of '@playwright/test'.
// The `_autoClean` fixture has { auto: true }, so it runs for every test with no
// per-spec boilerplate. It calls the server's /api/cleanup-test-data endpoint,
// which runs where Firestore is already initialised (no admin creds in-process).
const base = require('@playwright/test');

const BASE = process.env.BASE_URL || 'http://localhost:8080';

const test = base.test.extend({
  _autoClean: [async ({ request }, use) => {
    await request.post(BASE + '/api/cleanup-test-data');
    await use();
  }, { auto: true }],
});

module.exports = { test, expect: base.expect };
