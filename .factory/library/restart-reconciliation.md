# Restart Reconciliation

Documentation for restart recovery and reconciliation behavior in Rudu.

## Overview

When Rudu restarts, it performs reconciliation between persisted state and actual git worktree state to ensure the UI reflects only valid, current worktrees and sessions.

## Worktree Reconciliation

### Missing Worktrees

On restart, Rudu compares each persisted worktree against `git worktree list`:

- If the worktree path no longer exists → marked as `cleanup_failed`
- If the worktree is not in git's worktree list → marked as `cleanup_failed`
- Missing worktrees are **never silently recreated**
- They appear as degraded recovered state in persistence

### Already Removed Worktrees

Worktrees with status `removed` are excluded from reconciliation entirely.

### Cleanup Failed Worktrees

Worktrees already in `cleanup_failed` state are re-marked as missing on each restart to maintain accurate state.

## Session Recovery

### Interrupted Session States

Sessions that were active when Rudu shutdown are converted to terminal states:

| Original Status | Recovered Status |
|-----------------|------------------|
| `queued`        | `failed` + recovered flag |
| `starting`      | `failed` + recovered flag |
| `running`       | `failed` + recovered flag |
| `cancelling`    | `failed` + recovered flag |

This ensures no session appears "active" after a restart when the runtime context was lost.

### Orphaned Sessions

Sessions with a `worktreeId` that points to an unknown/removed worktree are marked as recovered with an error message.

## UI Selection After Restart

The `repairSelection()` function ensures:

1. If the previously selected node is still valid → keep it
2. If the selected node was removed → select the next valid node
3. If no valid nodes exist → clear selection and show empty/recovery state

## Key Files

- `src/services/worktree/RestartReconciliation.ts` - Core reconciliation logic
- `src/services/worktree/RestartReconciliation.test.ts` - Test coverage
- `src/services/SessionManager.ts` - Session rehydration with recovery
- `src/domain/tree.ts` - Selection repair logic
- `src/app/App.tsx` - Integration point (calls reconciliation on startup)

## Usage

The reconciliation runs automatically on app startup:

```typescript
// App.tsx startup flow
const reconciliationResult = reconcileWorktreesOnRestart(repoRoot, worktreeRepository);
sessionManager.rehydrateFromPersistence();
setWorktrees(reconciliationResult.validWorktrees);
```

## Testing

Run restart reconciliation tests:
```bash
bun test src/services/worktree/RestartReconciliation.test.ts
```

Manual verification:
1. Create worktrees with sessions
2. Delete a worktree manually (outside Rudu): `git worktree remove <path>`
3. Restart Rudu
4. Verify the missing worktree is marked as `cleanup_failed` and not recreated
5. Verify interrupted sessions are shown as recovered
