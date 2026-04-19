const { Octokit } = require('octokit');
const cache = require('./cache');

const OWNER = 'Noble-Collective';
const REPO = 'Noble-Imprint-Resources';

const FILE_CACHE_TTL = 30 * 1000; // 30 seconds

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

async function getFileContent(path) {
  const cacheKey = 'file:' + path;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  const { data } = await getOctokit().rest.repos.getContent({
    owner: OWNER,
    repo: REPO,
    path,
  });
  if (Array.isArray(data)) throw new Error(`Expected file at ${path}`);
  const content = Buffer.from(data.content, 'base64').toString('utf-8');
  const result = { content, sha: data.sha };
  cache.set(cacheKey, result, FILE_CACHE_TTL);
  return result;
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

module.exports = { getDirectoryContents, getFileContent, getFileBinary, getFileRaw, updateFileContent, OWNER, REPO };
