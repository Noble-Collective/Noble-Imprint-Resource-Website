// Safari/WebKit regression suite (tests/safari/). Separate from the main suite: no local server, no
// GitHub, no sign-in. It loads PUBLIC pages (prod by default; SAFARI_BASE_URL=http://localhost:8080
// to point at a local server) and swaps in the WORKING-TREE copies of the client assets
// (audio-player.js, reader-userdata-bundle.js, style.css) via request routing, so it tests local
// code in WebKit before anything is deployed. Read-only GETs only.
//
//   npx playwright test -c playwright.safari.config.js
//
// WebKit here is Playwright's build (Windows/Linux), not real iOS: it can't reproduce iOS-only
// behaviour (focus auto-zoom, lock screen, autoplay gesture windows, bfcache, touch "clickability").
// Those are covered by asserting the conditions that trigger them (e.g. computed font sizes).
const { defineConfig, devices } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests/safari',
  timeout: 60000,
  retries: 1,
  workers: 2,
  use: {
    baseURL: process.env.SAFARI_BASE_URL || 'https://resources.noblecollective.org',
    headless: true,
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'webkit-iphone', use: { ...devices['iPhone 15'] } },
    { name: 'webkit-desktop', use: { ...devices['Desktop Safari'] } },
    { name: 'chromium-android', use: { ...devices['Pixel 7'] } }, // parity baseline
  ],
});
