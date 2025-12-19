import { test, expect } from './fixtures';
import { primeSimUser, createProject, ensureBaseSection, switchSimUser } from './utils';

test('Home filters for Starred and Active work', async ({ page }) => {
  await primeSimUser(page, 'ana');

  // Create two projects
  await createProject(page, 'E2E Filter A');

  await createProject(page, 'E2E Filter B');
  await ensureBaseSection(page, { initialUser: 'ana' });

  // Make project B active by publishing a change
  await page.locator('.section-edit').first().click();
  await page.locator('#composerArea textarea').first().fill('Make active');
  await page.locator('#changeSummary').fill('Make active');
  await page.locator('#btnPublish').click();
  await switchSimUser(page, 'ben');
  const activeCandidate = page.locator('.candidate-card', { hasText: 'Make active' }).first();
  await expect(activeCandidate).toBeVisible();
  await activeCandidate.getByRole('button', { name: 'Upvote' }).click();
  await switchSimUser(page, 'ana');

  await page.goto('/');
  const table = page.locator('#projectsTable');
  await expect(table).toBeVisible();

  // Star the first row
  const firstRow = table.locator('tbody tr').first();
  const starBtn = firstRow.locator('button.starBtn');
  await starBtn.click();

  // Filter: Starred
  await page.locator('#projFilter').selectOption('starred');
  const visibleStarred = await table.locator('tbody tr').filter({ has: page.locator('button.starBtn:text("★")') }).count();
  expect(visibleStarred).toBeGreaterThan(0);

  // Filter: Active
  await page.locator('#projFilter').selectOption('active');
  // Count only visible rows (display not none)
  const visibleActive = await page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll('#projectsTable tbody tr')) as HTMLElement[];
    return rows.filter((r) => r.offsetParent !== null && r.style.display !== 'none').length;
  });
  expect(visibleActive).toBeGreaterThan(0);
});
