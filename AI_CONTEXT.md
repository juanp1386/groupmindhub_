# AI_CONTEXT.md — GroupMindHub (Django build)

Keep this close when extending the app or prompting Copilot.

## Key concepts
- Auto-merge thresholds + voting windows are stored per-project (`Project.voting_pool_size`, `approval_threshold`, `voting_duration_hours`) and surfaced through the entry JSON for the client.
- Change ops: `UPDATE_TEXT`, `INSERT_BLOCK`, `DELETE_BLOCK`, `MOVE_BLOCK` (mirrors prototype semantics).
- Section scope drives validation — all ops/anchors must stay within the targeted section tree.
- Theme toggle + palette variables live in `templates/entry_detail.html` and are reused via CSS custom properties.

## Frontend modules
- `static/js/entry_detail.js`
  - Bootstraps entry state from `__entry_json` (see `serialize_entry`).
  - Renders sections (`renderEntry`) and composer (`renderComposerTree`).
  - `computeOps(originalRoot, updatedRoot, context)` builds ops/anchors between draft/original trees.
  - `buildChangePreview(includeOutline)` computes ops + diff outlines before publish.
  - `updateComposerPreview()` manages scope badge + publish button state.
  - Theme toggle: persists to `localStorage` (`gmh_theme`) and swaps favicons via DOM manipulation.
- `templates/entry_detail.html`
  - Defines palette variables for light/dark themes and wraps composer markup.
  - Header hosts theme toggle, simulated user select, and logo swap (light/dark assets under `static/img/`).

## Backend modules
- `groupmindhub/apps/core/api.py`
  - `serialize_entry(entry)` → nested sections tree consumed by the frontend.
  - `_normalize_section_block_id` ensures heading ids use `h_` prefix.
  - `api_project_changes_create` validates ops, creates `Change`, auto-upvotes publisher, and triggers `auto_merge()`.
  - `api_change_vote` + `api_change_merge` for vote/merge actions.
- `groupmindhub/apps/core/logic.py`
  - `build_section_index(entry)` builds numbering + descendant membership for validation/hints.
  - `apply_ops(entry, ops)` applies ops during merge.
  - `auto_merge()` checks passing status and applies merges.
- `groupmindhub/apps/web/views.py`
  - `entry_detail` seeds context + JSON payload for frontend script.
  - `project_new` builds initial sections/blocks from submitted structure.
  - `project_star_toggle` handles AJAX star toggles.

## Testing
- `groupmindhub/apps/core/tests/test_api.py::ChangeApiTests` exercises change creation for new subsections.
- Run all tests with `python manage.py test` (SQLite default).

## Common hooks
- **Simulated user login**: `_apply_sim_user(request)` co-opts `sim_user` param to create/login a matching Django user.
- **Change outlines**: `computeOutlines(ops)` (JS) mirrors backend outline snapshots for diff display.
- **Assets**: update `favicon-light.png`, `favicon-dark.png`, `logo-light.png`, `logo-dark.png` when branding changes; keep filenames consistent with template IDs.

## Extension ideas
- Add backend persistence for themes or user-specific preferences.
- Enrich diff rendering with inline highlights (existing structure is ready to expand).
- Expand `ChangeApiTests` to cover deletes/moves and ensure validation remains robust.
