import { test, expect } from '@playwright/test';
import { createProject } from './utils';

test('Star count increases across different users', async ({ page }) => {
  // Create project
  const name = await createProject(page, 'E2E Star Multi');

  // Go home and find the row for this project
  await page.goto('/');
  const row = page.getByRole('row', { name: new RegExp(`${name}`) });
  await expect(row).toBeVisible();
  const starBtn = row.locator('button.starBtn');
  const countEl = row.locator('.starCount');
  const readCount = async () => parseInt(await countEl.textContent() || '0', 10) || 0;
  const initial = await readCount();

  // Star as ana
  await page.selectOption('#simUserSelect', 'ana');
  await page.waitForURL(/\?sim_user=ana/);
  const rowAna = page.getByRole('row', { name: new RegExp(`${name}`) });
  await rowAna.locator('button.starBtn').click();
  await expect(rowAna.locator('.starCount')).toHaveText(String(initial + 1));

  // Star as ben
  await page.selectOption('#simUserSelect', 'ben');
  await page.waitForURL(/\?sim_user=ben/);
  const row2 = page.getByRole('row', { name: new RegExp(`${name}`) });
  const starBtn2 = row2.locator('button.starBtn');
  const countEl2 = row2.locator('.starCount');
  await starBtn2.click();
  await expect(countEl2).toHaveText(String(initial + 2));
});
