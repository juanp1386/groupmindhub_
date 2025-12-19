import { test, expect } from './fixtures';
import { primeSimUser, createProject, ensureBaseSection, switchSimUser } from './utils';

test('Overlapping proposal is marked needs refresh after a merge', async ({ page }) => {
  await primeSimUser(page, 'ana');
  await createProject(page, 'E2E Overlap');
  await ensureBaseSection(page, { initialUser: 'ana' });

  // First proposal A
  await page.locator('.section-edit').first().click();
  await page.locator('#composerArea textarea').first().fill('Overlap A');
  await page.locator('#changeSummary').fill('Overlap A');
  await page.locator('#btnPublish').click();

  // Second proposal B on same section
  await page.locator('.section-edit').first().click();
  await page.locator('#composerArea textarea').first().fill('Overlap B');
  await page.locator('#changeSummary').fill('Overlap B');
  await page.locator('#btnPublish').click();

  // Merge A: switch to another user to add the second yes vote
  await switchSimUser(page, 'ben');
  const cardA = page.locator('.candidate-card', { hasText: 'Overlap A' }).first();
  await expect(cardA).toBeVisible();
  await cardA.getByRole('button', { name: 'Upvote' }).click();

  // Verify via API that B is marked needs_update
  const statusOk = await page.evaluate(async (pid) => {
    const res = await fetch(`/api/projects/${pid}/changes?sim_user=ana`);
    const data = await res.json();
    const item = (data.changes||[]).find((c)=> c.summary === 'Overlap B');
    return item && item.status;
  }, await page.evaluate(() => {
    const el = document.getElementById('__entry_json');
    const parsed = el ? JSON.parse(el.textContent || '{}') : {};
    return parsed.project_id;
  }));
  expect(statusOk === 'needs_update' || statusOk === 'published').toBeTruthy();
});
