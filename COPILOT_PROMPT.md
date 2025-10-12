# COPILOT_PROMPT.md — Ready prompts

Use these as starting points when pairing with Copilot or another agent.

**Persist theme choice per user**  
Update `themeToggle` logic in `static/js/entry_detail.js` to hit a new `/api/preferences/theme` endpoint. Store the value server-side (e.g., `UserProfile.theme`) and fall back to localStorage only when logged out. Sync app-wide templates so the initial `data-theme` matches the server value.

**Section-level commenting**  
Introduce inline comments for entry sections. Extend `Change` or add a new `Comment` model, expose `/api/sections/<id>/comments`, and surface comments beneath each section in `templates/entry_detail.html`. Ensure new comments respect simulated users and add tests covering basic CRUD.

**Diff coverage for deletes/moves**  
Augment `ChangeApiTests` to cover DELETE and MOVE ops. Simulate publishing a change that removes a subsection and reorders siblings, then assert outlines reflect the mutations and the API validation still accepts anchors. Update diff rendering (if needed) to highlight moved blocks more clearly.
