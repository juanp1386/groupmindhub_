import { test, expect } from '@playwright/test';
import { createProject } from './utils';

test('Index reflects stars for simulated user', async ({ page }) => {
  // Create project
  const name = await createProject(page, 'E2E Sim Stars');

  // Navigate home and switch to ana via selector (triggers reload)
  await page.goto('/');
  await page.selectOption('#simUserSelect', 'ana');
  await page.waitForURL(/\?sim_user=ana/);

  const row = page.getByRole('row', { name: new RegExp(name) });
  await expect(row).toBeVisible();
  const starBtn = row.locator('button.starBtn');
  const current = await starBtn.getAttribute('data-starred');
  if (current !== '1') {
    await starBtn.click();
    await expect(starBtn).toHaveAttribute('data-starred', '1');
  }

  // Switch to ben and confirm star is not set for that user
  await page.selectOption('#simUserSelect', 'ben');
  await page.waitForURL(/\?sim_user=ben/);
  const row2 = page.getByRole('row', { name: new RegExp(name) });
  await expect(row2).toBeVisible();
  await expect(row2.locator('button.starBtn')).toHaveAttribute('data-starred', '0');
});
