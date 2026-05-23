# ADR 0004: Inline Mention Attachment Components

## Status

Accepted

## Context

Review Chat supports explicit prompt context through Review Chat Attachments. Mention-created attachments render inline in the prompt composer as compact chips. Selected diff line ranges also render inline after the developer explicitly adds them to Rudu.

The attachment kinds have different labels, icons, provider metadata, and future interactions. Putting all rendering into one generic component would make the prompt composer grow around every attachment type.

Sent developer messages need to preserve the same inline mention affordance. The structured attachment metadata sent to the AI remains separate from display metadata, so the transcript can render inline chips without changing the compact context summaries used in the upstream prompt.

## Decision

Rudu will implement inline mention attachment rendering with separate focused component files per attachment kind.

Rudu will use `lexical-beautiful-mentions` for the first implementation of Lexical mention detection, typeahead, inline mention nodes, and metadata serialization. Rudu still owns the Review Chat Attachment model and converts mention node metadata into Rudu attachment objects before sending a prompt.

Selected diff line attachments also use the same Lexical mention-node mechanism, but through a Rudu-owned internal trigger that is inserted programmatically and is not offered as a user-typed suggestion trigger.

When serialized to plain prompt text, an inline selected-diff chip contributes a readable bracket token such as `[CONTEXT-MAP.md Line 7]` instead of exposing the internal trigger.

This decision is scoped to selected diff line attachments created through `Add to Rudu`. It does not redesign the generic attachment strip for any future non-inline attachment types.

Rudu will store UI-only inline attachment ranges in the user message metadata so sent developer messages can render inline attachments in their original text positions. Selected diff line attachments inserted from the diff comment composer are appended to the current prompt draft instead of rendered in the attachment strip.

Selected diff line attachments use the Review Walkthrough file badge treatment and display the file name with the selected line label. The full path remains available as secondary detail rather than visible chip text.

File-backed inline attachments, including workspace files and selected diff lines, use the `@pierre/trees` built-in file icon resolver so their icons follow the same extension-aware language and file-type treatment as the file tree.

Inline selected diff line attachments are removed by deleting their prompt chip. The diff comment composer returns to the `Add to Rudu` state when the matching inline chip no longer exists in the current prompt draft.

Adding a selected diff line attachment opens the Review Chat tab so the developer can see the inline chip that was inserted into the prompt.

Repeated clicks on `Add to Rudu` for the same selected diff range reuse the existing inline selected-diff chip. Different selected diff ranges may appear as separate inline chips.

While the matching inline selected-diff chip exists in the prompt draft, the diff comment composer shows the action as `Added to Rudu` and disables that exact add action.

Sending a prompt clears inline selected-diff chips from the composer draft along with the prompt text. The sent developer message preserves those chips inline through user-message metadata, while the AI receives the same structured attachment summaries used for other Review Chat Attachments.

At minimum:

- `WorkspaceFileAttachment`
- `PullRequestAttachment`
- `IssueAttachment`
- `DiffLinesAttachment`

A shared wrapper may own common chip layout, keyboard focus, and removal behavior, but kind-specific rendering belongs in the kind-specific component file.

## Consequences

- Attachment-specific UI remains easy to change without growing `PromptComposer`.
- Provider-specific issue details can evolve inside `IssueAttachment`.
- Shared chip behavior must stay in a small common component to avoid duplicated keyboard and accessibility logic.
- The AI prompt path stays stable because inline ranges are display metadata; compact attachment summaries still come from the deduped Review Chat Attachment list.
