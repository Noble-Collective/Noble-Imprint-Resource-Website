// Pre-fetch all content into disk cache during Docker build.
// This bakes the cache into the image so containers start warm.
const github = require('../src/server/github');
const content = require('../src/server/content');

async function main() {
  const tree = await content.buildContentTree();
  const books = content.getAllBooks(tree);
  let sessions = 0, covers = 0;
  for (const book of books) {
    if (book.coverPath) {
      try {
        const ext = require('path').extname(book.coverPath).toLowerCase();
        if (ext === '.svg') {
          await github.getFileRaw(book.coverPath);
        } else {
          await github.getFileBinary(book.coverPath);
        }
        covers++;
      } catch (err) { console.warn('  skip cover:', book.coverPath, err.message); }
    }
    for (const session of (book.sessions || [])) {
      try {
        await github.getFileContent(session.path);
        sessions++;
      } catch (err) { console.warn('  skip session:', session.path, err.message); }
    }
  }
  console.log(`Disk cache warm: ${sessions} sessions, ${covers} covers, ${books.length} books`);
}

main().catch(err => {
  console.error('Cache warm-up failed:', err.message);
  // Don't fail the build — the site works without the cache, just less resilient
  process.exit(0);
});
