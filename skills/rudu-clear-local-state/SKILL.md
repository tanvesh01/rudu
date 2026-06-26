---
name: rudu-clear-local-state
description: Clear this repo's local Rudu Tauri app state for first-run and onboarding verification. Use when the user asks to reset, clear, wipe, or empty the local Rudu database, saved repos, tracked pull requests, review sessions, chat state, or onboarding completion flag for the app identifier com.tanvesh.rudu.
---

# Rudu Clear Local State

## Workflow

Use this skill only for the local Rudu app in this repository. The reset is intended for development and onboarding checks, not for preserving review history.

1. Run a dry run first:

```bash
skills/rudu-clear-local-state/scripts/clear-local-state.sh --dry-run
```

2. If the target paths and counts look correct, clear state:

```bash
skills/rudu-clear-local-state/scripts/clear-local-state.sh
```

3. Tell the user to restart or reload the Tauri window if `target/debug/rudu`, `tauri dev`, or Vite is already running. The running webview can keep React Query and localStorage values in memory after the disk state has been cleared.

## What The Script Clears

- SQLite app cache at `~/Library/Application Support/com.tanvesh.rudu/cache.sqlite`
- Saved repositories, tracked PRs, cached PR lists, patch/file caches, review sessions, review chat messages, timeline events, and active chat turns
- The WebKit localStorage key `rudu-onboarding-complete` under both `~/Library/WebKit/com.tanvesh.rudu` and `~/Library/WebKit/rudu`

## Guardrails

- Do not delete the whole app data directory; it may contain review workspaces and other useful files.
- Prefer table-level deletion over removing `cache.sqlite`, so the schema remains available and easy to inspect.
- Do not run build commands or Playwright for this reset.
- If `sqlite3` reports the database is locked, ask the user to quit/restart the running Rudu dev app, then retry.
