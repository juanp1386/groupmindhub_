import { test, expect } from './fixtures';

test('Theme toggle persists and swaps favicon', async ({ page }) => {
  await page.goto('/');
  const root = page.locator('html');
  const toggle = page.locator('#themeToggle');
  const favicon = page.locator('link#siteFavicon');

  // Initial state recorded
  const initialTheme = await root.getAttribute('data-theme');
  await expect(favicon).toHaveAttribute('href', /favicon-(light|dark)\.png$/);

  // Toggle theme
  await toggle.click();
  const toggledTheme = await root.getAttribute('data-theme');
  expect(toggledTheme).not.toBe(initialTheme);
  await expect(favicon).toHaveAttribute('href', toggledTheme === 'dark' ? /favicon-dark\.png$/ : /favicon-light\.png$/);

  // Reload and ensure persistence
  await page.reload();
  await expect(root).toHaveAttribute('data-theme', toggledTheme || '');
  await expect(favicon).toHaveAttribute('href', toggledTheme === 'dark' ? /favicon-dark\.png$/ : /favicon-light\.png$/);
});

