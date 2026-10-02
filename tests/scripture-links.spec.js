/**
 * Scripture links through the shared parser (Collective-Shared plans/2026-10-02-shared-scripture-parser.md,
 * P4) on a real page: The Sacred Script s1 has chapter-only references ("Genesis 1–50", "Job 1–42"),
 * chapter-only "Biblical Narrative (Job 1-42)" declarations, and bare cross-chapter ranges.
 * Before P4 the site didn't link chapter-only references, opened that session's bare refs in
 * Revelation/Romans, and cut bare cross-chapter ranges short ("(7:1–8:12)" opened 7:1-8).
 */
const { test, expect } = require('./fixtures');

const PAGE = 'http://localhost:8080/narrative-journey-series/pathways/the-sacred-script/session1';

async function openRef(page, dataRef) {
  await page.locator(`.session-content a.bible-ref[data-ref="${dataRef}"]`).first().click();
  const body = page.locator('[data-verse-body]');
  await expect(body.locator('.verse-num').first()).toBeVisible();
  return body;
}

test.describe('scripture links (shared parser)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(PAGE);
  });

  test('a chapter-only range links and its pop-up stops at 3 chapters, saying where it continues', async ({ page }) => {
    const body = await openRef(page, 'Genesis 1-50');
    await expect(page.locator('[data-verse-title]')).toHaveText('Genesis 1-50'); // as the author wrote it
    await expect(body.locator('.verse-popup-chapter')).toHaveText(['Genesis 2', 'Genesis 3']);
    await expect(body.locator('.verse-num').last()).toHaveText('24'); // Genesis 3:24
    // P7 option A (Steve, 2026-10-02): a plain "continues" line, and ONE link, in the footer,
    // that continues where the pop-up stopped (Genesis 4:1).
    const cont = body.locator('.verse-popup-continues');
    await expect(cont).toHaveText('… continues through Genesis 50');
    await expect(cont.locator('a')).toHaveCount(0);
    const link = page.locator('[data-verse-link]');
    await expect(link).toHaveText('Continue in Genesis 4 ›');
    await expect(link).toHaveAttribute('href', /\/bible\/bsb\/Genesis\?chapter=4#v1$/);
    await expect(page.locator('.verse-popup a', { hasText: 'Read in context' })).toHaveCount(0);
    expect((await link.boundingBox()).height).toBeGreaterThanOrEqual(44);
  });

  test('an uncut passage keeps "Read in context ›", opening its first verse', async ({ page }) => {
    const body = await openRef(page, 'Genesis 7:1-8:12');
    await expect(body.locator('.verse-popup-continues')).toHaveCount(0);
    const link = page.locator('[data-verse-link]');
    await expect(link).toHaveText('Read in context ›');
    await expect(link).toHaveAttribute('href', /\/bible\/bsb\/Genesis\?chapter=7#v1$/);
  });

  test('after a cut passage, the next pop-up’s footer says "Read in context ›" again', async ({ page }) => {
    await openRef(page, 'Genesis 1-50');
    await expect(page.locator('[data-verse-link]')).toHaveText('Continue in Genesis 4 ›');
    await page.locator('[data-verse-close]').click();
    await openRef(page, 'Job 1:1-5');
    await expect(page.locator('[data-verse-link]')).toHaveText('Read in context ›');
    await expect(page.locator('[data-verse-link]')).toHaveAttribute('href', /\/bible\/bsb\/Job\?chapter=1#v1$/);
  });

  test('a bare cross-chapter range opens its whole span', async ({ page }) => {
    const body = await openRef(page, 'Genesis 7:1-8:12');
    await expect(body.locator('.verse-popup-chapter')).toHaveText(['Genesis 8']);
    await expect(body.locator('.verse-num').last()).toHaveText('12');
    await expect(body.locator('.verse-popup-continues')).toHaveCount(0);
  });

  test('bare refs under a chapter-only "Biblical Narrative (Job 1-42)" open Job', async ({ page }) => {
    await expect(page.locator('.session-content a.bible-ref[data-ref="Job 1:1-5"]')).toHaveCount(1);
    await expect(page.locator('.session-content a.bible-ref', { hasText: /^1:1-5$/ })).toHaveAttribute('data-ref', 'Job 1:1-5');
    const body = await openRef(page, 'Job 1:1-5');
    await expect(body).toContainText('There was a man in the land of Uz');
  });
});
