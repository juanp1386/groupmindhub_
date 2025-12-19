import { test, expect } from './fixtures';
import { primeSimUser, createProject } from './utils';

test('Star toggle works on homepage', async ({ page }) => {
  await primeSimUser(page, 'ana');

  // Ensure at least one project exists by creating a minimal one
  await createProject(page, 'E2E Stars');

  await page.goto('/');
  const firstRow = page.locator('#projectsTable tbody tr').first();
  await expect(firstRow).toBeVisible();
  const starBtn = firstRow.locator('button.starBtn');
  const beforeText = await starBtn.textContent();
  await starBtn.click();
  // Button text toggles between ☆ and ★
  await expect(starBtn).not.toHaveText(beforeText || '');
  // Toggle back to avoid polluting star counts
  await starBtn.click();
});
