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
- `src-tauri/src/lib.rs`: Tauri commands and `gh` command execution.

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

## Build/Run Policy
- NEVER build the app yourself.
- Do not run build commands like:
  - `bun run build`
  - `cargo build`
  - `tauri build`
- Only run build/check commands if the user explicitly asks for them in the current session.
