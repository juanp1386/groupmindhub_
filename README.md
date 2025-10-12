# GroupMindHub

Collaborative change management for living project specs. The current build ports the original prototype into a Django app with server-backed data, section-aware editing, and real-time style tweaks for both light and dark palettes.

## Highlights
- **Projects & entries** – Each project owns a single “Trunk” entry composed of nested sections backed by `Block`/`Section` rows in the database.
- **Entry view** – Dense, document-like layout that shows inline section numbering, hover-edit affordances, and a palette-aware theme toggle with mode-specific logos/favicons.
- **Change composer** – Draft edits by section, add/reorder subsections, and publish change payloads as structured ops.
- **Voting & auto-merge** – Simulated users can up/down vote. Changes auto-merge once 40 % of the user pool approves; merged items move into history with colored diff blocks.
- **Project stars & activity** – Lightweight starring system and home page activity indicators to surface busy projects.
- **Simulated users** – Quickly impersonate demo users via the header dropdown without real auth friction (still compatible with Django auth).

## Getting Started

### Prerequisites
- Python 3.11+
- Recommended: virtual environment (venv/conda)

### Setup
```bash
python -m venv .venv
source .venv/bin/activate      # Windows: .venv\Scripts\activate
pip install -r requirements.txt
python manage.py migrate
```

### Run the app
```bash
python manage.py runserver
```

Visit http://localhost:8000/ to see the project list. Create a project, add initial sections, then explore the entry view to draft and publish changes.

### Tests
```bash
python manage.py test
```
Key coverage lives in `groupmindhub/apps/core/tests`, including regression tests for section change creation.

## Project Structure
- `groupmindhub/apps/core/` – Data models, merge logic (`logic.py`), and API views powering change workflows.
- `groupmindhub/apps/web/` – Server-rendered views and HTML templates (home, entry view, composer, etc.).
- `static/js/entry_detail.js` – Client-side orchestration for entry rendering, drafting, ops computation, and theme logic.
- `static/img/` – Light/dark logos plus favicons; keep filenames in sync with template references.
- `templates/entry_detail.html` – Entry layout, shared palette variables, and composer markup.
- `AI_CONTEXT.md`, `SPEC.md`, `COPILOT_PROMPT.md` – Companion documentation for agents and contributors.

## Simulated user workflow
1. Open an entry page and choose a demo user from the “Simulate user” dropdown.
2. Hover any section and click *Edit* to load it into the composer.
3. Change headings/bodies, add subsections, or reorder content; the composer shows a diff preview on publish.
4. Publish the change, review the diff card, cast votes, and merge once the threshold is met.

## Theming notes
- Theme toggle state persists in `localStorage` (`gmh_theme`).
- Palette variables are defined in `templates/base.html` and consumed across entry templates.
- Provide both light and dark logo/favicons (`logo-light.png`, `logo-dark.png`, `favicon-light.png`, `favicon-dark.png`).

## Troubleshooting
- **Missing sections?** Ensure the entry has seeded blocks; `project_new` can scaffold headings/bodies from the creation form.
- **Change publish errors?** The backend now allows anchors to refer to blocks inserted earlier in the change payload; see `api_project_changes_create`.
- **Static assets**: If branding updates occur, replace assets in `static/img` and confirm template paths and theme toggle logic still align.
