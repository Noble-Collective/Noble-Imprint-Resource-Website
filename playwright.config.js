require('dotenv').config();
const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests',
  timeout: 60000,
  // These tests share one Test Book file + Firestore state and hit the real
  // GitHub API, so they MUST run serially (parallel workers clobber each other's
  // state). Retries absorb legitimate timing flakes (10s suggestion poll, 1.5s
  // auto-save debounce, 15s cross-user propagation); cheap now that scoped
  // refresh + GitHub App auth removed the rate-limit pressure.
  retries: 2,
  workers: 1,
  // ajax-nav-manual is an explicitly manual/--headed spec (its markers rely on
  // headed navigation); run it on its own, not in the automated baseline.
  testIgnore: ['**/ajax-nav-manual.spec.js'],
  globalSetup: require.resolve('./tests/global-setup.js'),
  use: {
    baseURL: 'http://localhost:8080',
    headless: true,
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { browserName: 'chromium' },
    },
  ],
});
