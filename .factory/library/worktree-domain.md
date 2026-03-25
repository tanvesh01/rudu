# Worktree Domain

Mission-specific notes for worktree lifecycle, persistence, and recovery.

**What belongs here:** Worktree-specific domain invariants, persistence expectations, and lifecycle semantics.  
**What does NOT belong here:** UI copy or command manifest details.

---

## Domain invariants

- Every visible session in the new UI belongs to exactly one known worktree.
- Worktree/session linkage is by durable `worktreeId`.
- Legacy sessions without `worktreeId` are ignored by the worktree-first UI.
- Orphaned linked sessions must not appear as normal active nodes after rehydration.

## Lifecycle semantics

- Archive preserves the underlying worktree directory but removes the worktree from active default navigation.
- Delete removes the underlying git worktree and invalidates or cleans up linked sessions.
- Delete of a worktree with queued/running sessions must block clearly or perform explicit cleanup/cancellation first.
- Cleanup failures must be durable and visible; never mark failed delete as successful removal.

### Archive Implementation

The `archiveWorktree()` function in `GitWorktreeService` handles the archive lifecycle:

1. **Validation:** Only Rudu-managed worktrees in "active" or "creating" status can be archived.
2. **Directory preservation:** The underlying git worktree directory is NOT deleted; it remains on disk.
3. **Status update:** The worktree's status is changed to "archived" and `archivedAt` timestamp is set.
4. **Persistence:** Changes are persisted via `WorktreeRepository.updateWorktree()`.
5. **UI behavior:** The `isActiveWorktreeStatus()` helper filters archived worktrees from the default active navigation view.
6. **Keyboard shortcut:** `Ctrl+A` triggers archive when a worktree node is selected.
7. **Rehydration:** On restart, archived worktrees retain their "archived" status and remain excluded from active navigation.

See also:
- `src/services/worktree/GitWorktreeService.ts` - `archiveWorktree()` function
- `src/domain/worktree.ts` - `isActiveWorktreeStatus()` helper
- `src/app/App.tsx` - `handleArchiveWorktree()` and keyboard binding

### Delete Implementation

The `deleteWorktree()` function in `GitWorktreeService` handles the delete lifecycle:

1. **Validation:** Only Rudu-managed worktrees that are not already "removed" can be deleted.
2. **Session Cleanup:** Before deletion, any queued/running/cancelling sessions are cancelled.
3. **Blocked State:** If active sessions exist, the worktree enters "cleanup_pending" status and returns "blocked" - caller should retry after sessions complete.
4. **Git Removal:** The linked git worktree is removed via `git worktree remove`.
5. **Status Update:** On success, the worktree's status is changed to "removed" and `removedAt` timestamp is set.
6. **Failure Handling:** If deletion fails, the worktree enters "cleanup_failed" status with an error message for recovery.
7. **Persistence:** Changes are persisted via `WorktreeRepository.updateWorktree()`.
8. **Keyboard shortcut:** `Ctrl+D` triggers delete when a worktree node is selected.
9. **Selection Repair:** After deletion, the UI automatically repairs selection to the next valid node using `repairSelection()`.

See also:
- `src/services/worktree/GitWorktreeService.ts` - `deleteWorktree()` function
- `src/app/App.tsx` - `handleDeleteWorktree()` and keyboard binding

## Restart semantics

- Reconcile persisted worktree/session state against current git worktree state on startup.
- Missing worktrees become degraded recovered state and are not silently recreated.
- Restart must not resurrect deleted work from stale persisted session history.
- Interrupted sessions must become explicit recovered non-active state after restart.
