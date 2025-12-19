import { test, expect } from './fixtures';
import { primeSimUser, createProject, ensureBaseSection, switchSimUser } from './utils';

test('Manual merge is blocked until threshold, then succeeds', async ({ page }) => {
  await primeSimUser(page, 'ana');
  await createProject(page, 'E2E Manual Merge');
  await ensureBaseSection(page, { initialUser: 'ana' });

  // Publish one change
  await page.locator('.section-edit').first().click();
  await page.locator('#composerArea textarea').first().fill('Manual merge body');
  await page.locator('#changeSummary').fill('Manual merge');
  await page.locator('#btnPublish').click();

  // Get project id and change id from the page
  const ids = await page.evaluate(() => {
    const el = document.getElementById('__entry_json');
    const parsed = el ? JSON.parse(el.textContent || '{}') : {};
    return { projectId: parsed.project_id };
  });
  const { projectId } = ids as { projectId: number };
  const list = await page.evaluate(async (pid) => {
    const res = await fetch(`/api/projects/${pid}/changes?sim_user=ana`);
    return res.json();
  }, projectId);
  const change = (list.changes || []).find((c: any) => c.summary === 'Manual merge');
  expect(change).toBeTruthy();

  // Attempt manual merge as ana before threshold
  const resBad = await page.evaluate(async (cid) => {
    const res = await fetch(`/api/changes/${cid}/merge?sim_user=ana`, { method: 'POST' });
    return { status: res.status, data: await res.json().catch(() => ({})) };
  }, change.id);
  expect(resBad.status).toBe(400);
  expect(resBad.data && resBad.data.required_yes_votes).toBeGreaterThan(0);

  // Add second yes vote (ben)
  await switchSimUser(page, 'ben');
  const card = page.locator('.candidate-card', { hasText: 'Manual merge' }).first();
  await card.getByRole('button', { name: 'Upvote' }).click();
  // Wait until passing per API before trying manual merge
  const isPassing = await page.evaluate(async (pid) => {
    const res = await fetch(`/api/projects/${pid}/changes?sim_user=ben`);
    const data = await res.json();
    const item = (data.changes||[]).find((c)=> c.summary === 'Manual merge');
    return item && item.is_passing;
  }, projectId);
  if (!isPassing) {
    await page.waitForTimeout(200);
  }

  // Now merge succeeds
  const resOk = await page.evaluate(async (cid) => {
    const res = await fetch(`/api/changes/${cid}/merge?sim_user=ana`, { method: 'POST' });
    return { status: res.status, data: await res.json().catch(() => ({})) };
  }, change.id);
  expect(resOk.status).toBe(200);
  expect(resOk.data && resOk.data.change && resOk.data.change.status).toBe('merged');
});
