# JSONL Plan: Multi-Project Session Index + PI-Backed History

## Goal

Support session restore across many repositories with minimal complexity and fewer UX bugs.

Key decision:

- PI SDK remains the source of truth for chat history.
- Rudu stores only orchestration metadata in a global JSONL index.

## Why This Plan

Current complexity came from three overlapping sources of truth:

- in-memory lifecycle in `SessionManager`
- local DB metadata
- PI persistent session state

This plan reduces ambiguity:

- live state transitions: `SessionManager`
- chat transcript persistence: PI session files
- cross-project listing and mapping (worktree + PI handle): JSONL index

## Scope

This plan includes:

- global multi-project metadata index
- startup rehydration for current repo
- lazy restore of transcript history from PI on selection
- lazy resume of PI runtime when sending a follow-up
- mapping between session id, project root, worktree path, and PI session file

This plan does not include (v1):

- transcript persistence in Rudu
- log persistence in Rudu
- automatic resuming of in-flight sessions on startup
- global analytics and advanced querying

## Architecture Boundaries

### SessionManager (unchanged core responsibility)

- Source of truth for live lifecycle state
- Queueing, running, cancellation, terminal transitions
- In-memory logs and transcript cache for the active UI process

### PiSessionRunner

- Create/open PI sessions
- Load historical chat messages from PI session file
- Stream new PI events into transcript updates

### SessionIndexRepository (new lightweight layer)

- Append and read metadata records from JSONL
- No business rules beyond persistence/retrieval

### UI / `useSessionStore`

- Mirrors `SessionManager` events
- Triggers history hydration on session selection
- Triggers follow-up send (which resumes runtime if needed)

## Storage Layout

Use a global per-user directory (not per repo):

- macOS/Linux default: `~/.rudu/`
- index file: `~/.rudu/sessions.jsonl`
- optional temp/lock files: `~/.rudu/sessions.lock`, `~/.rudu/sessions.compact.tmp`

Rationale:

- one global view across all repos
- works when opening Rudu separately in each repo

## JSONL Record Model

Use append-only full snapshots per write event.

Each line is one JSON object:

```json
{
  "schemaVersion": 1,
  "sessionId": "uuid",
  "projectRoot": "/abs/path/to/repo",
  "title": "New session",
  "runtimeType": "pi-sdk",
  "status": "running",
  "queuedAt": 1710000000000,
  "startedAt": 1710000001000,
  "finishedAt": null,
  "updatedAt": 1710000002000,
  "originalCwd": "/abs/path/to/repo",
  "effectiveCwd": "/abs/path/to/repo/.rudu/worktrees/<sessionId>",
  "worktreePath": "/abs/path/to/repo/.rudu/worktrees/<sessionId>",
  "piSessionId": "uuid",
  "piSessionFile": "/Users/me/.pi/agent/sessions/...jsonl",
  "canResume": true,
  "recovered": false,
  "lastError": null
}
```

Notes:

- `status` remains the last known app status, not guaranteed live runtime state.
- No transcript/log payloads in index.

## Read Semantics

On load:

1. parse lines in order
2. keep only the latest record per `sessionId` (highest `updatedAt`; tie-breaker: last line wins)
3. filter by `projectRoot` for current repo view

## Write Semantics

Write one full snapshot line at each important lifecycle point:

- queued
- starting
- running
- cancel requested
- terminal transition
- worktree created/updated
- PI session file/id discovered
- resume validation update (`canResume`, `lastError`)

Avoid in-place rewrite on normal updates.

## Startup Rehydration Rules

At app startup:

1. detect `projectRoot` from current cwd (git repo root if available)
2. load and fold JSONL snapshots
3. keep only sessions belonging to current `projectRoot`
4. materialize into `SessionManager` as historical sessions
5. for non-terminal saved states (`queued`, `starting`, `running`, `cancelling`): set `status = failed` with `lastError = "Session interrupted by app restart"` and `recovered = true`
6. recompute `canResume` by checking `piSessionFile` existence

Design choice:

- never auto-resume runtime on startup
- resume only on user action (select/send)

## Restore UX Flow

### On select session

- if PI session is resumable and transcript cache empty:
  - load PI history from `piSessionFile`
  - append transcript messages to in-memory buffer
  - emit transcript update events

### On send follow-up

- if runtime is not active but `canResume` is true:
  - open PI session from `piSessionFile`
  - subscribe to events
  - send prompt

This keeps UX predictable:

- selecting shows old chat
- sending resumes interaction

## Worktree Mapping Strategy

Per session, persist:

- `projectRoot`
- `worktreePath`
- `effectiveCwd`

Recommended path:

- `<projectRoot>/.rudu/worktrees/<sessionId>`

On restore:

- if worktree missing: keep session, set `lastError`, mark recovered
- do not delete or recreate automatically in v1

## Concurrency and Integrity

Because multiple Rudu instances may run across repos:

- prefer atomic append writes (`open` with append mode, single write per line)
- avoid frequent full-file rewrites
- add optional best-effort lock file for compaction operations only

Corruption handling:

- skip malformed lines
- log warning
- continue loading remaining lines

## Compaction (Optional, Deferred)

When file grows large, run explicit compaction:

1. load/fold latest snapshots
2. write compacted file to temp path
3. atomic rename replace

Do this as a manual command first (not automatic background behavior).

## Implementation Plan

## Phase 1: Add JSONL repository

- create `src/services/persistence/SessionIndexRepository.ts`
- methods:
  - `listAll(): PersistedSession[]`
  - `listByProjectRoot(projectRoot: string): PersistedSession[]`
  - `upsert(snapshot: PersistedSession): void`
- create `src/services/persistence/jsonl.ts` helpers for parse/append/fold

Success criteria:

- metadata writes and reads work from global path

## Phase 2: Replace DB path in App bootstrap

- remove SQLite bootstrap from `src/app/App.tsx`
- initialize `SessionManager` with JSONL repository
- keep test environment using in-memory/no-op repository where suitable

Success criteria:

- app starts with no DB dependency

## Phase 3: SessionManager integration

- keep existing persistence calls but route them to JSONL repository
- keep rehydration behavior, but source from JSONL
- enforce interrupted-on-startup rule for non-terminal historical entries

Success criteria:

- previous sessions appear after restart
- status reconciliation is deterministic

## Phase 4: Restore UX hardening

- keep lazy transcript hydration on selection
- ensure send-follow-up resumes runtime if inactive and resumable
- surface clear errors for missing PI session file

Success criteria:

- selecting restored session shows history when PI file exists
- sending to restored session yields assistant response

## Phase 5: Worktree mapping stabilization

- persist `worktreePath` consistently
- validate presence on restore and show state clearly

Success criteria:

- session-to-worktree mapping survives app restarts

## Testing Plan

### Unit tests: JSONL repository

- append and read snapshots
- fold latest snapshot per session id
- filter by project root
- tolerate malformed lines

### SessionManager tests

- persistence writes at lifecycle transitions
- startup reconciliation marks non-terminal as interrupted/failed
- `canResume` recomputed from `piSessionFile` presence

### App-level tests

- restored sessions appear in list for current project
- selecting restored session triggers history hydration

### Manual smoke tests

1. start session in repo A, chat, quit
2. restart in repo A, select session, verify history appears
3. send follow-up, verify assistant responds
4. open repo B, verify only repo B sessions appear

## Migration Plan (from current SQLite work)

If SQLite data exists:

- add one migration script to export latest session rows into JSONL snapshots
- then stop writing SQLite
- keep SQLite files untouched for one release, then remove code paths

## Open Questions

- Should global index path be configurable via env var (`RUDU_HOME`) in v1?
- Should interrupted sessions use explicit `interrupted` status later?
- When should compaction run (manual only vs threshold-based)?

## Recommended Defaults

- global index at `~/.rudu/sessions.jsonl`
- append-only full-snapshot lines
- lazy history hydration on select
- lazy runtime resume on send
- non-terminal on startup -> recovered failed/interrupted state
- no transcript/log storage in Rudu

This keeps multi-project support while minimizing state duplication and restore complexity.
