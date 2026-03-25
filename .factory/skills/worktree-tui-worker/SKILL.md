---
name: worktree-tui-worker
description: Implement worktree-first Rudu features across git/worktree services, persistence, store, and OpenTUI UI.
---

# Worktree TUI Worker

NOTE: Startup and cleanup are handled by `worker-base`. This skill defines the WORK PROCEDURE.

## When to Use This Skill

Use this skill for Rudu features that touch any combination of:
- repo/worktree detection and git integration
- worktree/session persistence and rehydration
- `SessionManager` integration with worktree state
- store selection/repair logic
- OpenTUI welcome/dialog/tree/footer behavior
- restart recovery, archive/delete lifecycle, and keyboard-first UX

## Required Skills

None.

`tuistory` is not available in this environment, so do not rely on it. Use OpenTUI tests plus bounded manual smoke checks with `bun dev` when UI behavior changes.

## Work Procedure

1. Read `mission.md`, mission `AGENTS.md`, `.factory/services.yaml`, and relevant `.factory/library/*.md` files before changing anything.
   - If repo-root `AGENTS.md` still describes the old session-first architecture, treat the mission `AGENTS.md` and `.factory/library/` files as the authoritative source for this mission's worktree-first behavior.
2. Identify the touched layers and preserve the required architecture order:
   - repo/worktree or persistence layer first
   - session/store synchronization next
   - presentational UI last
3. Write or update failing tests first. Prefer focused tests near the changed files:
   - service/repository tests for git, persistence, and rehydration behavior
   - store/helper tests for selection and graph invariants
   - component/app tests for visible TUI behavior and keyboard shortcuts
4. Implement the minimum code needed to make the new tests pass while matching existing coding patterns.
5. If the feature changes UI behavior, run a bounded manual smoke check with `bun dev` after automated tests. Record exactly what you saw.
   - For features covering restart, unsupported startup, archive/delete, or keyboard-only flows, make the manual or test evidence explicit in the handoff instead of summarizing it vaguely.
6. Run the required validators before finishing:
   - `bun test`
   - `bunx tsc --noEmit`
7. Do not leave orphaned processes. If you start `bun dev`, stop it before ending the session.
8. In the handoff, be explicit about:
   - what files changed
   - what tests were added first
   - what manual checks were performed
   - any discovered edge cases or follow-up work

## Example Handoff

```json
{
  "salientSummary": "Added canonical repo-context detection plus default-branch resolution, then wired the welcome/create-worktree dialog through the new service. The app now blocks non-repo startup, shows the new welcome state for zero worktrees, and passes `bun test` plus `bunx tsc --noEmit`.",
  "whatWasImplemented": "Created a repo/worktree foundation layer, introduced worktree persistence with durable IDs, updated startup rehydration to ignore legacy sessions without worktreeId, and replaced the flat empty session state with a welcome screen plus keyboard-driven create-worktree dialog. Added focused service, store, component, and app tests to cover repo detection, dialog behavior, preview derivation, and startup filtering.",
  "whatWasLeftUndone": "",
  "verification": {
    "commandsRun": [
      {
        "command": "bun test",
        "exitCode": 0,
        "observation": "All tests passed, including new repo-context and create-dialog coverage."
      },
      {
        "command": "bunx tsc --noEmit",
        "exitCode": 0,
        "observation": "TypeScript validation passed after fixing the prior useSessionStore selection error."
      },
      {
        "command": "bun dev",
        "exitCode": 0,
        "observation": "Launched for a short manual smoke check, then stopped cleanly."
      }
    ],
    "interactiveChecks": [
      {
        "action": "Started Rudu in a repo with zero worktrees, pressed Ctrl+N, typed a title, and cancelled.",
        "observed": "Welcome screen rendered first, dialog opened with title focus, branch/path preview updated as I typed, and cancelling returned to the welcome screen without creating anything."
      },
      {
        "action": "Created a worktree from the dialog and navigated the combined tree.",
        "observed": "A sibling worktree was created, the first session appeared beneath it, worktree nodes did not enable chat actions, and selecting the child session updated the detail pane."
      }
    ]
  },
  "tests": {
    "added": [
      {
        "file": "src/services/worktree-manager/repo-context.test.ts",
        "cases": [
          {
            "name": "resolves canonical repo identity from repo root and linked worktree",
            "verifies": "Startup uses the same canonical repo identity across launch locations."
          },
          {
            "name": "returns explicit unsupported result outside a git repo",
            "verifies": "Non-repo launch is blocked before worktree creation UI is enabled."
          }
        ]
      },
      {
        "file": "src/app/App.test.tsx",
        "cases": [
          {
            "name": "shows welcome screen when zero worktrees exist",
            "verifies": "The zero-worktree state uses the new worktree-first UI."
          },
          {
            "name": "opens create dialog with Ctrl+N",
            "verifies": "Keyboard flow reaches the title input without extra navigation."
          }
        ]
      }
    ]
  },
  "discoveredIssues": []
}
```

## When to Return to Orchestrator

- Canonical repo identity or git default-branch behavior cannot be implemented cleanly within the approved mission boundaries
- The feature requires deleting or mutating non-Rudu worktrees/branches to proceed
- The repo lacks enough isolation to test archive/delete/restart behavior safely
- A feature reveals a larger architectural split or migration need that should become its own follow-up feature
