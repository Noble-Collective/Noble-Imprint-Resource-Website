const { Octokit } = require('octokit');
const fs = require('fs');
const pathLib = require('path');
const cache = require('./cache');

const OWNER = 'Noble-Collective';
const REPO = 'Noble-Imprint-Resources';

const FILE_CACHE_TTL = 30 * 1000; // 30 seconds
const DISK_CACHE_DIR = pathLib.join(__dirname, '..', '.file-cache');

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

async function getDirectoryContents(path) {
  const { data } = await getOctokit().rest.repos.getContent({
    owner: OWNER,
    repo: REPO,
    path,
  });
  if (!Array.isArray(data)) throw new Error(`Expected directory at ${path}`);
  return data;
}

function diskCachePath(filePath) {
  return pathLib.join(DISK_CACHE_DIR, filePath.replace(/\//g, '__') + '.json');
}

async function getFileContent(path) {
  const cacheKey = 'file:' + path;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  try {
    const { data } = await getOctokit().rest.repos.getContent({
      owner: OWNER,
      repo: REPO,
      path,
    });
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
    // Fall back to disk cache during rate limits or GitHub outages
    try {
      const diskData = fs.readFileSync(diskCachePath(path), 'utf8');
      const diskResult = JSON.parse(diskData);
      console.warn('[GITHUB] API failed for', path, '— serving from disk cache');
      cache.set(cacheKey, diskResult, 60 * 1000); // short TTL — retry API in 1 min
      return diskResult;
    } catch { /* no disk cache — rethrow original error */ }
    throw err;
  }
}

async function getFileBinary(path) {
  const { data } = await getOctokit().rest.repos.getContent({
    owner: OWNER,
    repo: REPO,
    path,
  });
  if (Array.isArray(data)) throw new Error(`Expected file at ${path}`);
  return Buffer.from(data.content, 'base64');
}

async function getFileRaw(path) {
  const { data } = await getOctokit().request('GET /repos/{owner}/{repo}/contents/{path}', {
    owner: OWNER,
    repo: REPO,
    path,
    headers: { accept: 'application/vnd.github.raw+json' },
  });
  return data;
}

async function getFileContentAtRef(path, ref) {
  const { data } = await getOctokit().rest.repos.getContent({
    owner: OWNER, repo: REPO, path, ref,
  });
  if (Array.isArray(data)) throw new Error(`Expected file at ${path}`);
  const content = Buffer.from(data.content, 'base64').toString('utf-8').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  return { content, sha: data.sha };
}

async function getDirectoryContentsAtRef(path, ref) {
  const { data } = await getOctokit().rest.repos.getContent({
    owner: OWNER, repo: REPO, path, ref,
  });
  if (!Array.isArray(data)) throw new Error(`Expected directory at ${path}`);
  return data;
}

async function listTags() {
  const cacheKey = 'repo-tags';
  const cached = cache.get(cacheKey);
  if (cached) return cached;
  const { data } = await getOctokit().rest.repos.listTags({
    owner: OWNER, repo: REPO, per_page: 100,
  });
  const tags = data.map(t => ({ name: t.name, sha: t.commit.sha }));
  cache.set(cacheKey, tags, 5 * 60 * 1000);
  return tags;
}

async function updateFileContent(filePath, content, sha, message) {
  await getOctokit().rest.repos.createOrUpdateFileContents({
    owner: OWNER,
    repo: REPO,
    path: filePath,
    message,
    content: Buffer.from(content).toString('base64'),
    sha,
  });
  cache.del('file:' + filePath);
}

module.exports = { getDirectoryContents, getFileContent, getFileBinary, getFileRaw, updateFileContent, getFileContentAtRef, getDirectoryContentsAtRef, listTags, OWNER, REPO };
