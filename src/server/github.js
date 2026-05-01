const { Octokit } = require('octokit');
const fs = require('fs');
const pathLib = require('path');
const cache = require('./cache');

const OWNER = 'Noble-Collective';
const REPO = 'Noble-Imprint-Resources';

const FILE_CACHE_TTL = 30 * 1000; // 30 seconds
const DISK_CACHE_DIR = pathLib.join(__dirname, '..', '.file-cache');

// Track rate limit reset time from GitHub API error responses
let rateLimitResetAt = null;

function getRateLimitReset() {
  return rateLimitResetAt;
}

let octokit;

function getOctokit() {
  if (!octokit) {
    const token = process.env.GITHUB_TOKEN;
    if (!token) throw new Error('GITHUB_TOKEN environment variable is required');
    octokit = new Octokit({
      auth: token,
      throttle: {
        onRateLimit: () => false,           // don't retry — fail immediately
        onSecondaryRateLimit: () => false,   // don't retry abuse limits either
      },
      retry: { enabled: false },
    });
  }
  return octokit;
}

// Centralized GitHub API call logging. Every call logs to stdout (→ Cloud Logging)
// with method, path, and remaining rate limit budget from response headers.
async function loggedApiCall(label, fn) {
  const start = Date.now();
  try {
    const result = await fn();
    const remaining = result.headers?.['x-ratelimit-remaining'];
    const limit = result.headers?.['x-ratelimit-limit'];
    const ms = Date.now() - start;
    console.log(`[GITHUB] ${label} — ${ms}ms — budget: ${remaining}/${limit}`);
    if (remaining != null && parseInt(remaining, 10) < 500) {
      console.warn(`[GITHUB] WARNING: rate limit budget low (${remaining} remaining)`);
    }
    return result;
  } catch (err) {
    const remaining = err.response?.headers?.['x-ratelimit-remaining'];
    const ms = Date.now() - start;
    console.error(`[GITHUB] ${label} — FAILED ${ms}ms — status: ${err.status || 'unknown'} remaining: ${remaining ?? 'unknown'}`);
    throw err;
  }
}

async function getDirectoryContents(path) {
  const { data } = await loggedApiCall(`GET dir ${path}`, () =>
    getOctokit().rest.repos.getContent({ owner: OWNER, repo: REPO, path })
  );
  if (!Array.isArray(data)) throw new Error(`Expected directory at ${path}`);
  return data;
}

function diskCachePath(filePath) {
  return pathLib.join(DISK_CACHE_DIR, filePath.replace(/\//g, '__') + '.json');
}

async function getFileContent(path) {
  const cacheKey = 'file:' + path;
  const cached = cache.get(cacheKey);
  if (cached) {
    console.log(`[GITHUB] CACHE HIT ${path}${cached.fromDiskCache ? ' (disk)' : ''}`);
    return cached;
  }

  try {
    const { data } = await loggedApiCall(`GET file ${path}`, () =>
      getOctokit().rest.repos.getContent({ owner: OWNER, repo: REPO, path })
    );
    if (Array.isArray(data)) throw new Error(`Expected file at ${path}`);
    const content = Buffer.from(data.content, 'base64').toString('utf-8').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    const result = { content, sha: data.sha };
    cache.set(cacheKey, result, FILE_CACHE_TTL);
    // Persist to disk so content survives rate limits and container restarts
    try {
      fs.mkdirSync(DISK_CACHE_DIR, { recursive: true });
      fs.writeFileSync(diskCachePath(path), JSON.stringify(result));
    } catch { /* ignore disk errors */ }
    return result;
  } catch (err) {
    // Capture rate limit reset time from GitHub response headers
    const resetHeader = err.response?.headers?.['x-ratelimit-reset'];
    if (resetHeader) rateLimitResetAt = new Date(parseInt(resetHeader, 10) * 1000);
    // Fall back to disk cache during rate limits or GitHub outages
    try {
      const diskData = fs.readFileSync(diskCachePath(path), 'utf8');
      const diskResult = { ...JSON.parse(diskData), fromDiskCache: true };
      console.warn('[GITHUB] API failed for', path, '— serving from disk cache');
      cache.set(cacheKey, diskResult, 60 * 1000); // short TTL — retry API in 1 min
      return diskResult;
    } catch { /* no disk cache — rethrow original error */ }
    throw err;
  }
}

async function getFileBinary(path) {
  try {
    const { data } = await loggedApiCall(`GET binary ${path}`, () =>
      getOctokit().rest.repos.getContent({ owner: OWNER, repo: REPO, path })
    );
    if (Array.isArray(data)) throw new Error(`Expected file at ${path}`);
    const buf = Buffer.from(data.content, 'base64');
    // Persist to disk for rate limit fallback
    try {
      fs.mkdirSync(DISK_CACHE_DIR, { recursive: true });
      fs.writeFileSync(diskCachePath(path + '.bin'), buf);
    } catch { /* ignore */ }
    return buf;
  } catch (err) {
    try {
      const buf = fs.readFileSync(diskCachePath(path + '.bin'));
      console.warn('[GITHUB] API failed for binary', path, '— serving from disk cache');
      return buf;
    } catch { /* no disk cache */ }
    throw err;
  }
}

async function getFileRaw(path) {
  try {
    const { data } = await loggedApiCall(`GET raw ${path}`, () =>
      getOctokit().request('GET /repos/{owner}/{repo}/contents/{path}', {
        owner: OWNER, repo: REPO, path,
        headers: { accept: 'application/vnd.github.raw+json' },
      })
    );
    try {
      fs.mkdirSync(DISK_CACHE_DIR, { recursive: true });
      fs.writeFileSync(diskCachePath(path + '.raw'), typeof data === 'string' ? data : Buffer.from(data));
    } catch { /* ignore */ }
    return data;
  } catch (err) {
    const resetHeader = err.response?.headers?.['x-ratelimit-reset'];
    if (resetHeader) rateLimitResetAt = new Date(parseInt(resetHeader, 10) * 1000);
    try {
      const cached = fs.readFileSync(diskCachePath(path + '.raw'));
      console.warn('[GITHUB] API failed for raw', path, '— serving from disk cache');
      return cached;
    } catch { /* no disk cache */ }
    throw err;
  }
}

async function getFileContentAtRef(path, ref) {
  const { data } = await loggedApiCall(`GET file ${path} @${ref}`, () =>
    getOctokit().rest.repos.getContent({ owner: OWNER, repo: REPO, path, ref })
  );
  if (Array.isArray(data)) throw new Error(`Expected file at ${path}`);
  const content = Buffer.from(data.content, 'base64').toString('utf-8').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  return { content, sha: data.sha };
}

async function getDirectoryContentsAtRef(path, ref) {
  const { data } = await loggedApiCall(`GET dir ${path} @${ref}`, () =>
    getOctokit().rest.repos.getContent({ owner: OWNER, repo: REPO, path, ref })
  );
  if (!Array.isArray(data)) throw new Error(`Expected directory at ${path}`);
  return data;
}

async function listTags() {
  const cacheKey = 'repo-tags';
  const cached = cache.get(cacheKey);
  if (cached) return cached;
  const { data } = await loggedApiCall('GET tags', () =>
    getOctokit().rest.repos.listTags({ owner: OWNER, repo: REPO, per_page: 100 })
  );
  const tags = data.map(t => ({ name: t.name, sha: t.commit.sha }));
  cache.set(cacheKey, tags, 5 * 60 * 1000);
  return tags;
}

async function updateFileContent(filePath, content, sha, message) {
  await loggedApiCall(`PUT file ${filePath}`, () =>
    getOctokit().rest.repos.createOrUpdateFileContents({
      owner: OWNER, repo: REPO, path: filePath, message,
      content: Buffer.from(content).toString('base64'), sha,
    })
  );
  cache.del('file:' + filePath);
}

module.exports = { getDirectoryContents, getFileContent, getFileBinary, getFileRaw, updateFileContent, getFileContentAtRef, getDirectoryContentsAtRef, listTags, getRateLimitReset, OWNER, REPO };
