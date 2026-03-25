# Repo Context Service

Foundation layer for detecting git repository context and resolving canonical repository identity.

## Usage

```typescript
import { detectRepoContext, isSupportedRepo } from "../services/repo/RepoContext.js";

const result = detectRepoContext();

if (isSupportedRepo(result)) {
  console.log(`Repo root: ${result.repoRoot}`);
  console.log(`Default branch: ${result.defaultBranch}`);
} else {
  console.log(`Unsupported: ${result.reason}`);
}
```

## Key Behaviors

- **Canonical identity**: Uses `git rev-parse --show-toplevel` for the working tree path and `--git-common-dir` for shared git metadata
- **Nested paths**: Works from any subdirectory within a git repository
- **Linked worktrees**: Correctly resolves worktrees created via `git worktree add`
- **Default branch resolution**: Uses origin/HEAD if available, falls back to "main" or "master" local branches
- **Explicit errors**: Returns unsupported state with reason when not in a git repo or when default branch cannot be determined

## Test Coverage

Tests cover:
- Non-repo startup (unsupported)
- Repo root startup (supported)
- Nested subdirectory startup (supported, same identity as root)
- Linked worktree startup (supported, same default branch as main repo)
- Default branch resolution from origin/HEAD
- Fallback to main/master branches
- Unsupported when no default branch can be determined
