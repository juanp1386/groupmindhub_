# Local Testing Plan for Upcoming Features

This guide outlines manual and automated checks you can run locally to validate the planned features (auth, private projects, editor UX, comments, styling, voting parameters) before deploying. Commands assume the repo root and a working Playwright setup (`npm install`, `npx playwright install` if needed).

## Environment Preparation
- Activate the virtualenv (if any) and install backend deps: `pip install -r requirements.txt`
- Apply migrations and start a dev server: `python manage.py migrate` then `python manage.py runserver 0.0.0.0:8000`
- In a separate shell for Playwright tests, ensure dependencies: `npm install` (already in repo) and `npx playwright install` for browsers.
- Set `BASE_URL=http://localhost:8000` for Playwright tests.

## Manual Smoke Tests
1. **Authentication & Roles**
   - Sign up a new user, verify login/logout flows.
   - Create a project; ensure creator is Owner.
   - Invite another user; accept invite; verify role badges (Owner/Editor/Viewer) and permissions (edit vs. view-only).
2. **Private Projects & Invites**
   - Create a private project; confirm non-members get 403/redirect.
   - Accept invite via token/link; confirm access granted and role-specific permissions enforced.
3. **Document Editor UX**
   - Expand/collapse outline; confirm state persists after refresh.
   - Use search box to filter outline nodes.
   - Drag sections to reorder; verify hierarchy rules and that order persists after reload.
4. **Comments**
   - Add comments to a proposal and to a section; confirm timestamps and author display.
   - Delete a comment as owner/editor; verify viewer cannot delete.
5. **Styling & Responsiveness**
   - Resize viewport to tablet/mobile widths; confirm navigation collapses appropriately and controls remain accessible.
   - Check color contrast and spacing for clarity in both light/dark themes (if applicable).
6. **Voting Parameters**
   - Create a project with custom voting thresholds/duration; ensure they display on project/settings pages.
   - Propose changing voting parameters and observe governance flow if implemented.

## Playwright Test Suite Outline
Create tests under `e2e/` (Playwright config exists). Suggested specs:

### 1) `e2e/auth.spec.ts`
- Sign-up flow creates a new user and redirects to dashboard.
- Login with existing credentials works; logout clears session.
- Authentication gate: unauthenticated user hitting project detail is redirected to login.

### 2) `e2e/projects_private_invites.spec.ts`
- Create public and private projects; assert visibility toggles in UI.
- Private project blocks non-members (expect 403 or redirect).
- Generate invite link; secondary browser context accepts invite; verify membership role shown and access allowed.

### 3) `e2e/editor_outline.spec.ts`
- Load project entry; outline renders all sections.
- Collapse/expand sections and persist state after reload (check localStorage or UI state).
- Use outline search to filter nodes; clearing search restores full tree.
- Drag-and-drop to reorder sections; confirm backend reflects new order via page reload.

### 4) `e2e/comments.spec.ts`
- Add a comment to a proposal; comment appears with author and timestamp.
- Add a comment to a section; verify threaded display if supported.
- Delete/edit permissions: owner/editor can remove; viewer cannot (expect disabled UI or error toast).

### 5) `e2e/styling_responsive.spec.ts`
- Use `page.setViewportSize` to test desktop/tablet/mobile breakpoints.
- Confirm nav collapses to hamburger (or equivalent) and overlays function at mobile widths.
- Verify key buttons/inputs remain visible and usable after resize.

### 6) `e2e/voting_parameters.spec.ts`
- During project creation, set custom voting parameters; verify they appear in project detail/settings.
- Trigger a proposal to adjust parameters; ensure UI reflects pending change and updated values after approval.

## Example Playwright Snippets
- Launch two contexts for invite acceptance:
  ```ts
  const owner = await chromium.launchPersistentContext('tmp/owner', { baseURL });
  const invitee = await chromium.launchPersistentContext('tmp/invitee', { baseURL });
  ```
- Drag-and-drop helper for sections:
  ```ts
  await page.dragAndDrop('[data-section-id="1"]', '[data-section-id="2"]');
  ```

## Running Tests
- Headed run for debugging: `BASE_URL=http://localhost:8000 npx playwright test --headed e2e/auth.spec.ts`
- Full suite: `BASE_URL=http://localhost:8000 npx playwright test`
- Collect trace on failure: `npx playwright test --trace on`

## Reporting
- Save artifacts (screenshots, traces) to `test-results/` (already configured). Review `test-results/index.html` after runs.

This plan is modular—start with auth/private project flows, then layer in editor UX, comments, styling, and voting tests as features land.
