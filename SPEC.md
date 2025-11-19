# GroupMindHub – Product Spec (Current)

## Core principles
- Every published change is immutable; edits become new changes with structured operations.
- Minimum 40 % of the simulated user pool must vote “yes” for auto-merge to fire.
- Sections are the atomic editing unit; headings and paragraph bodies stay in sync with numbering.
- Entry view maintains a document-like reading experience in both light and dark palettes.

## Scope
- Single entry (“Trunk”) per project (seeded on project creation).
- Project creation form exposes a document-style outline builder with inline heading/body editors so the initial entry mirrors the Workspace document.
- Section composer supports add/remove/reorder/indent/outdent of subsections and body text updates.
- Voting (−1/0/+1) with merge gating at each project's configured pool/threshold (defaults: 40 % of 5 simulated voters, 24 h duration).
- Auto-merge promotes passing changes and snapshots history with before/after outlines.
- Project discovery via landing page with activity scores and starring.

## Domain model
- **Project** – name, description, stars, has one canonical entry.
- **Entry** – title, version, votes cache, related blocks/sections/history.
- **Block** – stable id, type (`h2`/`p`), text, parent relationship and ordering.
- **Section** – heading/body grouping for hierarchical structure.
- **Change** – published change with ops JSON, affected blocks, anchors, target section, status (`draft|published|merged|needs_update`), `base_entry_version_int`, decision window (`closes_at`), optional `flags` array, optional `bundle_key` for multi-section submissions, and `target_section_id` which may be set to the sentinel `__root__` for brand-new top-level sections.
- **Vote** – user vote on a change.
- **EntryHistory** – snapshots before/after outlines when changes merge.
- **ProjectStar** – user-to-project star relation.

## APIs
All endpoints live under `/api/` and expect/return JSON.

| Method | Route | Purpose |
| ------ | ----- | ------- |
| GET | `/api/projects/<id>/entry` | Latest serialized entry (blocks + sections tree) |
| GET | `/api/projects/<id>/changes` | List published/merged changes with computed votes |
| POST | `/api/projects/<id>/changes/create` | Publish a change with ops/anchors/summary/section scope |
| POST | `/api/changes/<id>/votes` | Cast/toggle a vote (`value = -1,0,1`) |
| POST | `/api/changes/<id>/merge` | Manually merge (guarded by `is_passing`) |
| POST | `/api/projects/<id>/star-toggle` | Toggle project star for current/simulated user |

`GET /api/projects/<id>/changes` returns each change with voting aggregates plus: `base_entry_version_int`, `closes_at`, `bundle_key` (when applicable), `flags`, `auto_remove_threshold`, and `target_section_heading/numbering` for UI surfacing.

### Change payload
```json
{
  "entry_id": 12,
  "section_id": "root",
  "summary": "Clarify purpose",
  "ops_json": [{"type": "UPDATE_TEXT", "block_id": "p_s1", "new_text": "…"}],
  "affected_blocks": ["p_s1"],
  "anchors": ["after:h_s1"],
  "before_outline": "1 Purpose",
  "after_outline": "1 Purpose\n  ‣ Updated text",
  "sim_user": "ana"
}
```
Validation ensures anchors and parents stay within the targeted section while allowing references to blocks inserted earlier in the payload.

To propose a brand-new top-level section, send `section_id: "__root__"`; the change must consist solely of `INSERT_BLOCK` operations and will be evaluated without a corresponding “Keep as-is” card.

## Entry UI behaviors
- Section headings show numbering inline (e.g., `1.2 Scope`) with edit/add controls only surfacing while a section is focused or actively being edited.
- Composer inputs stack vertically with labeled heading/body areas and contextual action buttons.
- Entry column is scrollable on desktop; sections split by subtle borders for readability, and status chips reflect both in-section voting and new top-level section proposals (with inline banners inserted where a new section would land).
- UI chrome uses a subtle grain texture applied to body, panels, headers, and cards for depth across light and dark modes.
- Theme toggle persists in `localStorage` and swaps logos/favicons to match mode.
- Change cards render GitHub-style before/after summaries with colored markers for additions/removals/moves.

## Auto-merge rules
1. Each vote recalculates yes/no tallies and determines `is_passing`.
2. Auto-merge runs after publish/vote and promotes any change meeting the 40 % threshold.
3. Merge increments entry version, records history, and keeps change card visible in the history list.
4. Future overlapping detection hooks remain available in `logic.py` for expansion.

## Acceptance criteria
1. Drafting a subsection with new heading + body publishes successfully (covered by regression test `ChangeApiTests.test_insert_subsection_allows_new_child_body`).
2. Theme toggle updates palette variables, logos, and favicon paths for both modes.
3. Publishing without modifications is blocked; composer surfaces “No changes to publish.”
4. Voting updates score and merge button state without reload; merged changes label author and move to history panel.

## Future extensions
- Real authentication replacing simulated users.
- Concurrent section locking and conflict resolution via `overlaps` detection.
- Notifications (SSE/WebSocket) for new changes and merge events.
- Richer block types (lists, code blocks) in composer and diff previews.

## Workspace & Updates Implementation Status

- **Shipped**: three-pane workspace frame with persisted gutters/maximize controls; per-section status chips; candidate pool + waiting queue scaffolding; proposal editor draft/save affordances; `/updates` hub with filters, empty states, and deep links back into the workspace; inline “Add section below” controls plus an editable “After section” anchor row in the composer.
- **Outstanding**:
  - Drive countdown timers and decision states from `closes_at` rather than client-side seeds.
  - Persist and expose proposal `flags`, `bundle_key`, `auto_remove_threshold`, and block flagged items from surfacing in the active pool.
  - Surface keep-as-is support percentages and enforce one active proposal per author/section.
  - Honor `/updates` deep links that request “Fix & resubmit” by preloading the relevant proposal in the editor.
  - Restrict Followed Activity feed to user-followed sections/proposals.
  - Verify accessibility (keyboard focus on gutters/buttons) against spec expectations.

## Workspace Update — 3-Pane Layout (Spec Only)

> Guardrails: keep the current Active Document rendering and Proposal Editor logic intact; mount them inside the new shell without refactors. Existing multi-user tests, fixtures, and component contracts must remain untouched.

### Layout overview
- **Three panes**: Left = Active Document, Middle = Candidate Pool (top) + Waiting Queue (bottom), Right = Proposal Editor.
- **Resizing**: draggable gutters with persisted widths. Header controls provide Max Doc / Max Candidates / Max Editor states; persistence mirrors existing storage patterns.
- **Focus flow**: selecting a section in the left pane sets the “focused section,” which drives the middle and right panes.
- **Theme compliance**: reuse current light/dark palette tokens and spacing rhythm.

### Left pane — Active Document
- Displays all sections with inline numbering as today, plus a status chip per section:
  - `🗳 Voting` indicates an active candidate pool.
  - `• Idle` when no active proposals are in the pool.
- Clicking a section row focuses it (updates middle + right panes) and retains current hover/edit affordances.
- Inline "Add section below" controls allow inserting new top-level proposals directly between existing sections.

### Middle pane — Section focus
- Split vertically:
  1. **Candidate Pool** (limited list, includes “Keep as-is”).
     - Card fields: ID/title, author, base version, countdown timer (`hh:mm:ss` or `mm:ss`), score, threshold (e.g., `12/18 needed`).
     - Actions: Upvote, Downvote, Diff, Maximize.
     - Optional bundle badge for multi-section proposals.
     - Block flagged proposals from appearing in the pool (flags must be cleared first).
     - Keep-as-is cards show current support percentage instead of author.
     - New top-level proposals (`section_id = "__root__"`) skip the Keep-as-is card.
  2. **Waiting Queue** (strict FIFO overflow).
     - Rows show queue position, Downvote-only control with visible tally, and any `⚑` flags (e.g., “Inconsistency flagged”).
     - Display auto-removal notices when a rule (e.g., `Will auto-remove at −N`) applies.
- Queue downvotes are the only negative action; authors limited to one active proposal per section.
- Empty states:
  - Pool: “No candidates yet. Keep current text or add a proposal.”
  - Queue: “Queue is empty for this section.”

### Right pane — Proposal Editor
- Mount the existing editor unchanged, scoped to the focused section.
- Actions preserved: Submit to queue (targets the focused section), Save draft.
- Include compact live-checks chip if existing data already exposes validation/flags.
- For new top-level proposals, surface an "After section" indicator with Move Up/Move Down controls to preview and adjust placement.

### Interactions & persistence
- Upvote/Downvote wiring mirrors current multi-user voting behavior (pool supports both; queue supports Downvote only).
- Timers tick down client-side; when zero, show “decision due” state (no merge automation required in this pass).
- Pane width and maximize state persist across reloads via existing storage mechanisms.
- Per-proposal “Maximize” expands the middle-pane content in addition to header controls.
- Keyboard accessibility: gutters, buttons, and key actions must be reachable; add ARIA labels where necessary; avoid large-motion transitions.

### Acceptance criteria (Workspace)
1. Middle pane shows Candidate Pool above Waiting Queue for the focused section.
2. Left-pane chips correctly render `🗳 Voting` vs `• Idle` based on candidate pool activity.
3. Pool cards expose Upvote/Downvote, Timer, Score, Needed, Diff, Maximize, and Keep-as-is support percentage.
4. Queue items display position, Downvote-only control, and any flags.
5. Proposal Editor submits to the focused section’s queue without regressions.
6. Pane resizing/maximize controls work and persist state across reloads.
7. Keyboard and ARIA affordances meet the existing accessibility bar.
8. All pre-existing multi-user tests execute unchanged and pass.

### Delivery phases (no tech prescription)
1. **Phase 1 — Layout & Wiring**: implement 3-pane shell + gutter persistence; mount existing Active Document/Proposal Editor; stub middle-pane content.
2. **Phase 2 — Middle Column Behavior**: flesh out Candidate Pool + Waiting Queue interactions, timers, voting, placeholders.
3. **Phase 3 — States & A11y**: add status chips, flags, empty states, keyboard handling.
4. **Phase 4 — My Updates**: build `/updates` page (see below) with deep-links.
5. **Phase 5 — Polish**: align visuals, copy, tooltips, subtle animations with current tokens.
6. **Phase 6 — Data Hook-up**: replace stubs with live data while keeping component contracts stable.

## My Updates Page (`/updates`) — Spec Only

### Purpose
Provide a personal hub surfacing:
1. Open votings the user may want to act on.
2. The user’s proposals that need attention (flags, refresh, expiring, stale).
3. Recent activity for followed sections/proposals.

### Content blocks
- **Open votings**
  - Card shows section title (with project), `⏳` closes-in timer, leading candidate title.
  - Actions: Vote now, Diff (deep-link into Workspace with focused section).
- **Your proposals — action needed**
  - Chips: `⚑` flagged, `🔄` needs refresh, `⌛` expiring, `🛌` stale.
  - Actions: Fix & resubmit / Open editor (deep-link to Workspace with proposal preselected; mock data acceptable until live wiring).
- **Followed items — recent activity**
  - Feed entries such as “#121 reached 60% support”, “#123 demoted to queue”, “v41 merged #120”.
  - Each entry deep-links to Workspace with accurate pane focus.

### Filters & persistence
- Provide project multi-select, section search, and state chips (Open votings / Needs action / Activity).
- Persist last-selected filters across sessions.
- Sensible empty states per block when no items match filters.

### Acceptance criteria (Updates page)
1. `/updates` renders the three blocks with proper empty states when applicable.
2. “Vote now” links focus the correct section in the Workspace.
3. “Fix & resubmit” opens the Proposal Editor with the relevant item preloaded (mock acceptable).
4. Filter selections persist and drive block content.
5. Existing multi-user tests remain untouched and passing.
