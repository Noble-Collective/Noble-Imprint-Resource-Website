// Safari < 18 only understands the -webkit- prefixed backdrop-filter; without it the translucent
// sticky header shows the page text sharply through it on iOS 17 and older (2026-10-01 Safari audit).
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const css = fs.readFileSync(path.join(__dirname, '../../src/public/css/style.css'), 'utf8');

test('every backdrop-filter rule also sets -webkit-backdrop-filter', () => {
  const missing = [];
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const [, selector, body] = m;
    if (/(^|[;\s])backdrop-filter\s*:/.test(body) && !/-webkit-backdrop-filter\s*:/.test(body)) missing.push(selector.trim());
  }
  assert.deepStrictEqual(missing, []);
});
