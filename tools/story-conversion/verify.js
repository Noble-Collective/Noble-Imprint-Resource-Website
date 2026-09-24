#!/usr/bin/env node
// Structural + render verification for a converted Narrative Journey book, using the
// site's REAL parser (resolveIncludes + parseCommonBlocks + renderMarkdown).
//
// Usage: node tools/story-conversion/verify.js "<Book Folder Name>"   (run from the website repo)
//
// Per file: resolves every @include against series → subseries → book common blocks
// (throws on undefined key / missing id= / bad bold=/active=), renders it, and reports
// leftover @include directives or literal custom tags. Per numbered session it also checks
// the §6 structural invariants: 5 infographics, 5 movement intros, exactly 1 creed include,
// no bold=/active= params (series convention), plus <Question> counts and duplicate ids.
const fs = require('fs');
const path = require('path');
const { resolveIncludes, renderMarkdown } = require('../../src/renderer/parser');

// Mirrors content.js parseCommonBlocks (copied rather than required: content.js pulls in
// the GitHub/cache layer at load time).
function parseCommonBlocks(md) {
  const blocks = {};
  if (!md) return blocks;
  const re = /<([A-Za-z][A-Za-z0-9_-]*)>\r?\n([\s\S]*?)\r?\n<\/\1>/g;
  let m;
  while ((m = re.exec(md)) !== null) blocks[m[1]] = m[2];
  return blocks;
}

const bookName = process.argv[2];
if (!bookName) { console.error('usage: node verify.js "<Book Folder Name>"'); process.exit(2); }
const SERIES = 'C:/Users/Steve/Dev/Noble-Imprint-Resources/series/Narrative Journey Series';
const SUB = path.join(SERIES, 'Essentials');
const BOOK = path.join(SUB, bookName);
const read = (p) => (fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '');

const blocks = Object.assign({},
  parseCommonBlocks(read(path.join(SERIES, 'commonSeries.md'))),
  parseCommonBlocks(read(path.join(SUB, 'commonSubseries.md'))),
  parseCommonBlocks(read(path.join(BOOK, 'commonBook.md'))));
const meta = JSON.parse(read(path.join(BOOK, 'meta.json')) || '{}');

const INFOGRAPHICS = ['NarrativeStructureInfographic', 'NarrativeTheologyInfographic',
  'SpiritualPracticesInfographic', 'MinistryPracticesInfographic', 'MissionPracticesInfographic'];
const MOVEMENTS = ['StudyTheText', 'ExploreTheText', 'ApplyTheText', 'MinisterTheText', 'WitnessTheText'];

const files = fs.readdirSync(path.join(BOOK, 'sessions')).filter((f) => f.endsWith('.md')).sort();
let problems = 0, directives = 0;
const allIds = new Map();
for (const f of files) {
  const src = read(path.join(BOOK, 'sessions', f));
  const issues = [];
  const incs = [...src.matchAll(/<!--\s*@include:\s*([A-Za-z][A-Za-z0-9_-]*)\s*(.*?)\s*-->/g)];
  directives += incs.length;
  let resolved = '', html = '';
  try {
    resolved = resolveIncludes(src, blocks);
    html = renderMarkdown(resolved, { accent: meta.accent, headingColors: meta.color });
  } catch (e) { issues.push('THROW: ' + e.message); }
  if (/@include/.test(resolved)) issues.push('leftover @include after resolve');
  if (/<(Item|Infographic|Question|Callout|Accent)\b/.test(html)) issues.push('literal custom tag in rendered HTML');
  const ids = [...resolved.matchAll(/<Question\s+id="?([^">\s]+)/g)].map((m) => m[1]);
  for (const id of ids) {
    if (allIds.has(id)) issues.push(`duplicate Question id ${id} (also in ${allIds.get(id)})`);
    else allIds.set(id, f);
  }
  const keys = incs.map((m) => m[1]);
  const numbered = /^\d\d-/.test(f) && !/^(00|13|14)-/.test(f);
  let summary = `${incs.length} includes, ${ids.length} questions`;
  if (numbered) {
    const nInfo = INFOGRAPHICS.filter((k) => keys.includes(k)).length;
    const nMove = MOVEMENTS.filter((k) => keys.includes(k)).length;
    const creed = incs.filter((m) => m[0] && /Creedal/.test(src.slice(Math.max(0, m.index - 40), m.index))).length;
    if (nInfo !== 5) issues.push(`infographics ${nInfo}/5`);
    if (nMove !== 5) issues.push(`movement intros ${nMove}/5`);
    if (creed !== 1) issues.push(`creed includes ${creed} (want 1)`);
    if (/\b(bold|active)="/.test(src)) issues.push('bold=/active= param present (series convention: none)');
    summary += `, ${nInfo} infographics, ${nMove} movements, ${creed} creed`;
  }
  problems += issues.length;
  console.log(`${issues.length ? 'FAIL' : 'ok  '} ${f.padEnd(26)} ${summary}${issues.length ? '\n       ' + issues.join('\n       ') : ''}`);
}
console.log(`\n${files.length} files, ${directives} @include directives, ${allIds.size} unique Question ids — ${problems ? problems + ' PROBLEM(S)' : 'ALL CLEAN'}`);
process.exit(problems ? 1 : 0);
