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

// LOCAL DEV ONLY: the local service account can't read the audio bucket, so with
// AUDIO_DEV_SOURCE=https://resources.noblecollective.org the manifest + signed-URL lookups go
// through that site's public audio API instead (the same one the mobile app uses). Never in prod.
const AUDIO_DEV_SOURCE = process.env.NODE_ENV === 'production' ? '' : (process.env.AUDIO_DEV_SOURCE || '').replace(/\/$/, '');

async function devSourceJson(apiPath) {
  const res = await fetch(`${AUDIO_DEV_SOURCE}${apiPath.split('/').map(encodeURIComponent).join('/')}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`AUDIO_DEV_SOURCE ${apiPath}: HTTP ${res.status}`);
  return res.json();
}

// The manifest at audio/{slugPath}/manifest.json, or null (404 / unreadable).
async function readManifest(slugPath, label) {
  try {
    if (AUDIO_DEV_SOURCE) return await devSourceJson(`/api/audio/manifest/${slugPath}`);
    const [contents] = await getBucket().file(`audio/${slugPath}/manifest.json`).download();
    return JSON.parse(contents.toString());
  } catch (err) {
    if (err.code === 404) return null;
    console.error(`[audio] Failed to load ${label}:`, err.message);
    return null;
  }
}

function slugify(name) {
  return name.toLowerCase().replace(/['']/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

// The pipeline stores a Bible book under slugify(its USFM \h name); the reader names books by
// their references.json keys, which differ for exactly these two (see resolveRefBookName in bible.js).
const BIBLE_AUDIO_SLUG_OVERRIDES = { 'Psalm': 'psalms', 'Song of Solomon': 'song' };

function bibleAudioSlug(bookName) {
  return BIBLE_AUDIO_SLUG_OVERRIDES[bookName] || slugify(bookName);
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

  const manifest = await readManifest(bookRepoPathToSlugPath(bookRepoPath), `manifest for ${bookRepoPath}`);
  if (manifest) cache.set(cacheKey, manifest, MANIFEST_TTL);
  return manifest;
}

/**
 * Generate a signed URL for an audio asset (MP3, timestamps JSON, TTS JSON).
 */
async function getSignedUrl(bookRepoPath, filename) {
  const slugPath = bookRepoPathToSlugPath(bookRepoPath);
  if (AUDIO_DEV_SOURCE) return (await devSourceJson(`/api/audio/url/${slugPath}/${filename}`)).url;
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
 * Bible-audiobook manifest, stored at audio/bible/{tx}/{book-slug}/manifest.json
 * (the audiobook pipeline's Bible path). book-slug is bibleAudioSlug(bookName), matching the
 * generation side. Returns null if the book has no audio.
 */
async function getBibleAudioManifest(translationId, bookName) {
  const bookSlug = bibleAudioSlug(bookName);
  const cacheKey = `bible-audio-manifest:${translationId}/${bookSlug}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  const manifest = await readManifest(`bible/${translationId}/${bookSlug}`, `bible manifest for ${translationId}/${bookSlug}`);
  if (manifest) cache.set(cacheKey, manifest, MANIFEST_TTL);
  return manifest;
}

/**
 * Audio session for a single Bible chapter. Chapters are stored as "NNN.md" sessions
 * (zero-padded chapter number). Returns the session entry (audioFile, timestampsFile,
 * durationSeconds, …) plus bookPath/bookSlug, or null if that chapter has no audio.
 */
async function getBibleAudioChapter(translationId, bookName, chapter) {
  const manifest = await getBibleAudioManifest(translationId, bookName);
  if (!manifest) return null;
  const sessionFile = `${String(chapter).padStart(3, '0')}.md`;
  const session = manifest.sessions.find(s => s.sessionFile === sessionFile);
  if (!session) return null;
  return { ...session, bookPath: manifest.bookPath, bookSlug: bibleAudioSlug(bookName) };
}

/**
 * Voice-comparison test data. Reads voice-test/{slug}/manifest.json from the
 * audiobook bucket and returns it with a signed URL per voice sample. Used by
 * the /voice-test page for side-by-side voice review. Returns null if absent.
 */
async function getVoiceCompareData(slug) {
  const safeSlug = String(slug).toLowerCase().replace(/[^a-z0-9-]/g, '');
  const cacheKey = `voice-compare:${safeSlug}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  const dir = `voice-test/${safeSlug}`;
  try {
    const [contents] = await getBucket().file(`${dir}/manifest.json`).download();
    const manifest = JSON.parse(contents.toString());
    for (const v of manifest.voices || []) {
      const [url] = await getBucket().file(`${dir}/${v.file}`).getSignedUrl({
        action: 'read',
        expires: Date.now() + SIGNED_URL_EXPIRY,
      });
      v.url = url;
    }
    cache.set(cacheKey, manifest, MANIFEST_TTL);
    return manifest;
  } catch (err) {
    if (err.code === 404) return null;
    console.error(`[audio] Failed to load voice-compare manifest for ${safeSlug}:`, err.message);
    return null;
  }
}

/**
 * Clear all audio manifest caches.
 */
function clearCache() {
  // Clear only the audio caches — NOT the content tree / file caches. Nuking everything
  // (the old behavior) forced the next visitor to pay a full content-tree rebuild.
  cache.invalidatePrefix('audio-manifest:');
  cache.invalidatePrefix('bible-audio-manifest:');
  cache.invalidatePrefix('voice-compare:');
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
  getBibleAudioManifest,
  getBibleAudioChapter,
  bibleAudioSlug,
  getVoiceCompareData,
  clearCache,
  formatDuration,
};
