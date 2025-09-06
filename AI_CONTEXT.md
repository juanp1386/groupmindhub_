# AI_CONTEXT.md — GroupMindHub (Prototype‑Driven MVP)

Keep this open in VS Code for Copilot.

- Auto‑merge threshold: **40%** of total users.
- Patch ops: `UPDATE_TEXT`, `INSERT_BLOCK`, `DELETE_BLOCK`, `MOVE_BLOCK`.
- No admin merges in MVP; merges are democratic + automatic.
- Merged patches leave Proposed and appear only in History.
- Avoid render↔merge recursion: `renderPatches()` may call `autoMergeTick()` which **must not** re‑enter `renderPatches()`.

Key state (in `prototype.html`):
- `users`, `currentUserId`
- `entry` (blocks with stable IDs)
- `patches` (published/merged/needs_update)
- `draft` (staged ops)

Core functions:
- `applyOps(blocks, ops)` — pure transform; used for preview + merge.
- `outlineDiff(before, after)` — +/‑/~ /↔ outlines.
- `recomputeOverlaps()` — sets `overlaps` and `competing`.
- `isPassing(p)` — approval check.
- `applyMergeCore(p)` — mutates entry, marks overlaps `needs_update`, stamps merged meta.
- `autoMergeTick()` — merges all passing patches (no recursion).
- `renderEntry()`, `renderComposer()`, `renderPatches()` — DOM writers.
- Composer helpers including `removeOp(seq)`.

Extension seams:
- `localStorage` persistence (entry, patches, users).
- Minimal backend stubs (Express/FastAPI) matching SPEC.md.
- Extra block types (`code`, `ul/li`, `img`) and corresponding UI.
