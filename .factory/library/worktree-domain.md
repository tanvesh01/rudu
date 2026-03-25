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

## Restart semantics

- Reconcile persisted worktree/session state against current git worktree state on startup.
- Missing worktrees become degraded recovered state and are not silently recreated.
- Restart must not resurrect deleted work from stale persisted session history.
- Interrupted sessions must become explicit recovered non-active state after restart.
