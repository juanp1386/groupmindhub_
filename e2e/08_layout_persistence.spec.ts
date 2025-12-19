import { test, expect } from './fixtures';
import { createProject } from './utils';

test('Workspace maximize persists across reload', async ({ page }) => {
  await createProject(page, 'E2E Layout');
  const shell = page.locator('#workspaceShell');
  expect(await shell.evaluate((el) => el.hasAttribute('data-max'))).toBeFalsy();
  // Maximize candidates pane
  await page.getByRole('button', { name: 'Max candidates' }).first().click();
  await expect(shell).toHaveAttribute('data-max', 'candidates');
  // Reload and verify persistence
  await page.reload();
  await expect(shell).toHaveAttribute('data-max', 'candidates');
});
