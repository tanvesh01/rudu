# Session Persistence and Per-Session Worktree Plan

## Goal

Make every new coding session run inside its own git worktree, while making session state durable enough to survive app restarts and support future resume/recovery flows.

This plan intentionally introduces persistence first, then layers worktree management on top of it.

## Why Persistence Comes First

Today, `SessionManager` is the runtime source of truth, but it is fully in-memory. If the app exits or crashes, Rudu loses:

- the mapping from app session id to working directory
- the mapping from app session id to worktree path
- the mapping from app session id to PI session identity or resume handle
- the last known lifecycle state and timestamps
- cleanup intent and ownership of any created worktree

If per-session worktrees are added before persistence, the app can create orphaned worktrees that it cannot confidently recover, resume, or clean up later.

## Principles

- `SessionManager` remains the source of truth for lifecycle transitions.
- Persistence stores durable metadata, not live runtime objects.
- The React store continues to mirror `SessionManager`; it should not read or write SQLite directly.
- Worktree creation and cleanup belong to orchestration, not UI components.
- Recovery should be conservative: preserve state when uncertain instead of deleting data.
- The first persistence version should be small, explicit, and easy to evolve.

## Scope

This plan covers:

- durable storage with SQLite backed by Drizzle ORM
- startup rehydration of known sessions
- durable mapping between session id, repo root, worktree path, and PI session metadata
- worktree lifecycle management for new sessions
- recovery and reconciliation on startup

This plan does not require, in v1:

- full log persistence
- full transcript persistence
- guaranteed live reattachment to an already-running subprocess
- complete PI session resumption unless the SDK exposes a stable session handle

## Recommended Stack

- SQLite database file for local durable state
- Bun SQLite driver via `bun:sqlite`
- Drizzle ORM via `drizzle-orm/bun-sqlite`
- Drizzle migrations for schema changes

Why this fits well:

- single-user local app
- simple deployment model
- transactional writes around session/worktree state changes
- strong TypeScript ergonomics
- easy schema evolution as session recovery gets more sophisticated

## Proposed Files and Responsibilities

### New persistence files

- `src/db/schema.ts`
  - Drizzle table definitions
- `src/db/client.ts`
  - SQLite/Drizzle initialization
- `src/db/migrate.ts`
  - optional migration runner entry point
- `src/services/persistence/SessionRepository.ts`
  - read/write durable session metadata
- `src/services/persistence/types.ts`
  - repository-facing persistence types if needed

### New orchestration helpers

- `src/services/worktree/GitWorktreeManager.ts`
  - repo detection, worktree add/remove, status checks, reconciliation helpers
- `src/domain/sessionPersistence.ts`
  - pure mapping helpers between DB rows and runtime/session snapshots if this grows large

### Existing files to update

- `src/services/SessionManager.ts`
  - load persisted sessions on init
  - persist queued/start/running/terminal transitions
  - create and clean up worktrees
  - expose recovered session snapshots
- `src/hooks/useSessionStore.ts`
  - no new business logic, only support any added snapshot fields
- `src/app/App.tsx`
  - continue to create sessions, but stop assuming `process.cwd()` is the final execution cwd
- `package.json`
  - add dependencies and migration scripts

## Data Model

### Table: `sessions`

Primary durable record for one Rudu session.

Suggested columns:

- `id` `text primary key`
- `title` `text not null`
- `prompt` `text`
- `runtime_type` `text not null`
- `status` `text not null`
- `original_cwd` `text`
- `effective_cwd` `text`
- `repo_root` `text`
- `worktree_path` `text`
- `worktree_branch` `text`
- `worktree_head_ref` `text`
- `worktree_status` `text not null default 'none'`
- `cleanup_policy` `text not null default 'preserve_on_failure'`
- `cleanup_status` `text not null default 'none'`
- `pi_session_id` `text`
- `pi_resume_token` `text`
- `can_resume` `integer not null default 0`
- `last_error` `text`
- `queued_at` `integer not null`
- `started_at` `integer`
- `finished_at` `integer`
- `cancel_requested_at` `integer`
- `created_at` `integer not null`
- `updated_at` `integer not null`

Notes:

- `original_cwd` is the repo path the user launched from.
- `effective_cwd` is the actual cwd used to run the session. After worktree creation, this becomes the worktree path.
- `pi_session_id` and `pi_resume_token` depend on what the PI SDK can actually provide.

### Table: `session_metadata` (optional in v1)

Use only if flexible key/value storage becomes necessary. Avoid this initially unless the schema starts changing quickly.

### Table: `session_events` (optional later)

Append-only event log for debugging and auditability. Not required for the first implementation.

## Runtime Snapshot Additions

Add fields to `SessionSnapshot` and internal `SessionRecord` so the UI can display recovery/worktree state without knowing persistence details.

Suggested fields:

- `originalCwd?: string`
- `worktreePath?: string`
- `repoRoot?: string`
- `worktreeStatus?: "none" | "creating" | "ready" | "cleanup_pending" | "cleanup_failed" | "removed" | "preserved"`
- `cleanupStatus?: "none" | "pending" | "succeeded" | "failed" | "skipped"`
- `cleanupPolicy?: "always" | "on_success" | "preserve_on_failure" | "never"`
- `resumeState?: "unknown" | "resumable" | "not_resumable" | "interrupted"`
- `recovered?: boolean`

Do not put database row shapes directly into the UI.

## Startup Flow

### Phase 1 startup behavior

When the app boots:

1. initialize SQLite connection
2. run migrations
3. create `SessionManager` with repository and worktree services
4. load persisted sessions from the repository
5. reconcile each session against the filesystem and git state
6. materialize recovered snapshots into the in-memory store

### Reconciliation rules

For each persisted session:

- if status is terminal, load it as historical state
- if status is `queued`, load it as `queued` only if it is safe to retry; otherwise mark `failed` or `interrupted`
- if status is `starting` or `running`, treat it as interrupted after restart unless there is a reliable resume mechanism
- if `worktree_path` exists on disk, keep it linked to the session
- if `worktree_path` is missing but the session expected one, mark an error and set `worktreeStatus` accordingly
- if PI resume metadata exists and is valid, mark the session resumable; actual resume can be implemented later

Recommended recovered terminal-ish status for previously live sessions:

- either introduce `interrupted`
- or map to `failed` with a structured recovery error

If introducing a new lifecycle status is too disruptive for v1, use `failed` plus metadata like `recovered: true` and `last_error: "Session interrupted by app restart"`.

## Session Creation Flow

### Current flow

`App` calls `queuePiSession(...)` with `cwd: process.cwd()`, and `SessionManager` eventually starts the session in that directory.

### Target flow

1. UI requests a new session with the user prompt and original cwd
2. `SessionManager.queuePiSession()` creates an in-memory record and persists a session row with:
   - `original_cwd`
   - `effective_cwd` equal to `original_cwd` initially
   - `worktree_status = 'none'`
   - `status = 'queued'`
3. when the session transitions to `starting`, `SessionManager` calls `GitWorktreeManager.prepareWorktree(...)`
4. after successful worktree creation:
   - update `effective_cwd`
   - update `worktree_path`
   - update `repo_root`
   - update `worktree_status = 'ready'`
   - persist changes
5. start the PI session inside the worktree path
6. if the PI SDK yields a durable session id or resume token, persist it

## Worktree Strategy

### Recommended worktree path layout

Use a Rudu-owned directory inside the repo git dir or repo-local metadata folder, for example:

- `.rudu/worktrees/<session-id>` relative to repo root, or
- another deterministic path under the project root

Requirements:

- unique per session
- easy to map back to the app session id
- easy to detect as Rudu-managed for cleanup/reconciliation

### Recommended branch strategy

Start with detached worktrees unless branch semantics are required for user workflows.

Options:

- detached HEAD worktrees
  - simplest
  - avoids branch naming collisions
  - enough if the goal is isolated filesystem state
- unique branch per session, such as `rudu/<session-id>`
  - easier to inspect in git tools
  - more cleanup complexity
  - branch collision rules matter

Recommendation for v1: detached HEAD worktree, unless the PI workflow explicitly benefits from branch naming.

### Git operations needed

- resolve repo root from `original_cwd`
- create worktree
- inspect worktree status
- remove worktree
- optionally prune stale worktrees/admin entries

Implementation should use shell commands through Bun subprocesses, wrapped in one small service instead of scattering git commands across `SessionManager`.

## Cleanup Policy

Recommended default policy:

- auto-remove worktrees for `succeeded`
- auto-remove worktrees for clean `cancelled`
- preserve worktrees for `failed`
- preserve dirty worktrees even if the session succeeded or was cancelled

Why this default works:

- keeps disk usage under control for normal successful runs
- preserves debugging context when something went wrong
- avoids deleting user-important uncommitted changes

### Cleanup states

- `none`
- `pending`
- `succeeded`
- `failed`
- `skipped`

### Cleanup decision matrix

- terminal success + clean tree -> remove
- terminal cancelled + clean tree -> remove
- terminal failed -> preserve
- terminal any state + dirty tree -> preserve and mark `skipped`
- cleanup command failure -> preserve and mark `failed`

## PI Resume Strategy

This depends on the PI SDK.

### If the SDK exposes a stable resume handle

Persist:

- PI session id
- resume token or serialized session locator
- last synced timestamp
- resumable flag

Then on startup:

- attempt to rehydrate the PI session
- if successful, mark as resumable or reconnectable
- if not, preserve the worktree and mark the session interrupted/non-resumable

### If the SDK does not expose a stable resume handle

Still persist:

- app session id
- worktree path
- original prompt
- terminal/recovered state

This still gives the user meaningful recovery:

- inspect the worktree
- manually continue from that directory
- create a new session against the preserved worktree later

Recommendation: design the schema now for PI resume metadata even if the first implementation only stores null values.

## Proposed Implementation Phases

## Phase 0: dependency and scaffolding setup

Add:

- `drizzle-orm`
- `drizzle-kit`

Create:

- DB client setup
- Drizzle config
- initial migration

Success criteria:

- local SQLite file is created
- migrations run successfully
- repository tests can use a temp database

## Phase 1: minimal persistence for sessions

Implement:

- `SessionRepository`
- write-through persistence for `queue`, `start`, `cancel`, `success`, `failure`
- loading persisted session history during manager startup

Decisions:

- keep logs/transcripts in memory only
- do not attempt live process reattachment

Success criteria:

- closed app can restart and still show previous sessions
- historical sessions retain prompt/title/status/timestamps/errors

## Phase 2: startup recovery and reconciliation

Implement:

- reconciliation logic for non-terminal sessions after restart
- filesystem checks for expected worktree paths
- recovered session metadata in snapshots

Success criteria:

- previously running sessions are marked as interrupted or failed-with-recovery-context
- missing worktrees are detected and surfaced

## Phase 3: introduce per-session worktrees

Implement:

- `GitWorktreeManager`
- worktree creation during `starting`
- worktree persistence fields
- session execution in `effective_cwd`

Success criteria:

- every newly started session runs inside its own worktree
- session snapshots show the worktree path
- worktree creation failure fails the session cleanly before runtime start

## Phase 4: cleanup and preservation behavior

Implement:

- cleanup policy execution in terminal-state finalization
- dirty-tree detection before removal
- persistence of cleanup outcomes

Success criteria:

- successful clean sessions remove their worktrees automatically
- failed or dirty sessions preserve their worktrees
- cleanup failures are visible in the UI and persisted state

## Phase 5: PI resume integration

Implement only if the SDK supports it cleanly.

Implement:

- storage of PI session identity
- startup validation of resumability
- optional reconnect flow

Success criteria:

- resumed sessions reconnect without losing the worktree mapping
- non-resumable sessions degrade gracefully to preserved historical state

## Testing Plan

### Unit tests: repository layer

Add tests for:

- creating and updating session rows
- loading persisted sessions in order
- handling null/optional fields correctly
- migration compatibility for initial schema

### Unit tests: worktree service

Add tests for:

- repo root detection
- worktree path generation
- create/remove command handling
- dirty-tree detection behavior
- failure parsing and retry behavior where applicable

Mock git commands where possible, and use a temp git repo for a few realistic integration tests.

### SessionManager tests

Add tests for:

- persisting `queued`, `starting`, `running`, `cancelled`, `succeeded`, `failed`
- startup rehydration from persisted state
- marking previously live sessions as interrupted/recovered
- creating worktrees before session runtime starts
- not starting a session if worktree creation fails
- cleanup behavior based on final status and dirty/clean state

### UI tests

Add tests only for visible behavior, such as:

- recovered sessions render correctly
- worktree path or recovery state appears where intended
- cleanup failure/preserved state is visible if shown in the UI

Do not move orchestration rules into component tests.

## Failure Modes to Design For

- app launches outside a git repo
- `git worktree add` fails due to path collision
- branch collision if branch-based worktrees are used
- repo is locked due to concurrent git activity
- worktree path was deleted manually between runs
- SQLite file is unavailable or corrupted
- migration failure on startup
- PI session metadata exists but is no longer valid
- user cancels during worktree creation
- shutdown begins while cleanup is in progress

## Recovery Rules

Prefer preserving state over aggressive cleanup.

Examples:

- if the app crashes after creating a worktree but before starting the session, keep the worktree and mark the session interrupted
- if the DB says a worktree exists but the path is gone, keep the session record and mark the mismatch as an error
- if cleanup fails, never silently delete the record; persist the failure and show the path

## Operational Choices

### Database location

Recommended options:

- repo-local `.rudu/state.sqlite` for project-scoped history, or
- user-global app data directory for all projects

Recommendation for this feature set: start repo-local.

Why:

- session history stays close to the repo it belongs to
- worktree ownership is naturally project-scoped
- easier debugging during development

If multi-repo global history becomes important later, add a higher-level registry then.

### Write model

Use simple synchronous or near-synchronous writes around important lifecycle transitions. This is a local CLI app, so correctness is more important than extreme throughput.

Good persistence moments:

- queue session
- enter starting
- worktree created
- runtime started
- cancel requested
- terminal state reached
- cleanup completed or skipped

## Suggested Public Interfaces

### `SessionRepository`

Suggested methods:

- `listSessions(): PersistedSession[]`
- `getSession(id: string): PersistedSession | undefined`
- `insertSession(input: NewPersistedSession): void`
- `updateSession(id: string, patch: PersistedSessionPatch): void`
- `markRecovered(id: string, patch: RecoveryPatch): void`

### `GitWorktreeManager`

Suggested methods:

- `resolveRepoRoot(cwd: string): Promise<string>`
- `createWorktree(input: { sessionId: string; cwd: string }): Promise<WorktreeInfo>`
- `getWorktreeStatus(path: string): Promise<WorktreeStatus>`
- `removeWorktree(path: string, options?: { force?: boolean }): Promise<void>`
- `pathExists(path: string): Promise<boolean>`

Keep git command text and parsing inside this service.

## Minimal Deliverable

If this needs to be split into the smallest useful release, ship this first:

1. SQLite + Drizzle setup
2. persisted session table
3. session rehydration on startup
4. worktree path fields in schema/snapshots
5. worktree creation for new sessions
6. preserve all worktrees initially, with no auto-cleanup yet

This gives safe recovery and avoids premature destructive behavior.

Then follow with:

7. cleanup policy
8. dirty-tree checks
9. PI resume integration

## Open Questions

- Does the PI SDK expose a stable session id or resume token we can persist?
- Should recovered live sessions get a new explicit `interrupted` status, or should they map to `failed` with metadata?
- Should the database be repo-local or global from day one?
- Should v1 worktrees use detached HEAD or dedicated branches?
- Should successful worktrees be auto-removed immediately, or only on explicit user cleanup until the feature is battle-tested?

## Recommended Answers for Now

- add persistence before worktrees
- use SQLite + Drizzle
- start with a repo-local database
- start with detached HEAD worktrees
- preserve all worktrees in the first implementation if you want the safest rollout, or auto-clean only clean successes once the reconciliation path is solid
- model PI resume fields now even if real resume lands later

## Execution Order Summary

1. add SQLite + Drizzle infrastructure
2. add `SessionRepository` and persist session metadata
3. add startup rehydration and recovery markers
4. add `GitWorktreeManager`
5. run new sessions in dedicated worktrees
6. add cleanup policy and dirty-tree preservation
7. add PI resume integration if supported

This order minimizes orphaned state, keeps architecture boundaries clean, and gives the app a durable foundation before it starts creating more durable resources on disk.
