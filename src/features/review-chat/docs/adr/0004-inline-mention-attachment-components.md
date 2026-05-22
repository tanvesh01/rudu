# ADR 0004: Inline Mention Attachment Components

## Status

Accepted

## Context

Review Chat supports explicit prompt context through Review Chat Attachments. Mention-created attachments now need to render inline in the prompt composer as compact chips, while non-mention context such as selected diff line ranges may still render in the composer attachment area.

The attachment kinds have different labels, icons, provider metadata, and future interactions. Putting all rendering into one generic component would make the prompt composer grow around every attachment type.

Sent developer messages need to preserve the same inline mention affordance. The structured attachment metadata sent to the AI remains separate from display metadata, so the transcript can render inline chips without changing the compact context summaries used in the upstream prompt.

## Decision

Rudu will implement inline mention attachment rendering with separate focused component files per attachment kind.

Rudu will use `lexical-beautiful-mentions` for the first implementation of Lexical mention detection, typeahead, inline mention nodes, and metadata serialization. Rudu still owns the Review Chat Attachment model and converts mention node metadata into Rudu attachment objects before sending a prompt.

Rudu will store UI-only inline attachment ranges in the user message metadata so sent developer messages can render mention-created attachments in their original text positions. Non-mention attachments, such as selected diff line ranges, continue to render in the attachment strip.

At minimum:

- `WorkspaceFileAttachment`
- `PullRequestAttachment`
- `IssueAttachment`

A shared wrapper may own common chip layout, keyboard focus, and removal behavior, but kind-specific rendering belongs in the kind-specific component file.

## Consequences

- Attachment-specific UI remains easy to change without growing `PromptComposer`.
- Provider-specific issue details can evolve inside `IssueAttachment`.
- Shared chip behavior must stay in a small common component to avoid duplicated keyboard and accessibility logic.
- The AI prompt path stays stable because inline ranges are display metadata; compact attachment summaries still come from the deduped Review Chat Attachment list.
