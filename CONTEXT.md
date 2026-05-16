# Rudu

Rudu is a local desktop app for reviewing GitHub pull requests with rendered diffs, review comments, and AI-assisted inspection.

## Language

**Review Workspace**:
A local, Rudu-managed checkout for one pull request that moves to the pull request's latest head.
_Avoid_: working copy, managed area, remote review file tree

**Repository Cache**:
A shared bare Git repository managed by Rudu for creating Review Workspace worktrees.
_Avoid_: clone cache, app cache, repo folder

**Pull Request Revision**:
A specific pull request state identified by repository, pull request number, and head SHA.
_Avoid_: PR, branch, current checkout

**Remote Review Session**:
Older name for a Review Session.
_Avoid_: chat session, Worker session

**Review Session**:
The ongoing AI review state for one pull request as its active Pull Request Revision changes.
_Avoid_: remote review session, Worker session, chat session

**Review Chat**:
The live conversation between the developer and the AI inside a Review Session.
_Avoid_: report, generated review

**Revision Refresh**:
A user-approved update that moves a Review Session and its Review Workspace to the pull request's latest Pull Request Revision.
_Avoid_: new session, reset, rerun

**Revision Refresh Notice**:
A hidden Review Chat event that tells the AI the Review Session moved to a new active Pull Request Revision.
_Avoid_: chat message, transcript entry

**Revision Checkpoint**:
A visible, non-message marker in Review Chat showing where a Revision Refresh changed the active Pull Request Revision.
_Avoid_: assistant message, user message, refresh notice

**Inspection-Only Review**:
AI-assisted review where the agent may inspect code context but must not change files or run project commands.
_Avoid_: agent workbench, autonomous fix, build run

## Relationships

- A pull request has at most one **Review Workspace**
- A **Review Session** is tied to exactly one pull request
- A **Review Session** uses exactly one **Review Workspace**
- A **Review Workspace** belongs to exactly one **Review Session**
- A **Review Workspace** is updated by Rudu to the pull request's latest head SHA
- Updating a **Review Workspace** to a new head SHA advances the **Review Session** to a new active **Pull Request Revision**
- A **Review Session** keeps its **Review Chat** when its active **Pull Request Revision** changes
- A **Revision Refresh** happens only after the developer accepts the new pull request changes
- A **Revision Refresh** sends a **Revision Refresh Notice** to the AI without adding a visible message to the **Review Chat**
- A **Revision Refresh** adds a **Revision Checkpoint** to the visible **Review Chat**
- A **Revision Checkpoint** is informational and does not restore or branch **Review Chat** history
- A **Revision Refresh** keeps the existing AI runtime when no turn is active
- A **Review Chat** does not accept new developer prompts while a newer pull request revision is waiting for **Revision Refresh**
- A **Review Chat** preserves draft prompt text while waiting for **Revision Refresh**
- A failed **Revision Refresh** keeps the **Review Chat** blocked from new developer prompts until refresh succeeds
- A newer pull request revision is detected by comparing the latest pull request head SHA with the Review Session's active head SHA
- Rudu checks for newer pull request revisions while **Review Chat** is active, using a two-minute cadence
- Rudu does not update a **Review Workspace** to a newer pull request revision until the developer starts a **Revision Refresh**
- Rudu shows that a newer pull request revision is available as soon as it is detected, even while the AI is answering
- A **Revision Refresh** does not run while the AI is answering; the developer must stop the active turn or wait for it to finish
- A **Review Workspace** lives under `~/rudu/workspaces` so it is inspectable as a real local workspace
- A **Review Workspace** path is based on repository and pull request number, not head SHA
- The current head SHA of a **Review Workspace** is metadata, not part of the workspace path
- A **Repository Cache** lives under `~/rudu/workspaces/_repos` and may back many **Review Workspaces**
- A **Review Workspace** is a Git worktree created from a **Repository Cache**
- Rudu clones each GitHub repository into a **Repository Cache** once, then creates one moving **Review Workspace** worktree per pull request
- A **Review Session** performs an **Inspection-Only Review** by default

## Example Dialogue

> **Dev:** "When the selected pull request changes, do we reuse the same **Review Workspace**?"
> **Domain expert:** "Reuse it when the repository and pull request number match; Rudu is responsible for updating it to the latest head."

## Flagged Ambiguities

- "managed area" was used to mean a local checkout owned by Rudu; resolved: call this a **Review Workspace**.
- "remote review" described the previous Worker-backed design; resolved: use **Review Session** and **Review Workspace** for the local-checkout design.
- "read-only" means no file mutation and no project command execution inside the **Review Workspace**, including install, build, start, or test commands.
- "servers" for faster code understanding may mean language servers, static indexes, or other analysis helpers; unresolved and intentionally out of scope for the first **Review Workspace** migration.
- "Review Workspace per revision" was considered, then rejected because it creates too many checked-out folders for frequent pushes; resolved: use one moving **Review Workspace** per pull request.
