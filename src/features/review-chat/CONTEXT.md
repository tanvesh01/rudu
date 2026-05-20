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

**Review Chat Turn Activity**:
A compact, optional view of what happened during one AI turn in Review Chat.
_Avoid_: main transcript, Review Workspace Activity, hidden reasoning

**Progress Update**:
Assistant text emitted during an active Review Chat turn before the durable answer is known.
_Avoid_: final answer, reasoning, thinking chunk

**Final Answer**:
The durable assistant answer that remains visible in the Review Chat transcript after a turn finishes.
_Avoid_: progress update, activity log, tool output

**Rudu**:
The user-facing name for the app and its review assistant experience.
_Avoid_: Codex, Pi, generic AI agent

**Review Workspace Activity**:
A visible, chronological status stream showing Rudu preparing or refreshing the Review Workspace before the Review Chat can use it.
_Avoid_: spinner, status dot, hidden setup

**Review Chat Attachment**:
A visible context item that the developer explicitly adds to a Review Chat prompt.
_Avoid_: ambient selection, hidden context, selected state

**Review Chat Mention**:
A prompt reference that creates a Review Chat Attachment through a dedicated prompt trigger.
_Avoid_: tag, ambient reference, general mention

**Workspace File Attachment**:
A Review Chat Attachment that points to one file inside the active Review Workspace.
_Avoid_: path chip, file tag

**Pull Request Attachment**:
A Review Chat Attachment that points to a GitHub pull request by repository and number.
_Avoid_: tracked PR, selected PR, PR tag

**Issue Attachment**:
A Review Chat Attachment that points to a provider-neutral Issue from the Issue Dashboard.
_Avoid_: ticket attachment, task tag

**Known Issue**:
An Issue that Rudu has already discovered and can offer as an Issue Attachment.
_Avoid_: live issue search result, hidden issue

**Linear Issue Detail Lookup**:
A Rudu-controlled, Review Session-scoped, read-only lookup that lets Review Chat retrieve a Linear issue body or description when the compact Issue Attachment summary is not enough.
_Avoid_: global Codex MCP configuration, exposing Linear credentials to the AI, full issue embedding

**Rudu Tool Capability**:
A declared safety class for a Rudu-owned Review Session tool.
_Avoid_: trusted tool, internal tool

**Revision Refresh**:
A user-approved update that moves a Review Session and its Review Workspace to the pull request's latest Pull Request Revision.
_Avoid_: new session, reset, rerun

**Revision Refresh Notice**:
A hidden Review Chat event that tells the AI the Review Session moved to a new active Pull Request Revision.
_Avoid_: chat message, transcript entry

**Agent Context Revision**:
The Pull Request Revision that the AI agent has been told to use for future Review Chat answers.
_Avoid_: synced revision, notified SHA, agent head

**Revision Checkpoint**:
A visible, non-message marker in Review Chat showing where a Revision Refresh changed the active Pull Request Revision.
_Avoid_: assistant message, user message, refresh notice

**Inspection-Only Review**:
AI-assisted review where the agent may inspect code context but must not change files or run project commands. Read-only Git and GitHub inspection commands are allowed.
_Avoid_: agent workbench, autonomous fix, build run

**GitHub CLI Delegation**:
Direct agent authority to run `gh` CLI commands, including commands that mutate remote GitHub state.
_Avoid_: App Action, Rudu MCP action, selected gh allowlist

**App Action**:
An explicit change to Rudu-owned state or review workflow state that must be performed through Rudu, not by directly mutating the Review Workspace.
_Avoid_: direct workspace edit, background mutation, hidden agent action

**Review Action Permission**:
A developer-approved permission for one named **App Action**.
_Avoid_: raw command allowlist, blanket agent permission

## Relationships

- A pull request has at most one **Review Workspace**
- A **Review Session** is tied to exactly one pull request
- A **Review Session** uses exactly one **Review Workspace**
- A **Review Workspace** belongs to exactly one **Review Session**
- A **Review Session** keeps the same AI agent session identity across app or runtime restarts
- A **Review Session** keeps the same AI agent session identity when its active **Pull Request Revision** changes
- A **Review Workspace** is updated by Rudu to the pull request's latest head SHA
- Rudu prepares a **Review Workspace** only after the developer opens **Review Chat** for a selected pull request
- Rudu does not keep separate pull request diff snapshot files for a **Review Session**
- Updating a **Review Workspace** to a new head SHA advances the **Review Session** to a new active **Pull Request Revision**
- A **Review Session** keeps its **Review Chat** when its active **Pull Request Revision** changes
- The **Review Chat** should refer to the assistant experience as **Rudu** in user-facing copy
- Codex is the implementation runtime for **Review Chat**, not the user-facing assistant name
- A completed **Review Chat** turn shows the **Final Answer** in the main transcript
- When a Review Chat turn includes tool activity, the **Final Answer** is the last contiguous assistant text after the final tool activity
- When a Review Chat turn includes no tool activity, the **Final Answer** is the full assistant text
- If Rudu cannot identify a meaningful post-tool **Final Answer**, it may fall back to the full assistant text
- **Progress Updates** stay out of the main transcript after the **Final Answer** is available
- **Review Chat Turn Activity** can show **Progress Updates** and tool activity without making them part of the main transcript
- **Review Chat Turn Activity** is open by default while a Review Chat turn is active
- **Review Chat Turn Activity** collapses by default after the **Final Answer** is available
- **Review Chat Turn Activity** uses readable activity rows by default
- Raw tool payloads belong behind an explicit debug disclosure, not in the default activity view
- A **Revision Refresh** happens only after the developer accepts the new pull request changes
- A **Revision Refresh** sends a **Revision Refresh Notice** to the AI without adding a visible message to the **Review Chat**
- A **Revision Refresh Notice** must reach the AI before the next developer prompt, even if the AI runtime was not active when the **Revision Refresh** happened
- A **Review Session** stores its **Agent Context Revision** so Rudu can detect whether the AI still needs a **Revision Refresh Notice**
- A **Review Session** updates its **Agent Context Revision** only after the AI receives the corresponding **Revision Refresh Notice**
- Rudu gives the AI minimal Review Session context: repository, pull request number, active head SHA, and the Inspection-Only Review boundary
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
- Leaving **Review Chat** does not cancel an active AI turn; only an explicit stop action cancels the turn
- A **Review Workspace** lives under `~/rudu/workspaces` so it is inspectable as a real local workspace
- A **Review Workspace** path is based on repository and pull request number, not head SHA
- The current head SHA of a **Review Workspace** is metadata, not part of the workspace path
- A **Repository Cache** lives under `~/rudu/workspaces/_repos` and may back many **Review Workspaces**
- A **Review Workspace** is a Git worktree created from a **Repository Cache**
- The AI agent's filesystem context is the repository worktree inside the **Review Workspace**, not Rudu's metadata directory
- Rudu clones each GitHub repository into a **Repository Cache** once, then creates one moving **Review Workspace** worktree per pull request
- A **Review Session** performs an **Inspection-Only Review** by default
- **Inspection-Only Review** excludes **App Actions** unless the developer explicitly grants that capability through Rudu
- **GitHub CLI Delegation** is allowed in **Inspection-Only Review**
- **GitHub CLI Delegation** is always on for **Review Chat**
- **GitHub CLI Delegation** does not go through Rudu MCP or an **App Action**
- **GitHub CLI Delegation** may mutate remote GitHub state
- Rudu should visibly log `gh` commands run through **GitHub CLI Delegation**
- **Inspection-Only Review** allows read-only repository and GitHub inspection commands, such as checking diffs, status, logs, pull request metadata, and review context
- **Inspection-Only Review** allows Rudu-owned, Review Session-scoped, read-only tools such as **Linear Issue Detail Lookup**
- Every Rudu-owned Review Session tool must declare a **Rudu Tool Capability**
- A Rudu-owned Review Session tool is allowed by default in **Inspection-Only Review** only when its **Rudu Tool Capability** is read-only
- **Inspection-Only Review** does not allow mutating local Git commands, including commits, pushes, merges, or checkouts that alter the **Review Workspace**
- Mutating GitHub operations performed through `gh` are covered by **GitHub CLI Delegation**, not by **App Actions**
- Rerunning a GitHub workflow through `gh` is **GitHub CLI Delegation**, not an **App Action**
- Rudu must enforce **Inspection-Only Review** technically, not only by prompting the AI
- Rudu auto-denies actions outside **Inspection-Only Review** and **GitHub CLI Delegation**, and frames the denial positively: "Rudu is built for reviewing code"
- **Review Workspace Activity** is visible setup context, not part of the **Review Chat** transcript
- **Review Workspace Activity** includes app-controlled setup steps such as Repository Cache creation, fetch, worktree creation or refresh, authentication readiness, and AI runtime startup
- **Review Workspace Activity** does not include obsolete Pi setup or pull request diff snapshot capture steps
- A **Review Chat Attachment** belongs to one developer prompt in a **Review Chat**
- A selected diff line range is not a **Review Chat Attachment** until the developer explicitly adds it
- A **Review Chat Mention** creates one **Review Chat Attachment**
- A **Review Chat Mention** can create a **Workspace File Attachment**, **Pull Request Attachment**, or **Issue Attachment**
- A `@` **Review Chat Mention** creates only **Workspace File Attachments**
- A `#` **Review Chat Mention** creates only **Pull Request Attachments** and **Issue Attachments**
- A `#` **Review Chat Mention** creates **Pull Request Attachments** only for the current repository
- Opening a bare `#` **Review Chat Mention** shows all **Known Issues** and current-repository pull requests already known to Rudu
- The `#` **Review Chat Mention** suggestion menu groups **Issue Attachments** separately from **Pull Request Attachments**
- Typing after `#` searches **Issue Attachments** and current-repository **Pull Request Attachments** together
- An **Issue Attachment** created from a **Review Chat Mention** resolves from **Known Issues**
- A selected **Review Chat Mention** remains visible inline in the developer prompt as a compact mention chip
- Mention-created **Review Chat Attachments** use inline mention chips as their primary visible representation in the prompt composer and sent developer message
- **Workspace File Attachments** and `#`-triggered **Review Chat Attachments** may use distinct inline mention presentations
- **Issue Attachments** use their **Issue Provider** identity in their inline mention presentation
- **Pull Request Attachments** use the same pull request status identity as Rudu's pull request list in their inline mention presentation
- **Review Chat Mention** suggestion rows use the same attachment identity cues as the selected inline mention presentation
- Sent developer messages show mention-created **Review Chat Attachments** inline and non-mention **Review Chat Attachments** separately
- Non-mention **Review Chat Attachments**, such as selected diff line ranges, may remain visible in the prompt composer attachment area
- Multiple selected **Review Chat Mentions** for the same target share one **Review Chat Attachment**
- Removing a **Review Chat Attachment** does not remove inline mention text from the developer prompt
- A **Workspace File Attachment** must point inside the active **Review Workspace**
- A **Workspace File Attachment** may point to any tracked file in the active **Review Workspace**
- A **Pull Request Attachment** may point to a pull request that Rudu is not currently tracking
- A **Review Chat Attachment** carries a small prompt summary, not full workspace file contents
- Full file inspection for a **Workspace File Attachment** happens through the AI's read-only Review Workspace tools
- GitHub **Pull Request Attachments** and GitHub **Issue Attachments** may be expanded by the AI using read-only GitHub inspection commands
- Linear **Issue Attachments** are expanded through session-scoped **Linear Issue Detail Lookup**, not by global Codex configuration or by exposing Linear credentials to the AI

## Example Dialogue

> **Dev:** "When the selected pull request changes, do we reuse the same **Review Workspace**?"
> **Domain expert:** "Reuse it when the repository and pull request number match; Rudu is responsible for updating it to the latest head."

> **Dev:** "If I select lines in the diff, does Rudu automatically get that context?"
> **Domain expert:** "No — Rudu gets selected lines only after they appear as a **Review Chat Attachment** on the prompt."

## Flagged Ambiguities

- "managed area" was used to mean a local checkout owned by Rudu; resolved: call this a **Review Workspace**.
- "remote review" described the previous Worker-backed design; resolved: use **Review Session** and **Review Workspace** for the local-checkout design.
- "read-only" means no file mutation and no project command execution inside the **Review Workspace**, including install, build, start, or test commands.
- "`gh` commands" are covered by **GitHub CLI Delegation** and may mutate remote GitHub state.
- "servers" for faster code understanding may mean language servers, static indexes, or other analysis helpers; unresolved and intentionally out of scope for the first **Review Workspace** migration.
- "Review Workspace per revision" was considered, then rejected because it creates too many checked-out folders for frequent pushes; resolved: use one moving **Review Workspace** per pull request.
- "selected lines" used to mean ambient Rudu context; resolved: selected diff lines become Rudu context only as an explicit **Review Chat Attachment**.
- "@ mentions" were originally defined as creating **Workspace File Attachments**, **Pull Request Attachments**, and **Issue Attachments**; resolved: `@` creates only **Workspace File Attachments** and `#` creates only **Pull Request Attachments** and **Issue Attachments**.
- "attachment content" does not mean full file embedding; resolved: attachments carry compact prompt summaries and rely on Review Workspace tools for full inspection.
- "file mentions" should not be limited to changed files; resolved: they can attach any tracked file in the active **Review Workspace**.
- "mention modes" were originally one `@` grammar; resolved: split prompt triggers by target kind, with `@` for workspace files and `#` for current-repository pull requests and issues.
- "cross-repository pull request mentions" were considered for the `#` trigger; resolved: keep `#` pull request mentions scoped to the current repository for now.
- "bare # behavior" was unclear; resolved: bare `#` opens all known Issues and current-repository pull requests already known to Rudu.
- "number searches after #" were considered as special pull request lookup; resolved: typing after `#` searches Issues and current-repository Pull Requests together.
- "mixed # suggestions" were considered; resolved: keep one `#` trigger but group Issue suggestions separately from Pull Request suggestions.
- "inline mention presentation" was unclear; resolved: file mentions and `#`-triggered mentions should have separate inline presentations rather than one generic chip.
- "issue vs pull request inline presentation" was unclear; resolved: Issue mentions show provider identity, and Pull Request mentions show the same status identity used in Rudu's pull request list.
- "suggestion row identity" was unclear; resolved: suggestion rows mirror the same identity cues as selected inline mention chips.
- "selected mention text" should not disappear from the prompt; resolved: selected **Review Chat Mentions** stay inline as compact chips and carry structured attachment context.
- "duplicate mention attachments" should not create duplicate AI context; resolved: duplicate selected mentions keep their inline text but share one **Review Chat Attachment**.
- "removing attachment pills" does not edit prompt text for now; resolved: only structured attachment context is removed.
- "issue mention search" should not query providers live in the first version; resolved: issue mentions use already-known Rudu Issues.
