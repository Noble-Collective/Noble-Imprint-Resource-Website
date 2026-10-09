// Library search (Collective-Shared plans/2026-10-09-library-search-terms.md P3; ARCHITECTURE §9d).
// 1. The vendored shared matcher (src/vendor/library-search.cjs) against its specification,
//    tests/unit/fixtures/library-search.cases.json — both from scripts/vendor-library-search.sh; the SDK
//    and the mobile app's Dart copy run the same cases.
// 2. The website's catalog (content tree + Bibles) is the catalog the case file is written for.
// 3. GET /api/library/search and /api/library/index (src/server/library-search.js), on a throwaway app.
const test = require('node:test');
const assert = require('node:assert');
const express = require('express');
const LS = require('../../src/vendor/library-search.cjs');
const lib = require('../../src/server/library-search');
const cases = require('./fixtures/library-search.cases.json');
const terms = require('./fixtures/library-search.terms.json');
const snapshot = require('../../src/.content-tree-cache.json');

const index = LS.resolveIndex(terms, cases.catalog);

// ---- 1. the shared case file -------------------------------------------------------------------

for (const [input, want] of cases.normalize) {
  test(`normalize ${JSON.stringify(input)} → ${JSON.stringify(want)}`, () => {
    assert.strictEqual(LS.normalize(input), want);
  });
}

test('index facts: visible books in Library order, unused keys, hidden absent', () => {
  assert.deepStrictEqual(index.books.map((b) => b.key), cases.catalog.filter((b) => !b.hidden).map((b) => b.key));
  assert.deepStrictEqual(index.unusedKeys, cases.index.unusedKeys);
  for (const key of cases.index.absent) assert.ok(!index.books.find((b) => b.key === key), key);
  for (const want of cases.index.books) {
    const book = index.books.find((b) => b.key === want.key);
    assert.deepStrictEqual(book.seriesPath, want.seriesPath, want.key);
    if (want.fieldCount) assert.strictEqual(book.fields.length, want.fieldCount, want.key);
    if (want.first) assert.deepStrictEqual(book.fields.slice(0, want.first.length), want.first, want.key);
    if (want.last) assert.deepStrictEqual(book.fields.at(-1), want.last, want.key);
  }
});

for (const c of cases.search) {
  test(`search case: ${c.name}`, () => {
    const results = LS.search(index, c.q);
    const keys = results.map((r) => r.key);
    if (c.keys) assert.deepStrictEqual(keys, c.keys);
    if (c.top) assert.deepStrictEqual(keys.slice(0, c.top.length), c.top);
    if (c.count !== undefined) assert.strictEqual(keys.length, c.count);
    for (const k of c.contains || []) assert.ok(keys.includes(k), `contains ${k}`);
    for (const k of c.absent || []) assert.ok(!keys.includes(k), `absent ${k}`);
    for (const [k, want] of Object.entries(c.matched || {})) {
      assert.deepStrictEqual((results.find((r) => r.key === k) || {}).matched, want, k);
    }
  });
}

for (const c of cases.validate) {
  test(`validate case: ${c.name}`, () => {
    const asSet = (ps) => ps.map(({ level, code, key, term }) =>
      JSON.stringify({ level, code, key, ...(term !== undefined ? { term } : {}) })).sort();
    const t = c.terms === 'fixture' ? terms : c.terms;
    const f = c.folders === 'fixture' ? cases.folders : c.folders;
    assert.deepStrictEqual(asSet(LS.validateTerms(t, f)), asSet(c.problems));
  });
}

// ---- 2. the website's catalog --------------------------------------------------------------------

// The Bibles as bible.getAllTranslations() lists them (titles as the case file's catalog has them).
const BIBLES = [
  { id: 'bsb', title: 'Berean Standard Bible', coverPath: 'bibles/bsb/cover.svg' },
  { id: 'kjv', title: 'King James Bible', coverPath: 'bibles/kjv/cover.svg' },
];

test('the catalog from the committed content tree + the Bibles is the case file\'s catalog', () => {
  const { catalog } = lib.buildCatalog(snapshot, BIBLES);
  assert.deepStrictEqual(catalog, cases.catalog);
});

test('the catalog links each book to its page and cover', () => {
  const { links } = lib.buildCatalog(snapshot, BIBLES);
  assert.deepStrictEqual(links.get('the-open-invitation'), {
    url: '/narrative-journey-series/essentials/the-open-invitation',
    cover: links.get('the-open-invitation').cover,
    banner: links.get('the-open-invitation').banner,
  });
  assert.match(links.get('the-open-invitation').cover, /^\/cover\/series\/Narrative Journey Series\/Essentials\/The Open Invitation\/cover\./);
  assert.deepStrictEqual(links.get('kjv'), { url: '/bible/kjv', cover: '/cover/bibles/kjv/cover.svg', banner: null });
});

test('a book without a meta.json id is keyed by its slug; a tree with no terms still searches titles', () => {
  const tree = { series: [{ type: 'series', title: 'S', slug: 's', children: [
    { type: 'book', key: null, slug: 'no-id', title: 'No Id Book', subtitle: '', status: 'public', repoPath: 'series/S/No Id', coverPath: null },
  ] }] };
  const idx = lib.getIndex(tree, []);
  assert.deepStrictEqual(idx.index.books.map((b) => [b.key, b.id]), [['no-id', null]]);
  assert.deepStrictEqual(lib.searchLibrary(idx, 'no id').results.map((r) => r.key), ['no-id']);
});

test('the index is computed once per tree and Bible list', () => {
  const tree = { ...snapshot, searchTerms: terms };
  const a = lib.getIndex(tree, BIBLES);
  assert.strictEqual(lib.getIndex(tree, BIBLES), a);
  assert.notStrictEqual(lib.getIndex(tree, BIBLES.slice(0, 1)), a);
  assert.match(a.etag, /^"[0-9a-f]{16,}"$/);
});

test('unknown terms keys are logged, never fatal', () => {
  const logged = [];
  const orig = console.warn;
  console.warn = (...a) => logged.push(a.join(' '));
  try {
    const tree = { ...snapshot, searchTerms: { version: 1, nodes: { ...terms.nodes, 'series/Nowhere': { title: 'x', primary: ['zz'], terms: [] } } } };
    const idx = lib.getIndex(tree, BIBLES);
    assert.ok(idx.index.unusedKeys.includes('series/Nowhere'));
  } finally { console.warn = orig; }
  assert.ok(logged.some((l) => l.includes('series/Nowhere')), logged.join('\n'));
});

// ---- 3. the routes -------------------------------------------------------------------------------

async function withServer(opts, fn) {
  const app = express();
  app.set('trust proxy', true);
  app.use(lib.router({
    getTree: async () => ({ ...snapshot, searchTerms: terms }),
    getBibles: () => BIBLES,
    ...opts,
  }));
  const server = await new Promise((r) => { const s = app.listen(0, () => r(s)); });
  try { return await fn(`http://127.0.0.1:${server.address().port}`); } finally { server.close(); }
}
const get = (url, headers) => fetch(url, { headers });

test('GET /api/library/search: shape, CORS, cache headers', () => withServer({}, async (base) => {
  const res = await get(`${base}/api/library/search?q=bsb`);
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.headers.get('access-control-allow-origin'), '*');
  assert.strictEqual(res.headers.get('cache-control'), 'public, max-age=600');
  const body = await res.json();
  assert.deepStrictEqual(body, {
    q: 'bsb',
    count: 1,
    results: [{
      key: 'bsb', id: null, title: 'Berean Standard Bible', subtitle: null, seriesPath: ['Bibles'],
      score: body.results[0].score, matched: { text: 'bsb', field: 'primary' },
      url: '/bible/bsb', cover: '/cover/bibles/bsb/cover.svg', banner: null,
    }],
  });
}));

test('GET /api/library/search: the product queries of plan §1', () => withServer({}, async (base) => {
  const keys = async (q) => (await (await get(`${base}/api/library/search?q=${encodeURIComponent(q)}`)).json()).results.map((r) => r.key);
  assert.deepStrictEqual(await keys('kjv'), ['kjv']);
  assert.strictEqual((await keys('catechism')).length, 12);
  assert.strictEqual((await keys('cate')).length, 12);
  assert.strictEqual((await keys('francais'))[0], 'lappel-du-christ');
  assert.strictEqual((await keys('advent'))[0], 'come-let-us-adore-him');
}));

test('GET /api/library/search: hidden books never appear', () => withServer({}, async (base) => {
  const body = await (await get(`${base}/api/library/search?q=test%20book`)).json();
  assert.ok(!body.results.some((r) => r.key === 'test-book'), JSON.stringify(body.results.map((r) => r.key)));
  const idx = await (await get(`${base}/api/library/index`)).json();
  assert.ok(!idx.books.some((b) => b.key === 'test-book'));
}));

test('GET /api/library/search: limit (default 50, max 100, garbage = default); count is every match', () => withServer({}, async (base) => {
  const q = async (s) => (await get(`${base}/api/library/search?${s}`)).json();
  const all = await q('q=a%20journey');
  assert.ok(all.count > 3, `count ${all.count}`);
  assert.strictEqual(all.results.length, all.count);
  const three = await q('q=a%20journey&limit=3');
  assert.strictEqual(three.results.length, 3);
  assert.strictEqual(three.count, all.count);
  assert.deepStrictEqual(three.results.map((r) => r.key), all.results.slice(0, 3).map((r) => r.key));
  for (const bad of ['limit=abc', 'limit=-5', 'limit=0', 'limit=1e9', 'limit=2.5x']) {
    const r = await q(`q=a%20journey&${bad}`);
    assert.ok(r.results.length >= 1 && r.results.length <= 100, `${bad} → ${r.results.length}`);
  }
  assert.strictEqual(lib.parseLimit(undefined), 50);
  assert.strictEqual(lib.parseLimit('500'), 100);
  assert.strictEqual(lib.parseLimit('0'), 50);
  assert.strictEqual(lib.parseLimit('7'), 7);
}));

test('GET /api/library/search: q is trimmed to 100 characters', () => withServer({}, async (base) => {
  const long = 'bsb' + ' '.repeat(97) + 'zzzz';
  const body = await (await get(`${base}/api/library/search?q=${encodeURIComponent(long)}`)).json();
  assert.strictEqual(body.q.length <= 100, true);
  assert.deepStrictEqual(body.results.map((r) => r.key), ['bsb']);
  const huge = await get(`${base}/api/library/search?q=${'x'.repeat(5000)}`);
  assert.strictEqual(huge.status, 200);
  assert.strictEqual((await huge.json()).q.length, 100);
}));

test('GET /api/library/search: empty, 1-letter, punctuation and garbage queries return nothing', () => withServer({}, async (base) => {
  for (const s of ['', 'q=', 'q=a', 'q=%20%20', 'q=!!!%20...', 'q=%E2%80%99', 'q[]=x&q[]=y', 'q[a]=b', 'q=%00%01']) {
    const res = await get(`${base}/api/library/search?${s}`);
    assert.strictEqual(res.status, 200, s);
    const body = await res.json();
    assert.deepStrictEqual([body.count, body.results], [0, []], s);
    assert.strictEqual(typeof body.q, 'string', s);
  }
}));

test('GET /api/library/search: per-IP rate limit 120/min', () => withServer({ rateLimitMax: 3 }, async (base) => {
  const as = (ip) => ({ 'x-forwarded-for': ip });
  for (let i = 0; i < 3; i++) assert.strictEqual((await get(`${base}/api/library/search?q=bsb`, as('1.1.1.1'))).status, 200);
  const limited = await get(`${base}/api/library/search?q=bsb`, as('1.1.1.1'));
  assert.strictEqual(limited.status, 429);
  assert.strictEqual(limited.headers.get('access-control-allow-origin'), '*');
  assert.strictEqual((await get(`${base}/api/library/search?q=bsb`, as('2.2.2.2'))).status, 200);
  assert.strictEqual(lib.DEFAULT_RATE_LIMIT, 120);
}));

test('GET /api/library/index: every visible book with its fields, version, ETag, 304', () => withServer({}, async (base) => {
  const res = await get(`${base}/api/library/index`);
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.headers.get('access-control-allow-origin'), '*');
  assert.strictEqual(res.headers.get('cache-control'), 'public, max-age=600');
  const etag = res.headers.get('etag');
  assert.match(etag, /^"[0-9a-f]{16,}"$/);
  const body = await res.json();
  assert.strictEqual(body.version, 1);
  assert.strictEqual(body.count, 24);
  assert.strictEqual(body.books.length, 24);
  const toi = body.books.find((b) => b.key === 'the-open-invitation');
  assert.deepStrictEqual(toi.seriesPath, ['Narrative Journey Series', 'Essentials']);
  assert.deepStrictEqual(toi.fields[0], { text: 'The Open Invitation', weight: 60, field: 'title' });
  assert.strictEqual(toi.url, '/narrative-journey-series/essentials/the-open-invitation');
  // The index is what the matcher needs: searching the served JSON gives the server's answer.
  assert.deepStrictEqual(LS.search(body, 'catechism').map((r) => r.key), LS.search(index, 'catechism').map((r) => r.key));
  // A browser's revalidation (plain http: fetch adds cache-control: no-cache to conditional requests).
  const status = await new Promise((resolve, reject) => {
    require('http').get(`${base}/api/library/index`, { headers: { 'if-none-match': etag } }, (r) => { r.resume(); resolve(r.statusCode); }).on('error', reject);
  });
  assert.strictEqual(status, 304);
}));

test('the routes answer 500 (not a crash) when the tree fails to load', () => withServer({ getTree: async () => { throw new Error('boom'); } }, async (base) => {
  const orig = console.error; console.error = () => {};
  try {
    assert.strictEqual((await get(`${base}/api/library/search?q=bsb`)).status, 500);
    assert.strictEqual((await get(`${base}/api/library/index`)).status, 500);
  } finally { console.error = orig; }
}));
