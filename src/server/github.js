const { Octokit } = require('octokit');

const OWNER = 'Noble-Collective';
const REPO = 'Noble-Imprint-Resources';

let octokit;

function getOctokit() {
  if (!octokit) {
    const token = process.env.GITHUB_TOKEN;
    if (!token) throw new Error('GITHUB_TOKEN environment variable is required');
    octokit = new Octokit({ auth: token });
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
  const { data } = await getOctokit().rest.repos.getContent({
    owner: OWNER,
    repo: REPO,
    path,
  });
  if (Array.isArray(data)) throw new Error(`Expected file at ${path}`);
  const content = Buffer.from(data.content, 'base64').toString('utf-8');
  return { content, sha: data.sha };
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
}

module.exports = { getDirectoryContents, getFileContent, getFileBinary, getFileRaw, updateFileContent, OWNER, REPO };
