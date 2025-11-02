import { Page, expect } from '@playwright/test';

export async function primeSimUser(page: Page, user: string) {
  await page.addInitScript((id) => {
    try {
      localStorage.setItem('gmh_sim_user', id as string);
    } catch (error) {
      console.warn('[E2E] Failed to prime sim user', error);
    }
  }, user);
}

export async function createProject(page: Page, prefix: string) {
  const projectName = `${prefix} ${Date.now()}`;
  await page.goto('/projects/new/');
  await page.getByLabel('Project name').fill(projectName);
  await page.getByRole('button', { name: 'Create project' }).click();
  await page.waitForURL(/\/entries\//);
  return projectName;
}

export async function switchSimUser(page: Page, user: string) {
  const selector = page.locator('#userSelect');
  await expect(selector).toBeVisible();
  await selector.selectOption(user);
}

export async function ensureBaseSection(page: Page, opts?: {
  heading?: string;
  body?: string;
  summary?: string;
  initialUser?: string;
}) {
  const options = {
    heading: opts?.heading ?? 'Seed section',
    body: opts?.body ?? `Seed body ${Date.now()}`,
    summary: opts?.summary ?? `Seed summary ${Date.now()}`,
    initialUser: opts?.initialUser ?? 'ana',
  };

  const existingSections = await page.locator('.section-edit').count();
  if (existingSections > 0) {
    return;
  }

  // Ensure composer is opened for a new top-level section.
  const addSectionBtn = page.locator('#btnAddSection');
  await expect(addSectionBtn).toBeVisible();
  await addSectionBtn.click();

  const headingInput = page.locator('.composer-input').first();
  const bodyArea = page.locator('.composer-textarea').first();
  await expect(headingInput).toBeVisible();
  await headingInput.fill(options.heading);
  await bodyArea.fill(options.body);

  const summaryInput = page.locator('#changeSummary');
  await summaryInput.fill(options.summary);
  const publishBtn = page.locator('#btnPublish');
  await publishBtn.click();

  const candidateSummary = page.locator('.candidate-card', { hasText: options.summary }).first();
  await expect(candidateSummary).toBeVisible();

  // Switch to a second user to provide the deciding vote.
  await switchSimUser(page, 'ben');
  const candidateForVote = page.locator('.candidate-card', { hasText: options.summary }).first();
  await expect(candidateForVote).toBeVisible();
  await candidateForVote.getByRole('button', { name: 'Upvote' }).click();

  await expect(page.locator('.section-heading-text', { hasText: options.heading })).toBeVisible();

  // Switch back to the original author to keep later steps predictable.
  await switchSimUser(page, options.initialUser);
}
