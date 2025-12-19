import { test, expect } from './fixtures';
import { createProject } from './utils';

test('Maximize hides other panes and expands target', async ({ page }) => {
  // Seed simple project
  await createProject(page, 'E2E Maximize');

  const shell = page.locator('#workspaceShell');
  const docPane = page.locator(".workspace-pane[data-pane='doc']");
  const candPane = page.locator(".workspace-pane[data-pane='candidates']");
  const editPane = page.locator(".workspace-pane[data-pane='editor']");

  // Max candidates
  await page.getByRole('button', { name: 'Max candidates' }).click();
  await expect(shell).toHaveAttribute('data-max', 'candidates');
  await expect(docPane).toBeHidden();
  await expect(editPane).toBeHidden();

  // Max editor
  await page.getByRole('button', { name: 'Max editor' }).click();
  await expect(shell).toHaveAttribute('data-max', 'editor');
  await expect(docPane).toBeHidden();
  await expect(candPane).toBeHidden();

  // Max doc
  await page.getByRole('button', { name: 'Max doc' }).click();
  await expect(shell).toHaveAttribute('data-max', 'doc');
  await expect(candPane).toBeHidden();
  await expect(editPane).toBeHidden();
});
