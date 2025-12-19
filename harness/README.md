# Agent Harness (Local)

This repo includes a lightweight “harness” inspired by long-running agent harness patterns:

- Break work into **checkpoints**.
- Run **tests/commands** at each checkpoint.
- Optionally capture **Playwright screenshots** for human review.
- Periodically **prompt the user for feedback/approval** before continuing.

It’s designed to be simple and local-first (no extra Python dependencies).

## Files

- `harness/agent_harness.py` – harness runner CLI
- `harness/harness.toml` – checkpoint configuration
- `harness/capture_screenshots.mjs` – screenshot capture helper (uses Playwright)
- `.harness/` – generated state + run artifacts (ignored by git)

## Quick start

```bash
python harness/agent_harness.py status
python harness/agent_harness.py run

# Run a single checkpoint
python harness/agent_harness.py run --only backend_tests --interactive false

# Skip already-approved checkpoints
python harness/agent_harness.py run --skip-approved
```

Artifacts are written under `.harness/runs/<timestamp>/`.

## Configuration

Edit `harness/harness.toml`.

Each `[[checkpoints]]` supports:

- `id` / `title`
- `commands` – list of shell commands; harness stops on non-zero exit
- `screenshots` – list of paths like `"/"` or `"/updates/"`
- `prompt` – if true, asks for feedback + approval

## Auth for screenshots

The screenshot helper needs a logged-in session. It will:

1. Try logging in at `/login/`.
2. If login fails because the user doesn’t exist, it will sign up at `/signup/`.

Credentials come from:

- CLI flags: `--username` / `--password`
- or `harness/harness.toml` `[auth]`
- or env vars: `E2E_USER` / `E2E_PASS`

## Typical workflow for “agentic” changes

1. Add/adjust checkpoints in `harness/harness.toml` for the slice of work you want.
2. Run `python harness/agent_harness.py run`.
3. When prompted, review screenshots under the run directory and provide feedback.
4. Iterate until checkpoints are approved.

## Extending the harness

Easy upgrades that fit this repo:

- Add a checkpoint that runs a smaller E2E subset (or a tagged suite).
- Add a checkpoint that captures both light/dark theme screenshots.
- Add a baseline comparison step (Playwright `toHaveScreenshot` snapshots) once UI stabilizes.
