import { test, expect } from '@playwright/test';
import { primeSimUser, createProject, ensureBaseSection } from './utils';

test('Candidate pool shows top 3, extras go to queue', async ({ page }) => {
  await primeSimUser(page, 'ana');
  await createProject(page, 'E2E Pool');
  await ensureBaseSection(page, { initialUser: 'ana' });

  // Publish 4 proposals for same section
  for (let i = 1; i <= 4; i += 1) {
    await page.locator('.section-edit').first().click();
    await page.locator('#composerArea textarea').first().fill(`Pool body ${i}`);
    await page.locator('#changeSummary').fill(`Pool proposal ${i}`);
    await page.locator('#btnPublish').click();
    await page.waitForFunction((expected) => {
      const list = (window as any).__gmhDebug?.changeState?.list || [];
      return list.length >= expected;
    }, i);
  }

  // Pool list should contain Keep card + up to 3 proposals
  const poolList = page.locator('#candidatePoolList');
  await expect(poolList).toBeVisible();
  const cards = await poolList.locator('.candidate-card').count();
  expect(cards).toBeGreaterThanOrEqual(1); // includes Keep card
  // Queue should have at least 1 item since we added 4 proposals (MAX_POOL_ITEMS=3)
  await page.waitForSelector('#waitingQueueList .queue-item');
  const queueItems = await page.locator('#waitingQueueList .queue-item').count();
  expect(queueItems).toBeGreaterThanOrEqual(1);
});
