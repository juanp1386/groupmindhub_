import { test, expect } from '@playwright/test';
import { primeSimUser, createProject, ensureBaseSection } from './utils';

test('Candidate card shows correct required yes votes', async ({ page }) => {
  await primeSimUser(page, 'ana');
  await createProject(page, 'E2E Threshold');
  await ensureBaseSection(page, { initialUser: 'ana' });

  // Publish a change but do not add the second yes vote
  await page.locator('.section-edit').first().click();
  await page.locator('#composerArea textarea').first().fill('Threshold body');
  await page.locator('#changeSummary').fill('Threshold check');
  await page.locator('#btnPublish').click();

  // Candidate pool should show "+/2 needed" (2 = ceil(0.4*5))
  const card = page.locator('.candidate-card', { hasText: 'Threshold check' }).first();
  await expect(card).toBeVisible();
  await expect(card.locator('.candidate-score')).toContainText(/\b2 needed\b/);
});
