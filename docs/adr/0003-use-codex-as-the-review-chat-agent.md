# Use Codex as the Review Chat agent

Rudu will replace the Pi-based ACP runtime with Codex through `codex-acp`, rather than keeping Pi and Codex behind a selectable provider abstraction. The Review Chat product boundary remains Inspection-Only Review by default: Codex may inspect the repository worktree inside the local Review Workspace, including read-only Git and GitHub commands, but direct workspace mutation, project command execution, mutating Git or GitHub commands, and Rudu-owned App Actions stay outside the default capability set.

The ACP session working directory should be the repository worktree inside the Review Workspace, not Rudu's metadata directory. This keeps Codex oriented around the code under review while Rudu continues to own metadata, snapshots, and refresh state outside the agent's default workspace context.

Rudu should persist the Codex ACP session identity on the Review Session and use session loading when restarting the runtime. A Revision Refresh must still advance the Review Workspace in place and keep the same Review Session and Codex conversation; if the Codex runtime is not active during the refresh, Rudu must send the Revision Refresh Notice after loading the session and before the next developer prompt. The Review Session should store an Agent Context Revision, updated only after the AI receives the corresponding notice, so Rudu can reliably detect stale agent context across app and runtime restarts.

Rudu should provide Codex with minimal Review Session context: repository, pull request number, active head SHA, and the Inspection-Only Review boundary. This context should appear when initializing/loading the session and in Revision Refresh Notices, but should stay compact because Codex can use read-only Git and GitHub inspection for details.

Rudu must enforce the Inspection-Only Review boundary technically instead of relying only on prompt instructions. Rudu should rely heavily on maintained `codex-acp` and Codex permission mechanics for that enforcement, configuring the safest available session mode and using conservative ACP permission responses. Rudu should add its own command classifier only if the upstream permission surface cannot express a required product boundary. Actions outside Inspection-Only Review should be auto-denied in the default mode, with positive wording built around "Rudu is built for reviewing code."

The first migration should keep the current Review Chat surface. Codex-specific affordances such as model selection, mode selection, slash commands, plan or TODO rendering, and authentication UI should be added incrementally after the runtime swap, while the Rust ACP layer preserves enough upstream event/config data for those follow-up UI changes.

User-facing copy should name the assistant experience Rudu, not Codex or a generic AI agent. Codex is the implementation runtime and should appear only where it helps with setup, authentication, or troubleshooting.

Review Workspace Activity should remain visible for app-controlled setup steps such as Repository Cache creation, fetch, worktree creation or refresh, authentication readiness, and Codex runtime startup. It should not preserve obsolete Pi setup or pull request diff snapshot capture steps.

This keeps the agent runtime simple while Rudu moves away from Pi-specific launch scripts, extension tools, and onboarding. Future App Actions should be exposed through Rudu-mediated capabilities instead of relying on direct agent access to mutate the Review Workspace or Rudu state.

The migration should delete Pi-specific runtime code and dependencies instead of leaving them as a dormant fallback. Rollback should use version control history, not a second inactive runtime path in the codebase.

The migration should also rename the remaining `remote_review` code surface toward the domain language in `CONTEXT.md`: Review Session, Review Chat, Review Workspace, and Review Workspace Activity. This includes backend modules, frontend query/helper names, and Tauri command contracts where both the Rust command and TypeScript invoke site are updated together. The terminology cleanup should happen in the same implementation PR as the Codex runtime replacement so the obsolete Worker-era "remote review" language does not survive the agent migration.
