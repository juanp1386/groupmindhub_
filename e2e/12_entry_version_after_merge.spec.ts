import { test, expect } from '@playwright/test';
import { primeSimUser, createProject, ensureBaseSection, switchSimUser } from './utils';

test('Entry version increments after merge', async ({ page }) => {
  await primeSimUser(page, 'ana');
  await createProject(page, 'E2E Version');
  await ensureBaseSection(page, { initialUser: 'ana' });

  const getVersion = async () => parseInt(await page.locator('#entryVersion2').textContent(), 10) || 1;
  const initialVersion = await getVersion();

  // Publish change
  await page.locator('.section-edit').first().click();
  await page.locator('#composerArea textarea').first().fill('Version bump');
  await page.locator('#changeSummary').fill('Version bump');
  await page.locator('#btnPublish').click();

  // Add second yes vote
  await switchSimUser(page, 'ben');
  const card = page.locator('.candidate-card', { hasText: 'Version bump' }).first();
  await card.getByRole('button', { name: 'Upvote' }).click();
  await switchSimUser(page, 'ana');

  // Version should increment
  await expect(page.locator('#entryVersion2')).toHaveText(String(initialVersion + 1));
});
