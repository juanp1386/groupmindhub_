# GroupMindHub – Product Spec (Current)

This document describes the current, shipped behavior in `main`, plus a few clearly-marked “Spec-only” sections that are not fully implemented yet.

## Status legend

- **Current**: implemented in the codebase today.
- **Spec-only**: design/roadmap; treat as acceptance criteria for future work.

## Core principles (Current)

- Every published proposal is immutable; edits become new proposals with structured operations.
- Sections are the atomic editing unit; headings and paragraph bodies stay in sync with numbering.
- The entry/workspace view maintains a document-like reading experience in both light and dark palettes.

## Scope (Current)

- Single entry (“Trunk”) per project (seeded on project creation).
- Project creation supports building an initial outline (nested sections).
- Section composer supports updating text, inserting blocks, deleting blocks, and moving blocks (section-scoped validation).
- Voting (`-1/0/+1`) with merge gating at each project’s configured governance settings.
- Auto-merge promotes passing proposals and snapshots history with before/after outlines.
- Project discovery via landing page with filtering + starring.
- Django authentication (signup/login/logout) plus project access control (memberships, private projects, invites).
- Comments on sections and proposals.
- `/updates` page to surface open votings, your proposals, and recent activity.

## Domain model (Current)

- **Project** – name, description, visibility (`public|private`), governance (`voting_pool_size`, `approval_threshold`, `voting_duration_hours`), has one canonical entry.
- **ProjectMembership** – `(project, user, role)` where role is `owner|editor|viewer`.
- **ProjectInvite** – signed token invites that grant access to a project with a specific role.
- **Entry** – title, version (`entry_version_int`), votes cache, related blocks/sections/history.
- **Block** – stable id, type (`h2|p`), text, parent relationship and ordering.
- **Section** – hierarchical grouping of heading/body for section-scoped editing.
- **Change** – published proposal with `ops_json`, `anchors`, `affected_blocks`, `summary`, `target_section_id`, `base_entry_version_int`, status (`draft|published|merged|needs_update`), voting window (`closes_at`).
  - **Planned** (not fully implemented): `flags`, `bundle_key`, and queue/pool mechanics beyond the current per-section proposal list.
- **Vote** – user vote on a change (`-1/0/+1`).
- **EntryHistory** – snapshots before/after outlines when proposals merge.
- **Comment** – user-authored comments attached to a section or a change.
- **ProjectStar** – user-to-project star relation.

## APIs (Current)

All endpoints live under `/api/` and expect/return JSON.

| Method | Route | Purpose |
| ------ | ----- | ------- |
| GET | `/api/projects/<id>/entry` | Latest serialized entry (blocks + sections tree + governance snapshot) |
| GET | `/api/projects/<id>/changes` | List proposals with vote aggregates and computed merge state |
| POST | `/api/projects/<id>/changes/create` | Publish a proposal with ops/anchors/summary and section scope |
| POST | `/api/changes/<id>/votes` | Cast/toggle a vote (`value = -1,0,1`) |
| POST | `/api/changes/<id>/merge` | Manually merge (guarded by `is_passing`) |
| POST | `/api/projects/<id>/star-toggle` | Toggle project star for the current user |
| GET/POST | `/api/projects/<id>/comments` | List comments / create a comment on a section or change |
| POST | `/api/projects/<id>/comments/<comment_id>` | Delete a comment (author or editor+) |

### Access control (Current)

- Read access to public projects is allowed for safe methods.
- Private projects require membership or a valid invite.
- Mutating endpoints require authentication and appropriate membership (typically editor+).

### Change payload (Current)

Example payload to publish a proposal scoped to an existing section:

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

Notes:
- `section_id` is interpreted as a section heading block id; the backend normalizes missing `h_` prefixes.
- Validation ensures anchors and parent relationships stay within the targeted section tree, while allowing references to blocks inserted earlier in the same payload.

To propose a brand-new top-level section, send `section_id: "__root__"`.

### Change serialization (Current)

`GET /api/projects/<id>/changes` returns vote aggregates and merge state, including:

- `yes`, `no`, `current_user_vote`
- `required_yes_votes`, `is_passing`
- `base_entry_version_int`, `closes_at`
- `target_section_id` plus resolved `target_section_heading/numbering/depth` when applicable
- `project_governance` snapshot

## Entry/workspace UI behaviors (Current)

- Entry sections show numbering inline (e.g., `1.2 Scope`) with editing controls surfaced contextually.
- Composer inputs stack vertically with labeled heading/body areas and publish/preview affordances.
- Change cards render GitHub-style before/after summaries with colored markers for additions/removals/moves.
- Theme toggle persists in `localStorage` and swaps logos/favicons to match mode.

## Auto-merge rules (Current)

1. Each vote recalculates yes/no tallies and determines `is_passing`.
2. Auto-merge runs after publish/vote and promotes any proposal meeting the project threshold.
3. Merge increments entry version, records history, and keeps the proposal visible in the history list.

## Acceptance criteria (Current)

1. Drafting a subsection with new heading + body publishes successfully (covered by regression tests).
2. Theme toggle updates palette variables, logos, and favicon paths for both modes.
3. Publishing without modifications is blocked; composer surfaces “No changes to publish.”
4. Voting updates score and merge state without reload; merged proposals move into history.

## Updates Page (`/updates`) (Current)

- Shows open votings (published proposals) with timers and deep links into the entry view.
- Shows “Your proposals” for the signed-in user with status chips.
- Shows a simple “recent activity” feed driven by merges and recent comments.

## Workspace Update — 3-Pane Layout (Spec-only)

> Guardrails: keep the current Active Document rendering and Proposal Editor logic intact; mount them inside the new shell without refactors. Existing multi-user tests, fixtures, and component contracts must remain untouched.

### Layout overview

- **Three panes**: Left = Active Document, Middle = Candidate Pool (top) + Waiting Queue (bottom), Right = Proposal Editor.
- **Resizing**: draggable gutters with persisted widths. Header controls provide Max Doc / Max Candidates / Max Editor states; persistence mirrors existing storage patterns.
- **Focus flow**: selecting a section in the left pane sets the “focused section,” which drives the middle and right panes.
- **Theme compliance**: reuse current light/dark palette tokens and spacing rhythm.

### Left pane — Active Document

- Displays all sections with inline numbering, plus a status chip per section.
- Clicking a section focuses it (updates middle + right panes) and retains current hover/edit affordances.
- Inline “Add section below” controls allow inserting new top-level proposals directly between existing sections.

### Middle pane — Section focus

- Split vertically:
  1. **Candidate Pool** (limited list, includes “Keep as-is”).
  2. **Waiting Queue** (FIFO overflow).
- Pool cards expose vote controls, a countdown timer, and a “Diff” action.
- Queue items are downvote-only.

### Right pane — Proposal Editor

- Mount the existing editor, scoped to the focused section.
- Preserve actions: submit proposal, save draft.

### Acceptance criteria (Workspace)

1. Middle pane shows Candidate Pool above Waiting Queue for the focused section.
2. Left pane chips render `🗳 Voting` vs `• Idle` based on focused section activity.
3. Pool cards expose Upvote/Downvote, Timer, Score/Needed, Diff, and Maximize.
4. Queue items display position and Downvote-only control.
5. Pane resizing/maximize controls persist across reloads.

## Future extensions

- Real authentication replacing simulated user workflows entirely.
- Concurrent editing conflict resolution (`overlaps` detection + refresh flow).
- Notifications (SSE/WebSocket) for new proposals and merge events.
- Richer block types (lists, code blocks) in composer and diff previews.
