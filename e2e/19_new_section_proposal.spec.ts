import { test, expect } from '@playwright/test';

test('Top-level section proposals skip keep-as-is and land in candidate pool', async ({ page }) => {
  await page.goto('/projects/new/');
  const projectName = `E2E New Section ${Date.now()}`;
  await page.getByLabel('Project name').fill(projectName);
  await page.getByRole('button', { name: 'Create project' }).click();
  await page.waitForURL(/\/entries\//);

  await page.locator('#btnAddSection').click();

  const composer = page.locator('#composerArea');
  await expect(composer.getByLabel('Heading')).toBeVisible();
  await composer.getByLabel('Heading').fill('Community Garden Governance');
  await composer.getByLabel('Body').fill('Outlines responsibilities for the new committee.');
  await page.locator('#changeSummary').fill('Add community governance section');
  await expect(page.locator('#btnPublish')).toBeEnabled();
  await page.locator('#btnPublish').click();

  const candidateList = page.locator('#candidatePoolList');
  await expect(candidateList.locator('.candidate-card .candidate-title', { hasText: 'Add community governance section' })).toHaveCount(1);
  await expect(candidateList.locator('.candidate-title', { hasText: 'Keep as-is' })).toHaveCount(0);

  const queueEmpty = page.locator('#waitingQueueEmpty');
  await expect(queueEmpty).toBeVisible();
  await expect(queueEmpty).toHaveText('Queue is empty for new section proposals.');
});
