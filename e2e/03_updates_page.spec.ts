import { test, expect } from '@playwright/test';

async function setSimUser(page, user: string) {
  await page.addInitScript((u) => {
    try { localStorage.setItem('gmh_sim_user', u as string); } catch {}
  }, user);
}

test('Updates page renders and filters persist', async ({ page }) => {
  await setSimUser(page, 'ana');

  await page.goto('/updates/');
  await expect(page.getByRole('heading', { name: 'My updates' })).toBeVisible();
  // Basic visibility of blocks
  await expect(page.getByRole('heading', { name: 'Open votings' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Your proposals' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Followed activity' })).toBeVisible();

  // Persist a filter change
  const sectionInput = page.getByPlaceholder('e.g., Meetings');
  await sectionInput.fill('policy');
  await page.getByRole('button', { name: 'Apply filters' }).click();
  await page.waitForURL(/updates/);
  await page.goto('/updates/');
  await expect(page.getByPlaceholder('e.g., Meetings')).toHaveValue(/policy/i);
});

