# User Testing

Validation surface, testing tools, and concurrency guidance for this mission.

**What belongs here:** User-facing surfaces, validation tools, setup expectations, and runtime findings for validators.  
**What does NOT belong here:** Core implementation requirements or git naming policy.

---

## Validation Surface

Primary surface: local terminal UI (OpenTUI application launched with `bun dev`).

Key flows to validate:
- supported repo startup vs blocked non-repo startup
- zero-worktree welcome screen
- `Ctrl+N` create-worktree dialog
- title entry and branch/path preview
- worktree creation and first-session creation
- combined tree navigation and node-type-specific focus behavior
- archive/delete flows
- restart reconciliation and recovered-state rendering

Validation tools available:
- `bun test` for automated component/app/service coverage
- `bunx tsc --noEmit` for TypeScript validation
- direct manual smoke checks with `bun dev`

Known limitation:
- `tuistory` is not available in this environment, so validators should rely on OpenTUI tests plus direct manual smoke testing rather than scripted TUI automation.

---

## Flow Validator Guidance: TUI

### Isolation boundaries for concurrent testing
- Each flow validator should test assertions in isolation using separate test repositories
- Do NOT test against the actual Rudu repository - use temporary test repos
- Clean up test directories after validation

### Shared state to avoid
- Do not modify the Rudu source repository's worktrees or branches
- Do not leave orphaned worktrees after testing
- Do not interfere with other validators' test repositories

### Test repository setup
1. Create a temporary git repository for testing
2. Initialize with a commit on the default branch (main)
3. Launch Rudu from within the test repo to test startup behavior
4. Clean up the test directory after completion

### Assertion testing approach
- **Component assertions** (welcome screen, dialog): rely on `bun test` coverage
- **Integration assertions** (create flow, git operations): use temporary test repos + manual smoke
- **Keyboard flow assertions**: verify through component tests and code review

### Expected evidence per assertion type
- Welcome screen: test output showing "No worktrees yet" state
- Create dialog: test output showing dialog renders with focused input
- Branch/path preview: test output showing preview updates with title
- Validation: test output showing invalid submissions blocked
- Worktree creation: temporary repo verification + git state check
- Session creation: verification that session is linked to worktree
- Combined tree: test output showing tree structure
- Selection behavior: test output showing selection state changes
- Failure recovery: test output showing error states
- Selection repair: test output showing selection fallback
- Cross-flow: full keyboard navigation verification

## Validation Concurrency

Surface: local TUI validation

- Machine observed during dry run:
  - CPU cores: `10`
  - RAM: `16 GiB`
- Observed safe validator estimate:
  - about `0.75 GiB` RAM per validator instance
  - about `1` logical core per validator instance
- Use 70% of observed available memory headroom for planning.
- Recommended max concurrent validators for this surface: **3**

Rationale:
- Memory is the tighter bound versus CPU on this machine.
- This leaves room for Bun, the TUI runtime, and normal workstation activity.

## Dry-Run Findings

- `bun test` passes but emits repeated React `act(...)` warnings.
- `bunx tsc --noEmit` failed during planning due to a pre-existing `useSessionStore` type error; foundation work must leave this clean.
- `bun dev` boots successfully and renders the app shell without immediate crash.
