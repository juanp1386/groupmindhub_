# COPILOT_PROMPT.md — Ready prompts

**Persist state to localStorage**
Read `AI_CONTEXT.md` and `prototype.html`. Implement `loadState()` (on boot) and `saveState()` after publish/vote/merge. Add a “Reset demo” button that clears storage. Do not change merge threshold logic or introduce recursion.

**Extract logic to modules**
Move pure logic into modules: `applyOps.js`, `diff.js`, `rules.js`. Import via `<script type="module">`. Keep existing behavior and in‑page tests green.

**Add minimal backend stub (optional)**
Scaffold Express routes per SPEC.md with in‑memory storage and Server‑Sent Events for merge notifications. Client must still work if server is absent.
