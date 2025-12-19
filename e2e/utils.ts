import { Page, expect } from '@playwright/test';

const DEFAULT_E2E_USER = process.env.E2E_USER || 'e2e';
const DEFAULT_E2E_PASS = process.env.E2E_PASS || 'e2e-pass';

function uniqueSuffix() {
  return String(Date.now());
}

export async function primeSimUser(page: Page, user: string) {
  await page.addInitScript((id) => {
    try {
      localStorage.setItem('gmh_sim_user', id as string);
    } catch (error) {
      console.warn('[E2E] Failed to prime sim user', error);
    }
  }, user);
}

export async function ensureLoggedIn(page: Page, opts?: { username?: string; password?: string }) {
  const username = opts?.username ?? DEFAULT_E2E_USER;
  const password = opts?.password ?? DEFAULT_E2E_PASS;

  // If already authed, we’ll see the Logout button in the global header.
  await page.goto('/');
  const logoutButton = page.getByRole('button', { name: /^logout$/i });
  if (await logoutButton.count()) {
    return;
  }

  // Attempt login.
  await page.goto('/login/?next=/');
  await page.getByLabel(/^username$/i).fill(username);
  await page.getByLabel(/^password$/i).fill(password);
  await page.getByRole('button', { name: /^login$/i }).click();
  await page.waitForLoadState('domcontentloaded');

  // If login failed (user missing), sign up and then we’ll be logged in.
  if (page.url().includes('/login')) {
    const errors = page.locator('.form-errors, .field-errors');
    const hasErrors = await errors.first().isVisible().catch(() => false);
    if (hasErrors) {
      await page.goto('/signup/?next=/');
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
        throw new Error(
          `E2E signup failed for user "${username}". Either the user exists with a different password or signup validation failed.`
        );
      }
    }
  }

  await expect(page.getByRole('button', { name: /^logout$/i })).toBeVisible();
}

export async function createProject(page: Page, prefix: string) {
  const projectName = `${prefix} ${uniqueSuffix()}`;
  await page.goto('/projects/new/');
  await page.getByLabel('Project name').fill(projectName);
  await page.getByRole('button', { name: 'Create project' }).click();
  await page.waitForURL(/\/entries\//);
  return projectName;
}

export async function createProjectViaUI(
  page: Page,
  options?: {
    name?: string;
    description?: string;
    visibility?: 'public' | 'private';
    sections?: string[];
    governance?: { poolSize?: number; approvalThreshold?: number; durationHours?: number };
  }
) {
  const projectName = options?.name || `Project ${uniqueSuffix()}`;
  await page.goto('/projects/new/');
  await page.locator('#projectName').fill(projectName);

  if (options?.description) {
    await page.locator('#projectDescription').fill(options.description);
  }
  if (options?.visibility) {
    await page.locator('#projectVisibility').selectOption(options.visibility);
  }

  if (options?.governance) {
    const { poolSize, approvalThreshold, durationHours } = options.governance;
    if (poolSize !== undefined) {
      await page.locator('#id_voting_pool_size').fill(String(poolSize));
    }
    if (approvalThreshold !== undefined) {
      await page.locator('#id_approval_threshold').fill(String(approvalThreshold));
    }
    if (durationHours !== undefined) {
      await page.locator('#id_voting_duration_hours').fill(String(durationHours));
    }
  }

  const sections = options?.sections || [];
  for (const heading of sections) {
    await page.locator('[data-add-root]').first().click();
    const headingInput = page.locator('.builder-heading-input').last();
    await headingInput.fill(heading);
  }

  await page.getByRole('button', { name: 'Create project' }).click();
  await page.waitForURL(/\/entries\/\d+\/?$/);

  const entryUrl = page.url();
  const match = /entries\/(\d+)/.exec(entryUrl);
  return { name: projectName, projectId: match ? match[1] : '', entryUrl };
}

export async function switchSimUser(page: Page, user: string) {
  const selector = page.locator('#userSelect');
  await expect(selector).toBeVisible();
  await selector.selectOption(user);
}

export async function ensureBaseSection(
  page: Page,
  opts?: {
    heading?: string;
    body?: string;
    summary?: string;
    initialUser?: string;
  }
) {
  const options = {
    heading: opts?.heading ?? 'Seed section',
    body: opts?.body ?? `Seed body ${uniqueSuffix()}`,
    summary: opts?.summary ?? `Seed summary ${uniqueSuffix()}`,
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
