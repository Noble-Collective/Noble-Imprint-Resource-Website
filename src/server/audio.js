/**
 * audio.js — Audiobook manifest and signed URL generation.
 *
 * Reads audio manifests from GCS and generates time-limited signed URLs
 * for MP3 and timestamp files. Caches manifests in memory.
 */

const { Storage } = require('@google-cloud/storage');
const cache = require('./cache');

const BUCKET_NAME = process.env.AUDIOBOOK_BUCKET || 'noble-imprint-audiobooks';
const MANIFEST_TTL = 5 * 60 * 1000; // 5 minutes
const SIGNED_URL_EXPIRY = 60 * 60 * 1000; // 1 hour

let storage;
let bucket;

function getBucket() {
  if (!bucket) {
    storage = new Storage();
    bucket = storage.bucket(BUCKET_NAME);
  }
  return bucket;
}

function slugify(name) {
  return name.toLowerCase().replace(/['']/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function bookRepoPathToSlugPath(repoPath) {
  return repoPath
    .replace(/^series\//, '')
    .split('/')
    .map(slugify)
    .join('/');
}

/**
 * Get the audio manifest for a book. Returns null if no audiobook exists.
 */
async function getAudioManifest(bookRepoPath) {
  const cacheKey = `audio-manifest:${bookRepoPath}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  const slugPath = bookRepoPathToSlugPath(bookRepoPath);
  const file = getBucket().file(`audio/${slugPath}/manifest.json`);

  try {
    const [contents] = await file.download();
    const manifest = JSON.parse(contents.toString());
    cache.set(cacheKey, manifest, MANIFEST_TTL);
    return manifest;
  } catch (err) {
    if (err.code === 404) return null;
    console.error(`[audio] Failed to load manifest for ${bookRepoPath}:`, err.message);
    return null;
  }
}

/**
 * Generate a signed URL for an audio asset (MP3, timestamps JSON, TTS JSON).
 */
async function getSignedUrl(bookRepoPath, filename) {
  const slugPath = bookRepoPathToSlugPath(bookRepoPath);
  const file = getBucket().file(`audio/${slugPath}/${filename}`);

  const [url] = await file.getSignedUrl({
    action: 'read',
    expires: Date.now() + SIGNED_URL_EXPIRY,
  });
  return url;
}

/**
 * Find audio session data for a specific session file.
 */
async function getAudioSession(bookRepoPath, sessionFilename) {
  const manifest = await getAudioManifest(bookRepoPath);
  if (!manifest) return null;
  return manifest.sessions.find(s => s.sessionFile === sessionFilename) || null;
}

/**
 * Clear all audio manifest caches.
 */
function clearCache() {
  // Clear all entries starting with 'audio-manifest:'
  // cache.js doesn't have prefix invalidation yet, so we use invalidateAll
  // which is acceptable since audio cache is a small portion of total cache
  cache.invalidateAll();
}

function formatDuration(seconds) {
  if (!seconds) return '';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m} min`;
}

module.exports = {
  getAudioManifest,
  getSignedUrl,
  getAudioSession,
  clearCache,
  formatDuration,
};
