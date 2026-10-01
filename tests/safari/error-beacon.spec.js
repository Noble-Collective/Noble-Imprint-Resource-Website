/**
 * The client error beacon (src/public/js/error-beacon.js): uncaught errors and unhandled rejections are POSTed to
 * /api/client-error, once each, in every engine. The working-tree script is injected first (as the <head> tag
 * loads it), and the endpoint is answered here, so nothing reaches the server.
 * Run: npx playwright test -c playwright.safari.config.js error-beacon
 */
const fs = require('fs');
const path = require('path');
const { test, expect } = require('@playwright/test');

const BEACON = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'public', 'js', 'error-beacon.js'), 'utf8');

test('uncaught errors and rejections are reported once each; noise is not', async ({ page }) => {
  // Playwright's WebKit doesn't expose a sendBeacon Blob body to request interception, so the bodies are
  // recorded in the page by wrapping sendBeacon (which still sends).
  await page.route('**/api/client-error', (route) => route.fulfill({ status: 204 }));
  await page.addInitScript(() => {
    window.__beacons = [];
    const real = navigator.sendBeacon.bind(navigator);
    navigator.sendBeacon = (url, data) => {
      if (String(url).includes('/api/client-error')) data.text().then((t) => window.__beacons.push(t));
      return real(url, data);
    };
  });
  await page.route(/\/static\/js\/error-beacon\.js/, (route) => route.fulfill({ status: 204, body: '' })); // no double install
  await page.addInitScript(BEACON);
  await page.goto('/');
  await page.evaluate(() => {
    setTimeout(() => { throw new Error('beacon-test-error'); });
    setTimeout(() => { throw new Error('beacon-test-error'); }); // a repeat
    setTimeout(() => { throw new Error('ResizeObserver loop completed with undelivered notifications.'); });
    Promise.reject(new Error('beacon-test-rejection'));
  });
  const beacons = () => page.evaluate(() => window.__beacons);
  await expect.poll(async () => (await beacons()).length).toBe(2);
  await page.waitForTimeout(500);
  const sent = (await beacons()).map((b) => JSON.parse(b));
  expect(sent).toHaveLength(2);
  expect(sent.map((s) => s.kind).sort()).toEqual(['error', 'rejection']);
  expect(sent.find((s) => s.kind === 'error').message).toContain('beacon-test-error');
  expect(sent.find((s) => s.kind === 'rejection').message).toContain('beacon-test-rejection');
});
