import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

import { chromium, expect } from '@playwright/test';

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const item = argv[i];
    if (!item.startsWith('--')) continue;
    const key = item.slice(2);
    const value = argv[i + 1];
    args[key] = value;
    i += 1;
  }
  return args;
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function filenameForPath(pagePath) {
  if (pagePath === '/' || pagePath === '') return 'home.png';
  const trimmed = pagePath.replace(/^\/+/, '').replace(/\/+$/, '');
  return `${trimmed.replace(/\//g, '_')}.png`;
}

async function ensureLoggedIn(page, baseUrl, username, password) {
  await page.goto(`${baseUrl}/`, { waitUntil: 'domcontentloaded' });
  const logoutButton = page.getByRole('button', { name: /^logout$/i });
  if (await logoutButton.count()) {
    return;
  }

  await page.goto(`${baseUrl}/login/?next=/`, { waitUntil: 'domcontentloaded' });
  await page.getByLabel(/^username$/i).fill(username);
  await page.getByLabel(/^password$/i).fill(password);
  await page.getByRole('button', { name: /^login$/i }).click();
  await page.waitForLoadState('domcontentloaded');

  if (page.url().includes('/login')) {
    const errors = page.locator('.form-errors, .field-errors');
    const hasErrors = await errors.first().isVisible().catch(() => false);
    if (hasErrors) {
      await page.goto(`${baseUrl}/signup/?next=/`, { waitUntil: 'domcontentloaded' });
      await page.getByLabel(/^username$/i).fill(username);

      const emailInput = page.getByLabel(/^email$/i);
      if (await emailInput.count()) {
        await emailInput.fill(`${username}@example.com`);
      }

      await page.getByLabel(/^password$/i).fill(password);
      await page.getByLabel(/password confirmation/i).fill(password);
      await page.getByRole('button', { name: /sign up/i }).click();
      await page.waitForLoadState('domcontentloaded');

      const signupErrors = page.locator('.form-errors, .field-errors');
      const stillHasErrors = await signupErrors.first().isVisible().catch(() => false);
      if (stillHasErrors) {
        throw new Error(`Signup failed for user "${username}" (see page errors).`);
      }
    }
  }

  await expect(page.getByRole('button', { name: /^logout$/i })).toBeVisible();
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const baseUrl = (args['base-url'] || 'http://127.0.0.1:8000').replace(/\/+$/, '');
  const outDir = args['out'] || '.harness/screenshots';
  const pagesArg = args['pages'] || '/,/updates/';
  const pages = pagesArg
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean);

  const username = args['username'] || process.env.E2E_USER || 'e2e';
  const password = args['password'] || process.env.E2E_PASS || 'e2e-pass';

  ensureDir(outDir);

  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const page = await context.newPage();

  await ensureLoggedIn(page, baseUrl, username, password);

  for (const pagePath of pages) {
    const url = pagePath.startsWith('http') ? pagePath : `${baseUrl}${pagePath.startsWith('/') ? '' : '/'}${pagePath}`;
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(250);

    const filename = filenameForPath(pagePath);
    const dest = path.join(outDir, filename);
    await page.screenshot({ path: dest, fullPage: true });
    // eslint-disable-next-line no-console
    console.log(`[harness] screenshot: ${dest}`);
  }

  await context.close();
  await browser.close();
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exitCode = 1;
});
