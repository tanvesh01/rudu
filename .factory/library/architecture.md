# Architecture

Architectural decisions and patterns for the worktree-first Rudu mission.

**What belongs here:** Layer boundaries, naming rules, state-model guidance, and future-proofing decisions.  
**What does NOT belong here:** Command manifests or port assignments.

---

## Core separation

- Keep repo/worktree lifecycle logic in a dedicated worktree/git layer.
- Keep session runtime lifecycle, queueing, cancellation, logs, and transcripts in `SessionManager`.
- Keep React synchronization/selection derivation in store/hooks.
- Keep OpenTUI components presentational; they should render state and emit UI events, not own git or subprocess orchestration.

## Worktree-first data model

- Worktree is a first-class durable entity.
- Sessions must reference worktrees by durable `worktreeId`.
- Do not rely on path-only linkage as the primary association.
- The model must remain future-ready for many sessions per worktree.
- Legacy sessions without `worktreeId` are ignored by the new UI instead of being migrated.

## Repo context rules

- Resolve canonical repo identity explicitly; do not treat `process.cwd()` as the repo identity.
- Support launch from repo root, nested repo directories, and linked sibling worktrees for the same repository.
- Treat unsupported non-repo launch as a blocked state.
- Resolve default branch intentionally from git metadata; do not silently fall back to the current checkout branch unless that behavior is explicitly encoded and tested.

## Naming and filesystem rules

- Rudu-managed worktrees live in sibling directories beside the canonical repo root.
- Use deterministic Rudu-managed naming with collision handling for both branch names and worktree paths.
- Keep previewed branch/path logic consistent with the actual creation logic.
- Never create nested worktrees inside the repo.
- Never delete or mutate unrelated non-Rudu worktrees or branches.

## UI and selection rules

- The primary navigation surface is a single combined tree of worktrees and sessions.
- The active detail pane is derived from the selected node.
- Worktree nodes must not advertise or enable session-only chat interactions.
- If selection becomes invalid after filtering, delete/archive, or restart recovery, repair selection to a valid remaining node or safe empty/recovery state.

## Recovery rules

- Restart reconciliation must compare persisted state with current git worktree state.
- Missing worktrees are surfaced as degraded recovered state; they are never silently recreated.
- Interrupted sessions must rehydrate into explicit recovered non-active state, not appear to still be running.
