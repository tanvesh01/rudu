# Rudu

Rudu is a local desktop app for reviewing GitHub pull requests with rendered diffs, review comments, and AI-assisted inspection.

## Language

**Review Workspace**:
A local, Rudu-managed checkout for one pull request that moves to the pull request's latest head.
_Avoid_: working copy, managed area, remote review file tree

**Repository Cache**:
A shared bare Git repository managed by Rudu for creating Review Workspace worktrees.
_Avoid_: clone cache, app cache, repo folder

**Repository Discovery**:
The set of GitHub repositories the authenticated viewer can access for pull request review.
_Avoid_: global repository search, repo autocomplete

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

**Review Walkthrough**:
A generated, ordered guide for reviewing one Pull Request Revision, grouped by files and review priority.
_Avoid_: chain-of-thought review UI, AI review report, model reasoning

**Review Chat Transcript**:
The visible ordered Review Chat messages for one Review Session.
_Avoid_: ephemeral chat state, active stream buffer

**App Database**:
Rudu's local SQLite database for durable app-owned state.
_Avoid_: cache-only store, transient UI memory

**Review Chat Turn Activity**:
A compact, optional view of what happened during one AI turn in Review Chat.
_Avoid_: main transcript, setup status, hidden reasoning

**Progress Update**:
Assistant text emitted during an active Review Chat turn before the durable answer is known.
_Avoid_: final answer, reasoning, thinking chunk

**Final Answer**:
The durable assistant answer that remains visible in the Review Chat transcript after a turn finishes.
_Avoid_: progress update, activity log, tool output

**Rudu**:
The user-facing name for the app and its review assistant experience.
_Avoid_: Codex, Pi, generic AI agent

**Review Chat Attachment**:
A visible context item that the developer explicitly adds to a Review Chat prompt.
_Avoid_: ambient selection, hidden context, selected state

**Review Chat Mention**:
A prompt reference that creates a Review Chat Attachment through a dedicated prompt trigger.
_Avoid_: tag, ambient reference, general mention

**Review Chat Command**:
A visible developer request that Rudu expands into a fuller internal prompt before sending it to the AI.
_Avoid_: hidden prompt, raw slash text, prompt template

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

**Codex Review Effort Mode**:
A developer-selected Review Chat setting for the Codex Review Chat Runtime that chooses how much Codex model capability Rudu should spend on future Codex-backed turns.
_Avoid_: provider-neutral effort mode, generic model picker, agent type

**Pending Codex Review Effort Mode**:
A Codex Review Effort Mode chosen while a Review Chat turn is active that will apply to the next Codex-backed turn.
_Avoid_: live model swap, mid-turn mode change

**Runtime Model Choice**:
A model option exposed by the active Review Chat Runtime and selected for that runtime's future Review Chat turns.
_Avoid_: global model picker, provider-neutral effort mode

**Model Switch**:
A developer-approved change to the active Runtime Model Choice that starts a new AI conversation with no prior Review Chat Transcript.
_Avoid_: effort change, runtime switch, mid-chat model change

**Review Chat Runtime**:
The ACP-compatible backend runtime Rudu uses to power Review Chat.
_Avoid_: assistant identity, provider brand, agent type

**Review Runtime Choice**:
A developer-selected Review Chat Runtime that changes backend execution without changing the user-facing Rudu assistant identity.
_Avoid_: provider switcher, assistant picker

**Runtime Switch**:
A developer-approved replacement of a Review Session's Review Chat Runtime that starts a new Review Session with no prior Review Chat Transcript.
_Avoid_: agent switch, provider swap, model change

## Relationships

- A pull request has at most one **Review Workspace**
- A **Review Session** is tied to exactly one pull request
- A **Review Session** uses exactly one **Review Workspace**
- A **Review Workspace** belongs to exactly one **Review Session**
- A **Review Session** keeps the same AI agent session identity across app or runtime restarts
- A **Review Session** keeps the same AI agent session identity when its active **Pull Request Revision** changes
- A **Review Session** keeps the same **Review Chat Transcript** across URL changes, tab switches, and app restarts
- A **Review Walkthrough** belongs to one **Pull Request Revision**
- A **Review Walkthrough** is user-facing review guidance, not model chain-of-thought
- A **Review Walkthrough** is shown as a generated assistant message in the **Review Chat Transcript**
- A **Review Walkthrough** is not a separate durable review artifact in v1
- A **Review Walkthrough** is generated only after the developer explicitly requests it
- A **Review Walkthrough** is displayed as grouped review steps with file references, not as plain internal prompt text
- A **Review Walkthrough** assistant message carries structured walkthrough content so Rudu can render groups, file references, actions, and review scope
- A **Review Walkthrough** is generated by a sidecar walkthrough generator, not by the live **Review Chat** turn
- A **Review Walkthrough** is grounded in the selected **Pull Request Revision**, not the full **Review Chat Transcript**
- A **Review Walkthrough** uses compact pull request context such as changed files, patch content, title, body, repository, pull request number, and head SHA
- The sidecar walkthrough generator may inspect files in the **Review Workspace** while producing a **Review Walkthrough**
- The sidecar walkthrough generator follows the **Inspection-Only Review** boundary
- A **Review Walkthrough** file reference should navigate to the matching file in the rendered pull request diff
- A **Review Walkthrough** file reference does not need line-level navigation in v1
- A **Review Walkthrough** generation may show coarse sidecar phases such as preparing context, asking Codex, and formatting, but does not track per-file completion progress in v1
- A developer requests a **Review Walkthrough** through a **Review Chat Command**
- The primary v1 entrypoint for a **Review Walkthrough** is the empty **Review Chat** state
- A sent **Review Chat Command** is shown in the **Review Chat Transcript** as a readable command chip, not as its expanded internal prompt
- If **Review Walkthrough** generation fails, the **Review Chat Transcript** shows the command and a corresponding assistant failure message
- Requesting a **Review Walkthrough** counts as starting **Review Chat**
- A **Review Chat Transcript** is durable app-owned state and belongs in the **App Database**
- A **Review Chat Transcript** persists user prompts, explicit prompt attachments, Final Answers, compact turn activity metadata, Revision Checkpoints, timestamps, turn ids, and the Codex Review Effort Mode used by Codex-backed turns
- A **Review Chat Transcript** does not persist raw streaming deltas as primary transcript messages
- Hidden Review Chat notices are internal events, not visible **Review Chat Transcript** messages
- Rudu keeps **Review Chat Transcript** history indefinitely while its pull request remains tracked
- Archiving or untracking a pull request deletes that pull request's **Review Chat Transcript**
- **Codex Review Effort Mode** is durable Review Session state for Codex-backed Review Sessions and belongs in the **App Database**
- `session.json` may remain Review Workspace metadata, but it is not the source of truth for **Review Chat Transcript**
- A **Review Workspace** is updated by Rudu to the pull request's latest head SHA
- Rudu prepares a **Review Workspace** only after the developer opens **Review Chat** for a selected pull request
- Rudu does not keep separate pull request diff snapshot files for a **Review Session**
- Updating a **Review Workspace** to a new head SHA advances the **Review Session** to a new active **Pull Request Revision**
- A **Review Session** keeps its **Review Chat** when its active **Pull Request Revision** changes
- Opening the Review Chat URL for an existing **Review Session** restores the existing **Review Chat Transcript**
- Opening the Review Chat URL for an existing **Review Session** must not create a new Review Chat conversation
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
- A **Revision Checkpoint** is rendered as a checkpoint-style divider in the **Review Chat Transcript**
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
- **Repository Discovery** includes repositories owned by the viewer and repositories owned by organizations visible to the viewer
- **Repository Discovery** presents visible organization repositories even when the viewer owns enough personal repositories to fill the first result set
- **Repository Discovery** excludes unrelated public GitHub repositories unless the developer opens a specific pull request link
- A **Review Session** performs an **Inspection-Only Review** by default
- A Codex-backed **Review Session** has one active **Codex Review Effort Mode**
- A **Review Session** has one **Review Runtime Choice**
- A **Review Runtime Choice** belongs to one **Review Session**
- A **Review Runtime Choice** is fixed for the life of a **Review Session**
- The v1 **Codex Review Effort Modes** are Fast and Deep
- Fast is the default **Codex Review Effort Mode**
- Fast uses GPT-5.4 Mini for lower-latency, lower-cost review turns
- Deep uses GPT-5.5 with high reasoning for harder review turns
- The Codex Review Effort Mode selector shows Fast and Deep as primary labels and model details as secondary context
- The Codex Review Effort Mode selector orders Fast before Deep
- The Codex Review Effort Mode selector uses the existing composer-side PromptModeToggle control beside Send
- The Codex Review Effort Mode selector state comes from the active Review Session, not local component state
- A **Codex Review Effort Mode** is a friendly Codex preset, not a raw **Runtime Model Choice**
- A Codex-backed **Review Chat Runtime** maps **Codex Review Effort Modes** to concrete model and runtime configuration
- Spark is not a v1 **Codex Review Effort Mode**
- Changing **Codex Review Effort Mode** affects future Review Chat turns, not already completed answers
- Changing **Codex Review Effort Mode** keeps the same **Review Chat** conversation
- Changing **Codex Review Effort Mode** is not a **Model Switch**
- A **Codex Review Effort Mode** change must reach the AI before the next developer prompt
- A **Codex Review Effort Mode** change does not add a visible marker to the **Review Chat Transcript**
- Changing **Codex Review Effort Mode** while a Review Chat turn is active creates a **Pending Codex Review Effort Mode**
- A **Pending Codex Review Effort Mode** does not alter the active Review Chat turn
- A **Pending Codex Review Effort Mode** becomes the active **Codex Review Effort Mode** before the next developer prompt is sent
- Non-Codex **Review Chat Runtimes** do not inherit Fast and Deep by default
- A **Runtime Model Choice** may be populated from models exposed through the active **Review Chat Runtime**
- A **Runtime Model Choice** is runtime-specific and does not replace **Codex Review Effort Mode** for Codex-backed Review Sessions
- Changing **Runtime Model Choice** happens through a **Model Switch**
- A **Model Switch** creates a new **Review Session** for the selected pull request
- A **Model Switch** starts with an empty **Review Chat Transcript**
- A **Model Switch** does not carry the previous AI conversation forward
- A **Model Switch** deletes the previous **Review Session** for the selected pull request in v1
- A **Model Switch** deletes the previous **Review Chat Transcript** for the selected pull request in v1
- A **Model Switch** reuses the existing **Review Workspace** for the selected pull request
- A **Model Switch** does not recreate the **Review Workspace**
- A **Review Chat** uses exactly one **Review Chat Runtime** at a time
- A **Review Runtime Choice** changes the **Review Chat Runtime**, not the **Rudu** assistant identity
- A global default **Review Runtime Choice** may apply when creating new **Review Sessions**
- A **Review Runtime Choice** must not require rewriting **Review Session**, **Review Chat Transcript**, or **Review Workspace** state
- Changing **Review Chat Runtime** for an existing pull request happens through a **Runtime Switch**
- A **Runtime Switch** creates a new **Review Session** for the selected pull request
- A **Runtime Switch** starts with an empty **Review Chat Transcript**
- A **Runtime Switch** does not carry the previous **Review Session's** AI conversation into the new **Review Session**
- A **Runtime Switch** deletes the previous **Review Session** for the selected pull request in v1
- A **Runtime Switch** deletes the previous **Review Chat Transcript** for the selected pull request in v1
- A **Runtime Switch** reuses the existing **Review Workspace** for the selected pull request
- A **Runtime Switch** does not recreate the **Review Workspace**
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
- Selected diff line attachments use file identity and selected line range in their inline presentation
- **Review Chat Mention** suggestion rows use the same attachment identity cues as the selected inline mention presentation
- Sent developer messages show **Review Chat Attachments** inline when the attachment was visibly inserted into the developer prompt
- A selected diff line range appears as an inline **Review Chat Attachment** after the developer adds it to Rudu
- An inline selected diff line attachment remains a **Review Chat Attachment** only while its inline prompt chip remains in the developer prompt
- Adding a selected diff line range to Rudu opens **Review Chat** so the inline attachment is immediately visible
- Multiple adds for the same selected diff line range share one inline **Review Chat Attachment**
- The add control for a selected diff line range shows the range as already added while the matching inline attachment exists
- Sending a developer prompt clears inline selected diff line attachments from the prompt composer and preserves them inline in the sent developer message
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
- "inline attachments" originally meant only mention-created attachments; resolved: selected diff lines added to Rudu also appear inline in the developer prompt and sent message.
- "removing selected diff line attachments" was tied to a separate attachment strip; resolved: deleting the inline diff-line chip removes that attachment from the prompt.
- "duplicate selected diff line attachments" were considered for repeated insertion; resolved: exact same diff ranges share one inline diff-line chip.
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
- "backend only" and "user choice" for ACP providers were in tension; resolved: expose **Review Runtime Choice** as a backend execution choice while keeping the user-facing assistant identity as **Rudu**.
- "runtime choice scope" was unclear; resolved: **Review Runtime Choice** is stored per **Review Session**, with an optional global default for new Review Sessions.
- "active session" was used during runtime-choice discussion; resolved: a **Review Runtime Choice** cannot change after a **Review Session** exists.
- "switch agent" was used to mean changing the backend ACP runtime; resolved: call this a **Runtime Switch**, and keep **Rudu** as the assistant identity.
- "old runtime sessions" after a **Runtime Switch** were considered; resolved for v1: delete the previous **Review Session** and **Review Chat Transcript** instead of archiving or showing parallel histories.
- "workspace reset during runtime switch" was considered; resolved: a **Runtime Switch** reuses the existing **Review Workspace** and resets only Review Session state.
- "Fast and Deep" were considered as provider-neutral runtime options; resolved: they are **Codex Review Effort Modes**, and non-Codex **Review Chat Runtimes** do not inherit them by default.
- "available models" were considered as a replacement for Fast and Deep; resolved: Codex keeps friendly **Codex Review Effort Mode** presets, while **Runtime Model Choice** remains runtime-specific.
- "changing model" was considered for non-Codex runtimes; resolved: a **Model Switch** creates a new **Review Session** with an empty **Review Chat Transcript**, deletes the previous Review Session state in v1, and reuses the existing **Review Workspace**.
- "changing Codex Fast or Deep" was compared with changing raw runtime model; resolved: **Codex Review Effort Mode** changes keep the same Review Chat conversation and are not a **Model Switch**.
