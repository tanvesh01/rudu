# Environment

Environment variables, external dependencies, and setup notes.

**What belongs here:** Required runtimes, local data locations, external CLI dependencies, and setup constraints.  
**What does NOT belong here:** Service ports/commands (use `.factory/services.yaml`).

---

- Runtime: Bun `1.3.5`
- Required CLIs: `bun`, `git`
- Primary app command: `bun dev`
- Automated validation commands:
  - `bun test`
  - `bunx tsc --noEmit`
- There is no dedicated lint script in the current repository.
- Local persisted app data lives under `~/.rudu/`.
- Rudu-managed worktrees for this mission must be created as sibling directories beside the canonical repo root.
- Existing occupied local ports that are off-limits for this mission: `3000`, `5000`, `5432`, `6379`, `7000`, `8000`.
