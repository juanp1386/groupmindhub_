# GroupMindHub – Product Spec (Current)

## Core principles
- Every published change is immutable; edits become new changes with structured operations.
- Minimum 40 % of the simulated user pool must vote “yes” for auto-merge to fire.
- Sections are the atomic editing unit; headings and paragraph bodies stay in sync with numbering.
- Entry view maintains a document-like reading experience in both light and dark palettes.

## Scope
- Single entry (“Trunk”) per project (seeded on project creation).
- Section composer supports add/remove/reorder/indent/outdent of subsections and body text updates.
- Voting (−1/0/+1) with merge gating at 40 % yes votes across the configured pool (`SIM_USER_POOL_SIZE = 5`).
- Auto-merge promotes passing changes and snapshots history with before/after outlines.
- Project discovery via landing page with activity scores and starring.

## Domain model
- **Project** – name, description, stars, has one canonical entry.
- **Entry** – title, version, votes cache, related blocks/sections/history.
- **Block** – stable id, type (`h2`/`p`), text, parent relationship and ordering.
- **Section** – heading/body grouping for hierarchical structure.
- **Change** – published change with ops JSON, affected blocks, anchors, target section, status (`draft|published|merged|needs_update`).
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

## Entry UI behaviors
- Section headings show numbering inline (e.g., `1.2 Scope`) and expose hover edit buttons.
- Composer inputs stack vertically with labeled heading/body areas and contextual action buttons.
- Entry column is scrollable on desktop; sections split by subtle borders for readability.
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
