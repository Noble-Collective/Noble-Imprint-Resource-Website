const { Octokit } = require('octokit');
const { createAppAuth } = require('@octokit/auth-app');
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
    const common = {
      throttle: {
        onRateLimit: () => false,           // don't retry — fail immediately
        onSecondaryRateLimit: () => false,   // don't retry abuse limits either
      },
      retry: { enabled: false },
    };
    // Prefer GitHub App installation auth when configured. This gives the server
    // its OWN rate-limit + secondary-throttle bucket (isolated from personal PATs
    // and the audiobook workflow's token), scoped to just the content repo, with
    // short-lived auto-rotating tokens. Falls back to the personal PAT otherwise.
    const appId = process.env.GITHUB_APP_ID;
    const installationId = process.env.GITHUB_APP_INSTALLATION_ID;
    const privateKeyB64 = process.env.GITHUB_APP_PRIVATE_KEY_B64;
    if (appId && installationId && privateKeyB64) {
      const privateKey = Buffer.from(privateKeyB64, 'base64').toString('utf-8');
      octokit = new Octokit({
        authStrategy: createAppAuth,
        auth: { appId, installationId, privateKey },
        ...common,
      });
      console.log(`[GITHUB] Authenticating as GitHub App ${appId} (installation ${installationId})`);
    } else {
      const token = process.env.GITHUB_TOKEN;
      if (!token) throw new Error('GITHUB_TOKEN or GitHub App credentials (GITHUB_APP_ID/INSTALLATION_ID/PRIVATE_KEY_B64) are required');
      octokit = new Octokit({ auth: token, ...common });
      console.log('[GITHUB] Authenticating with personal access token (GITHUB_TOKEN)');
    }
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

// Commits touching a path, newest first. Returns the raw GitHub commit objects.
async function listCommits(path, { perPage = 50, page = 1 } = {}) {
  const { data } = await loggedApiCall(`GET commits ${path}`, () =>
    getOctokit().rest.repos.listCommits({ owner: OWNER, repo: REPO, path, per_page: perPage, page })
  );
  return data;
}

// A single commit with its files + patches.
async function getCommit(sha) {
  const { data } = await loggedApiCall(`GET commit ${sha.slice(0, 7)}`, () =>
    getOctokit().rest.repos.getCommit({ owner: OWNER, repo: REPO, ref: sha })
  );
  return data;
}

// List every path in the repo in a single API call (recursive git tree).
// Returns [{ path, type: 'blob'|'tree', sha }]. Cached 5 min.
async function getTreeRecursive(ref = 'main') {
  const cacheKey = 'git-tree:' + ref;
  const cached = cache.get(cacheKey);
  if (cached) return cached;
  const { data } = await loggedApiCall(`GET tree ${ref}`, () =>
    getOctokit().rest.git.getTree({ owner: OWNER, repo: REPO, tree_sha: ref, recursive: 'true' })
  );
  const tree = (data.tree || []).map(t => ({ path: t.path, type: t.type, sha: t.sha }));
  cache.set(cacheKey, tree, 5 * 60 * 1000);
  return tree;
}

async function updateFileContent(filePath, content, sha, message) {
  const res = await loggedApiCall(`PUT file ${filePath}`, () =>
    getOctokit().rest.repos.createOrUpdateFileContents({
      owner: OWNER, repo: REPO, path: filePath, message,
      content: Buffer.from(content).toString('base64'), sha,
    })
  );
  // Keep the cache AUTHORITATIVE after a write: store exactly what we just wrote
  // plus the new file SHA GitHub returned. A follow-up getFileContent then serves
  // the post-commit content locally instead of hitting GitHub's contents API,
  // which can lag (read-after-write) and return pre-commit content — the bug that
  // let two sequential accepts clobber each other. Falls back to invalidation if
  // the response shape is unexpected.
  const newSha = res && res.data && res.data.content && res.data.content.sha;
  if (newSha) cache.set('file:' + filePath, { content, sha: newSha }, FILE_CACHE_TTL);
  else cache.del('file:' + filePath);
  return { sha: newSha || null };
}

function clearDiskCache() {
  try {
    if (fs.existsSync(DISK_CACHE_DIR)) {
      const files = fs.readdirSync(DISK_CACHE_DIR);
      for (const f of files) {
        try { fs.unlinkSync(pathLib.join(DISK_CACHE_DIR, f)); } catch { /* ignore */ }
      }
      console.log(`[GITHUB] Cleared disk cache (${files.length} files)`);
    }
  } catch (err) { console.error('[GITHUB] Error clearing disk cache:', err.message); }
}

module.exports = { getDirectoryContents, getFileContent, getFileBinary, getFileRaw, updateFileContent, getFileContentAtRef, getDirectoryContentsAtRef, listTags, listCommits, getCommit, getTreeRecursive, getRateLimitReset, clearDiskCache, OWNER, REPO };
