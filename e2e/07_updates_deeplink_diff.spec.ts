import { test, expect } from '@playwright/test';
import { primeSimUser, createProject, ensureBaseSection } from './utils';

test('Updates Diff deep-link opens entry with focused candidate diff', async ({ page }) => {
  await primeSimUser(page, 'ana');

  await createProject(page, 'E2E Updates');
  await ensureBaseSection(page, { initialUser: 'ana' });

  await page.locator('.section-edit').first().click();
  await page.locator('#composerArea textarea').first().fill('Changed for updates page');
  await page.locator('#changeSummary').fill('Updates check');
  await page.locator('#btnPublish').click();

  // Go to Updates and click Diff for that card
  await page.goto('/updates/');
  const card = page.locator('.update-card', { hasText: 'Updates check' }).first();
  await expect(card).toBeVisible();
  await card.getByRole('link', { name: 'Diff' }).click();

  // On entry page, the candidate card should be focused and diff panel open
  const candidate = page.locator('.candidate-card', { hasText: 'Updates check' }).first();
  await expect(candidate).toBeVisible();
  const diffPanel = candidate.locator('[data-diff-body]');
  await expect(diffPanel).toBeVisible();
});
