# GroupMindHub – MVP Specification v0.3 (Concise)

**Principles:** democratic auto‑merge at 40%; patches (ops) not live edits; block‑level conflict detection; immutable publish; transparent history.

**Scope (MVP):** one project, one entry; ops: UPDATE_TEXT/INSERT_BLOCK/DELETE_BLOCK/MOVE_BLOCK; votes −1/0/+1; auto‑merge ≥40%; overlap detection; history with outlines; UI matches prototype.

**Data:** User, Project, Entry, Block, Patch, Vote. Blocks: `h2`/`p` with stable IDs.

**API sketch:**
- GET /projects/:id/entry
- POST /projects/:id/patches
- GET /projects/:id/patches
- POST /patches/:id/votes
- POST /patches/:id/merge

**Merge:** apply ops → bump version → patch.status=merged → overlaps → needs_update → history snapshot.

**Acceptance (mirrors in‑page tests):**
1) ≥40% yes auto‑merges; entry.version++.
2) Overlapping non‑merged → `needs_update` after a merge.
3) Outline diff marks +/‑/~ /↔ correctly.
4) Votes toggle and approval % updates.
