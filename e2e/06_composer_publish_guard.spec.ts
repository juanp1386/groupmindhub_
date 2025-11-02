import { test, expect } from '@playwright/test';
import { createProject, ensureBaseSection } from './utils';

test('Composer blocks publish when no changes exist', async ({ page }) => {
  await createProject(page, 'E2E Guard');
  await ensureBaseSection(page);

  // Start editing first section
  await page.locator('.section-edit').first().click();

  const publish = page.locator('#btnPublish');
  const affects = page.locator('#affectsTags');
  // Initially disabled
  await expect(publish).toBeDisabled();
  await expect(affects).toContainText(/No changes to publish/i);

  // Make a change
  const bodyArea = page.locator('#composerArea textarea').first();
  await bodyArea.fill('Changed via E2E');

  // Now enabled
  await expect(publish).toBeEnabled();
});
