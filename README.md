# GroupMindHub

Collaborative change management for living project specs.

GroupMindHub is a Django app where each project has a single canonical “Trunk” document composed of nested sections. Contributors publish immutable proposals (structured ops) against a section, the community votes, and passing proposals merge into the trunk with history snapshots.

## Current Feature Set

- **Projects + Trunk entry**: one entry per project, rendered as a document with hierarchical numbering.
- **Section-scoped proposals**: draft edits by section, publish a proposal as ops JSON, preview diffs/outlines before publishing.
- **Voting + merging**: vote `-1/0/+1`; proposals show vote totals and merge state; auto-merge when the project threshold is met.
- **Governance settings**: per-project voting pool size, approval threshold, and voting duration.
- **Access control**: Django auth (signup/login/logout) plus project memberships (Owner/Editor/Viewer).
- **Private projects + invites**: projects can be public/private; invite links grant access with a role.
- **Comments**: comment on a section or a proposal (with delete permissions for authors and editors+).
- **Updates hub**: `/updates` surfaces open votings, your proposals, and recent activity with deep links.
- **Theming**: light/dark theme toggle persisted in `localStorage` (`gmh_theme`) with matching logos/favicons.
- **Simulated users (demo mode)**: the UI can impersonate demo users for multi-user voting flows while staying compatible with real auth.

## Tech Stack

- Backend: Django 5 + SQLite by default (Postgres supported via `DATABASE_URL`).
- Frontend: server-rendered templates + vanilla JS for the entry/workspace interactions.
- E2E: Playwright (`npm run test:e2e`).

## Getting Started

### Prerequisites

- Python 3.11+
- Node.js (for Playwright tests)

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

Visit `http://localhost:8000/`.

### Environment variables

- `DJANGO_DEBUG` (default `1`)
- `DJANGO_SECRET_KEY` (default is a dev-only value)
- `DJANGO_ALLOWED_HOSTS` (default `*`)
- `DATABASE_URL` (optional; defaults to local SQLite)

## Tests

### Django unit tests

```bash
python manage.py test
```

### Playwright E2E

Install Playwright browsers once:

```bash
npm install
npx playwright install
```

Run the suite (starts a Django dev server automatically via `playwright.config.js`):

```bash
npm run test:e2e
```

Notes:
- Set `BASE_URL` to override the default base URL (defaults to `http://127.0.0.1:8000`).
- The Playwright fixture logs in via `/login/`. If you want deterministic creds, set `E2E_USER` / `E2E_PASS`.

## Deployment (Heroku)

This repo includes Heroku-ready config:

- `Procfile` runs `gunicorn groupmindhub.wsgi:application` and runs migrations in `release`.
- `runtime.txt` pins Python.

If you deploy via Heroku Git, ensure you have a `heroku` git remote and push `main`. If you deploy via GitHub integration, pushing to `origin/main` is sufficient.

## Documentation

- `SPEC.md` – product spec (current behavior + clearly marked spec-only sections).
- `AI_CONTEXT.md` – code-map and extension notes for contributors/agents.
- `docs/local_testing_plan.md` – local smoke tests + mapping to the existing Playwright suite.
