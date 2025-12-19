import { test, expect } from './fixtures';
import { primeSimUser, createProject, ensureBaseSection, switchSimUser } from './utils';

test('Auto-merge on threshold and add top-level section', async ({ page }) => {
  await primeSimUser(page, 'ana');
  await createProject(page, 'E2E Merge');
  await ensureBaseSection(page, { initialUser: 'ana' });

  // Open first section composer
  const firstEditBtn = page.locator('.section-edit').first();
  await firstEditBtn.click();
  // Update body and summary, then publish to queue (author auto-upvotes)
  const bodyArea = page.locator('#composerArea textarea').first();
  const newBody = `Updated body ${Date.now()}`;
  await bodyArea.fill(newBody);
  await page.locator('#changeSummary').fill('Improve body');
  await page.locator('#btnPublish').click();

  // Cast a second upvote as a different sim user to hit 40% (2/5)
  await switchSimUser(page, 'ben');
  // Wait for candidate to render and click Upvote
  const pool = page.locator('#candidatePoolList');
  await expect(pool).toBeVisible();
  const candidate = pool.locator('.candidate-card', { hasText: 'Improve body' }).first();
  await expect(candidate).toBeVisible();
  await candidate.getByRole('button', { name: 'Upvote' }).click();

  await switchSimUser(page, 'ana');

  // Entry should refresh and include the updated body
  await expect(page.locator('.section-body', { hasText: newBody })).toBeVisible();

  // Now add a new top-level sibling section to the first section
  await firstEditBtn.click();
  // In composer, click Add sibling for the root node
  await page.getByRole('button', { name: 'Add sibling' }).first().click();
  // Fill the last added node fields (the composer lists nodes sequentially)
  const allInputs = page.locator('.composer-input');
  await allInputs.last().fill('New top level');
  const allAreas = page.locator('.composer-textarea');
  const topBody = `Top body ${Date.now()}`;
  await allAreas.last().fill(topBody);
  await page.locator('#changeSummary').fill('Add top-level section');
  await page.locator('#btnPublish').click();

  // Merge the new top-level section with an additional upvote
  await page.locator('#userSelect').selectOption('chen');
  const newCandidate = page.locator('.candidate-card', { hasText: 'Add top-level section' }).first();
  await expect(newCandidate).toBeVisible();
  await newCandidate.getByRole('button', { name: 'Upvote' }).click();

  // Verify new heading appears in the Active Document after merge
  await expect(page.locator('.section-heading-text', { hasText: 'New top level' })).toBeVisible();
});
