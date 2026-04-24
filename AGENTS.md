# AGENTS.md

## Purpose
This project is a local Tauri app for browsing GitHub PRs and rendering diffs with Pierre components.

## Stack
- Frontend: React + TypeScript + Vite + Tailwind
- Desktop shell: Tauri (Rust backend in `src-tauri`)
- Data source: GitHub CLI (`gh`) invoked from Rust commands
- JavaScript package manager/runtime: Bun

## Important Structure
- `src/App.tsx`: top-level state and orchestration for repo/PR selection.
- `src/components/ui/repo-sidebar.tsx`: repo + PR list/selection.
- `src/components/ui/patch-viewer-main.tsx`: main patch area, tree/diff layout, tree hide/show UX.
- `src/components/ui/changed-files-tree.tsx`: changed-files tree panel.
- `src-tauri/src/lib.rs`: Tauri bootstrap, command registration, and top-level wiring.
- `src-tauri/src/models/`: Rust app DTOs and GitHub wire/query structs.
- `src-tauri/src/github/`: `gh` transport helpers and GitHub-focused utility functions.
- `src-tauri/src/support/`: shared Rust helpers (`parse_repo`, small conversions/time helpers).

## Current UX Behavior (keep consistent)
- App shell is fixed to viewport height (`h-screen`) with internal scrolling only.
- Main content has a single shared container for file tree + diff content.
- File tree takes roughly 1/3 width when visible.
- File tree can be hidden; hidden state uses Base UI Popover to access the tree.

## Backend Contract
- `list_pull_requests(repo)` returns PR summaries.
- `get_pull_request_patch(repo, number)` returns patch text for rendering.
- `list_pull_request_changed_files(repo, number)` returns changed file paths (via `gh pr diff --name-only`).

## Dependency Notes
- Use `@pierre/trees@0.0.1-beta.4`.
- Do not switch to a floating/latest tag without checking installability; newer metadata can fail in this repo setup.

## Working Rules For Agents
- Keep UI changes aligned with existing Tailwind design tokens (`bg-canvas`, `bg-surface`, etc.).
- Prefer small focused components over growing `App.tsx`.
- Keep tree and diff states decoupled: one may fail while the other still renders.
- Use Bun everywhere for JS tasks (`bun install`, `bun add`, `bun run ...`); do not use npm.

## Rust Backend Architecture
- `src-tauri/src/lib.rs`: app bootstrap only (plugins, `invoke_handler`, setup wiring).
- `src-tauri/src/commands/`: Tauri command entrypoints only.
  - `repos.rs`: list_initial_repos, search_repos, validate_repo, list_saved_repos, save_repo
  - `pull_requests.rs`: list_cached_pull_requests, list_pull_requests, get_pull_request_patch, list_pull_request_changed_files
  - `review_comments.rs`: create_pull_request_review_comment, reply_to_pull_request_review_comment, update_pull_request_review_comment, get_pull_request_review_threads, get_viewer_login
- `src-tauri/src/github/`: `run_gh`, `run_gh_graphql`, `ensure_user_context`, `get_viewer_login_sync`, `get_pull_request_node_id_sync`
- `src-tauri/src/cache/`: SQLite init, read/write for repos, PRs, patches, changed files
- `src-tauri/src/models/`: app-facing DTOs (`PullRequestSummary`, `RepoSummary`, `ReviewThread`, …) + GitHub wire structs (`GhPullRequest`, `GraphQlReviewThread`, …)
- `src-tauri/src/support/`: `parse_repo`, `now_unix_timestamp`, `bool_to_sql`, `sql_to_bool`

### Module Boundary Rules
- Commands call services/helpers; commands should not contain SQL or large GraphQL strings.
- Cache module should not depend on Tauri command macros.
- GitHub module should own `run_gh` / `run_gh_graphql` and API payload parsing.
- Keep frontend command names stable when refactoring (do not break `invoke("...")` contracts).
- Prefer domain modules over generic `utils.rs` growth.

## Build/Run Policy
- NEVER build the app yourself.
- Do not run build commands like:
  - `bun run build`
  - `cargo build`
  - `tauri build`
- Only run build/check commands if the user explicitly asks for them in the current session.
