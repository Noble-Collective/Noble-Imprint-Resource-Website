// VENDORED — do not edit. @noble-collective/userdata/library-search 0.7.0 (Collective-Shared 75e5c65).
// Regenerate with: bash scripts/vendor-library-search.sh
"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/library-search/index.ts
var library_search_exports = {};
__export(library_search_exports, {
  MAX_QUERY_LENGTH: () => MAX_QUERY_LENGTH,
  PREFIX_PHRASE_FACTOR: () => PREFIX_PHRASE_FACTOR,
  TYPO_FACTOR: () => TYPO_FACTOR,
  WEIGHTS: () => WEIGHTS,
  normalize: () => normalize,
  resolveIndex: () => resolveIndex,
  search: () => search,
  similarity: () => similarity,
  validateTerms: () => validateTerms
});
module.exports = __toCommonJS(library_search_exports);

// src/library-search/normalize.ts
function normalize(s) {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/['’`]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
}
function similarity(a, b) {
  if (a === b) return 1;
  const n = a.length;
  const m = b.length;
  if (!n || !m) return 0;
  const d = Array.from({ length: n + 1 }, (_, i) => [i, ...new Array(m).fill(0)]);
  for (let j = 1; j <= m; j++) d[0][j] = j;
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, d[i - 2][j - 2] + 1);
      d[i][j] = v;
    }
  }
  return 1 - d[n][m] / Math.max(n, m);
}

// src/library-search/resolve.ts
var WEIGHTS = {
  title: 60,
  primary: 50,
  terms: 35,
  ancestorPrimary: 25,
  ancestorTitle: 20,
  ancestorTerms: 15,
  subtitle: 10
};
var strings = (v) => Array.isArray(v) ? v.filter((t) => typeof t === "string") : [];
function resolveIndex(terms, catalog) {
  const warnings = [];
  let nodes = {};
  if (terms && typeof terms === "object") {
    if (terms.version !== 1) warnings.push(`search terms version ${String(terms.version)} is not supported; terms ignored`);
    else if (terms.nodes && typeof terms.nodes === "object") nodes = terms.nodes;
  }
  const keys = Object.keys(nodes).filter((k) => !k.startsWith("_") && nodes[k] && typeof nodes[k] === "object");
  const used = /* @__PURE__ */ new Set();
  const books = [];
  catalog.forEach((b, i) => {
    if (b.hidden) return;
    const ancestors = keys.filter((k) => b.path.startsWith(k + "/")).sort((x, y) => x.split("/").length - y.split("/").length);
    const own = keys.includes(b.path) ? nodes[b.path] : void 0;
    if (own) used.add(b.path);
    ancestors.forEach((k) => used.add(k));
    const fields = [{ text: b.title, weight: WEIGHTS.title, field: "title" }];
    if (own) {
      for (const t of strings(own.primary)) fields.push({ text: t, weight: WEIGHTS.primary, field: "primary" });
      for (const t of strings(own.terms)) fields.push({ text: t, weight: WEIGHTS.terms, field: "terms" });
    }
    const seriesPath = [];
    for (const k of ancestors) {
      const a = nodes[k];
      const via = typeof a.title === "string" ? a.title : k.split("/").pop();
      seriesPath.push(via);
      for (const t of strings(a.primary)) fields.push({ text: t, weight: WEIGHTS.ancestorPrimary, field: "primary", via });
      fields.push({ text: via, weight: WEIGHTS.ancestorTitle, field: "series", via });
      for (const t of strings(a.terms)) fields.push({ text: t, weight: WEIGHTS.ancestorTerms, field: "terms", via });
    }
    if (b.subtitle) fields.push({ text: b.subtitle, weight: WEIGHTS.subtitle, field: "subtitle" });
    books.push({
      key: b.key,
      id: b.id ?? null,
      title: b.title,
      subtitle: b.subtitle ?? null,
      path: b.path,
      order: b.order ?? i,
      seriesPath,
      fields
    });
  });
  return { version: 1, books, unusedKeys: keys.filter((k) => !used.has(k)), warnings };
}

// src/library-search/search.ts
var MAX_QUERY_LENGTH = 100;
var TYPO_FACTOR = 0.7;
var PREFIX_PHRASE_FACTOR = 0.5;
var prepared = /* @__PURE__ */ new WeakMap();
function fieldsOf(book) {
  let p = prepared.get(book);
  if (!p) {
    p = book.fields.map((f) => {
      const n = normalize(f.text);
      return { f, n, tokens: n ? n.split(" ") : [] };
    });
    prepared.set(book, p);
  }
  return p;
}
function wordHit(field, word) {
  if (field.tokens.some((t) => t.startsWith(word))) return 1;
  if (word.length >= 5 && field.tokens.some((t) => t.length >= 4 && similarity(t, word) >= 0.8)) return TYPO_FACTOR;
  return 0;
}
function phraseHit(field, query) {
  const hay = " " + field.n + " ";
  let best = 0;
  for (let at = hay.indexOf(" " + query); at >= 0; at = hay.indexOf(" " + query, at + 1)) {
    if (hay[at + 1 + query.length] === " ") return 1;
    best = PREFIX_PHRASE_FACTOR;
  }
  return best;
}
var round = (x) => Math.round(x * 100) / 100;
function search(index, q, options = {}) {
  if (typeof q !== "string") return [];
  const query = normalize(q.slice(0, MAX_QUERY_LENGTH));
  const words = query ? query.split(" ") : [];
  if (!words.some((w) => w.length >= 2)) return [];
  const out = [];
  for (const book of index.books) {
    const fields = fieldsOf(book);
    const hits = fields.map((f) => words.map((w) => wordHit(f, w)));
    let score = 0;
    let ok = true;
    for (let j = 0; j < words.length && ok; j++) {
      let top = 0;
      for (let i = 0; i < fields.length; i++) top = Math.max(top, hits[i][j] * fields[i].f.weight);
      if (!top) ok = false;
      score += top;
    }
    if (!ok) continue;
    let bonus = 0;
    for (const f of fields) bonus = Math.max(bonus, phraseHit(f, query) * f.f.weight);
    score += bonus;
    let matched = null;
    let strength = 0;
    for (let i = 0; i < fields.length; i++) {
      const s = Math.min(...hits[i]) * fields[i].f.weight;
      if (s > strength) [matched, strength] = [fields[i].f, s];
    }
    if (!matched) {
      for (let i = 0; i < fields.length; i++) {
        const s = Math.max(...hits[i]) * fields[i].f.weight;
        if (s > strength) [matched, strength] = [fields[i].f, s];
      }
    }
    out.push({ book, score: round(score), matched });
  }
  out.sort((a, b) => b.score - a.score || a.book.order - b.book.order);
  const limited = options.limit === void 0 ? out : out.slice(0, Math.max(0, options.limit));
  return limited.map(({ book, score, matched }) => ({
    key: book.key,
    id: book.id,
    title: book.title,
    subtitle: book.subtitle,
    seriesPath: book.seriesPath,
    score,
    matched: { text: matched.text, field: matched.field, ...matched.via !== void 0 ? { via: matched.via } : {} }
  }));
}

// src/library-search/validate.ts
var NODE_FIELDS = /* @__PURE__ */ new Set(["title", "id", "primary", "terms"]);
var isObject = (v) => !!v && typeof v === "object" && !Array.isArray(v);
var isStringList = (v) => Array.isArray(v) && v.every((t) => typeof t === "string");
function validateTerms(terms, folders) {
  const problems = [];
  const error = (code, key, message, term) => problems.push({ level: "error", code, key, ...term !== void 0 ? { term } : {}, message });
  const warn = (code, key, message, term) => problems.push({ level: "warning", code, key, ...term !== void 0 ? { term } : {}, message });
  if (!isObject(terms)) {
    error("bad-shape", "", "the file is not a JSON object");
    return problems;
  }
  if (terms.version !== 1) error("bad-shape", "", `"version" must be 1 (found ${JSON.stringify(terms.version)})`);
  for (const k of Object.keys(terms)) {
    if (!k.startsWith("_") && k !== "version" && k !== "nodes") error("bad-shape", "", `unknown top-level field "${k}"`);
  }
  if (!isObject(terms.nodes)) {
    error("bad-shape", "", '"nodes" must be an object of folder path \u2192 node');
    return problems;
  }
  const nodes = terms.nodes;
  const good = /* @__PURE__ */ new Map();
  for (const [key, node] of Object.entries(nodes)) {
    if (key.startsWith("_")) continue;
    if (!isObject(node)) {
      error("bad-shape", key, "a node must be an object");
      continue;
    }
    let ok = true;
    for (const f of Object.keys(node)) {
      if (!f.startsWith("_") && !NODE_FIELDS.has(f)) {
        error("bad-shape", key, `unknown field "${f}"`);
        ok = false;
      }
    }
    if (typeof node.title !== "string" || !node.title.trim()) {
      error("bad-shape", key, '"title" must be a non-empty string');
      ok = false;
    }
    if (node.id !== void 0 && typeof node.id !== "string") {
      error("bad-shape", key, '"id" must be a string');
      ok = false;
    }
    for (const list of ["primary", "terms"]) {
      if (!isStringList(node[list])) {
        error("bad-shape", key, `"${list}" must be a list of strings`);
        ok = false;
        continue;
      }
      for (const t of node[list]) {
        if (!normalize(t)) {
          error("bad-shape", key, `"${t}" has no letters or digits`, t);
          ok = false;
        }
      }
    }
    if (ok) good.set(key, node);
  }
  const byPath = new Map(folders.map((f) => [f.path, f]));
  const normSets = /* @__PURE__ */ new Map();
  for (const [key, node] of good) normSets.set(key, new Set([...node.primary, ...node.terms].map(normalize)));
  for (const [key, node] of good) {
    const folder = byPath.get(key);
    if (!folder) error("missing-folder", key, `no folder "${key}" in the content repo`);
    else {
      if (node.id !== void 0 && node.id !== folder.id) {
        error("id-mismatch", key, `id "${node.id}" but meta.json says ${folder.id ? `"${folder.id}"` : "no id"}`);
      }
      if (folder.title !== void 0 && node.title !== folder.title) {
        warn("title-mismatch", key, `title "${node.title}" but meta.json says "${folder.title}"`);
      }
    }
    if (node.primary.length < 3 || node.primary.length > 5) {
      warn("primary-count", key, `${node.primary.length} primary terms (3\u20135 expected)`);
    }
    const all = [...node.primary, ...node.terms];
    const raw = /* @__PURE__ */ new Set();
    const rawReported = /* @__PURE__ */ new Set();
    const norm = /* @__PURE__ */ new Map();
    const normReported = /* @__PURE__ */ new Set();
    for (const t of all) {
      const r = t.trim().toLowerCase();
      const n = normalize(t);
      if (raw.has(r)) {
        if (!rawReported.has(r)) error("duplicate", key, `"${t.trim()}" is listed twice`, r);
        rawReported.add(r);
      } else if (norm.has(n)) {
        if (!normReported.has(n)) warn("duplicate-normalized", key, `"${norm.get(n)}" and "${t}" search the same`, n);
        normReported.add(n);
      }
      raw.add(r);
      if (!norm.has(n)) norm.set(n, t);
    }
    const fromAbove = /* @__PURE__ */ new Map();
    for (const [k, set] of normSets) {
      if (key.startsWith(k + "/")) {
        for (const n of set) if (!fromAbove.has(n)) fromAbove.set(n, k);
      }
    }
    for (const n of normSets.get(key)) {
      if (fromAbove.has(n)) warn("repeats-ancestor", key, `"${n}" already comes from "${fromAbove.get(n)}"`, n);
    }
  }
  for (const f of folders) {
    if (f.id && !(f.path in nodes)) warn("no-terms", f.path, `book "${f.id}" has no search terms`);
  }
  return problems;
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  MAX_QUERY_LENGTH,
  PREFIX_PHRASE_FACTOR,
  TYPO_FACTOR,
  WEIGHTS,
  normalize,
  resolveIndex,
  search,
  similarity,
  validateTerms
});
