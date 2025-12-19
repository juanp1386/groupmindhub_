# Local Testing Plan

This guide outlines quick manual smoke tests and how to run the existing Playwright E2E suite. It reflects the current shipped feature set (auth + roles, private projects/invites, editor workflows, comments, theming, and governance).

## Environment preparation

Backend:

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python manage.py migrate
```

E2E:

```bash
npm install
npx playwright install
```

## Manual smoke tests

1. **Auth + membership roles**
   - Sign up, log in, log out.
   - Create a project; creator should be Owner.
   - Invite another user; accept invite; verify role (Owner/Editor/Viewer) and permissions.
2. **Private projects + invites**
   - Create a private project; confirm a non-member is blocked.
   - Accept an invite link and verify access.
3. **Entry editor + proposals**
   - Edit a section, publish a proposal, verify it appears in the proposal list.
   - Vote from multiple simulated users and verify merge behavior.
   - Confirm “No changes to publish” guard when publishing an unchanged draft.
4. **Comments**
   - Add a comment to a proposal and to a section.
   - Delete a comment as the author; verify editor+ can delete; viewer cannot.
5. **Governance settings**
   - Set pool size / threshold / duration on project creation or settings.
   - Verify `required_yes_votes` behavior matches expectations.
6. **Theming**
   - Toggle light/dark; refresh and confirm persistence and favicon/logo swap.
7. **Updates page**
   - Visit `/updates` and verify open votings and deep links navigate into the correct entry/section/proposal.

## Playwright suite (current)

Run all E2E tests:

```bash
npm run test:e2e
```

How it works:
- The suite uses `e2e/fixtures.ts` to ensure you are logged in before each test.
- Credentials default to `E2E_USER=e2e` and `E2E_PASS=e2e-pass`. If the user does not exist yet, the fixture will sign up.
- `playwright.config.js` starts `python manage.py runserver 127.0.0.1:8000 --noreload` automatically.
- Set `BASE_URL` if you need a different base URL.

### Spec file map

The committed suite is organized as numbered specs under `e2e/`:

- `e2e/01_stars.spec.ts` – starring from the homepage
- `e2e/02_merge_and_top_level.spec.ts` – auto-merge and new top-level proposals
- `e2e/03_updates_page.spec.ts` – `/updates` page basics
- `e2e/04_theme_persistence.spec.ts` – theme persistence
- `e2e/05_section_builder_nested.spec.ts` – nested section builder on project creation
- `e2e/06_composer_publish_guard.spec.ts` – publish guard rails
- `e2e/07_updates_deeplink_diff.spec.ts` – updates deep-linking into diffs
- `e2e/08_layout_persistence.spec.ts` – workspace layout persistence
- `e2e/09_vote_threshold.spec.ts` – governance vote thresholds
- `e2e/10_overlap_needs_refresh.spec.ts` – overlap/needs-refresh behaviors
- `e2e/11_home_filters_starred_active.spec.ts` – homepage filters (starred/activity)
- `e2e/12_entry_version_after_merge.spec.ts` – entry version incrementing
- `e2e/13_manual_merge_guard.spec.ts` – manual merge gating
- `e2e/14_star_count_multiuser.spec.ts` – star count behavior across users
- `e2e/15_candidate_pool_queue.spec.ts` – candidate pool/queue UI coverage
- `e2e/16_sim_user_index_stars.spec.ts` – sim-user + index behaviors
- `e2e/17_history_panel.spec.ts` – history panel after merges
- `e2e/18_maximize_visibility.spec.ts` – maximize/toggle behaviors
- `e2e/19_new_section_proposal.spec.ts` – new section proposal flows

## Test artifacts

- Traces and screenshots are written under `test-results/`.
- To open a trace: `npx playwright show-trace test-results/<run>/trace.zip`.
