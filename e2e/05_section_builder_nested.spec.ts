import { test, expect } from './fixtures';

test('Project creation with nested sections renders correctly', async ({ page }) => {
  await page.goto('/projects/new/');
  const name = `E2E Nested ${Date.now()}`;
  await page.getByLabel('Project name').fill(name);

  const sections = page.locator('.builder-section');
  await expect(sections.first()).toBeVisible();
  await sections.nth(0).locator('.builder-heading-input').fill('One');
  await sections.nth(0).locator('.builder-textarea').fill('Body One');
  await sections.nth(0).getByRole('button', { name: 'Add subsection' }).click();

  const updatedSections = page.locator('.builder-section');
  await updatedSections.nth(1).locator('.builder-heading-input').fill('One.A');
  await updatedSections.nth(1).locator('.builder-textarea').fill('Body One.A');

  await page.getByRole('button', { name: 'Add another section' }).click();
  const afterSecondRoot = page.locator('.builder-section');
  await afterSecondRoot.nth(2).locator('.builder-heading-input').fill('Two');
  await afterSecondRoot.nth(2).locator('.builder-textarea').fill('Body Two');

  await page.getByRole('button', { name: 'Create project' }).click();
  await page.waitForURL(/\/entries\//);

  // Verify headings and depth classes in Active Document (match full text incl. numbering)
  const heading = page.locator('.section-heading-text');
  await expect(heading.filter({ hasText: /^1 One$/ })).toBeVisible();
  await expect(heading.filter({ hasText: /^1\.1 One\.A$/ })).toBeVisible();
  await expect(heading.filter({ hasText: /^2 Two$/ })).toBeVisible();
  // Depth markers exist
  const depth1 = await page.locator('.section-node.depth-1').count();
  const depth2 = await page.locator('.section-node.depth-2').count();
  expect(depth1).toBeGreaterThan(0);
  expect(depth2).toBeGreaterThan(0);
});
