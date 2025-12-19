import { test, expect } from './fixtures';
import { primeSimUser, createProject, ensureBaseSection, switchSimUser } from './utils';

test('History panel shows merged change for focused section', async ({ page }) => {
  await primeSimUser(page, 'ana');
  await createProject(page, 'E2E History');
  await ensureBaseSection(page, { initialUser: 'ana' });

  // Publish and merge a change
  await page.locator('.section-edit').first().click();
  await page.locator('#composerArea textarea').first().fill('History body');
  await page.locator('#changeSummary').fill('History merge');
  await page.locator('#btnPublish').click();
  await switchSimUser(page, 'ben');
  const card = page.locator('.candidate-card', { hasText: 'History merge' }).first();
  await card.getByRole('button', { name: 'Upvote' }).click();
  await switchSimUser(page, 'ana');

  // History panel should list this change
  const historyList = page.locator('#historyList');
  await expect(historyList).toBeVisible();
  await expect(historyList).toContainText('History merge');
});
