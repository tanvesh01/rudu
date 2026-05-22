# Generate Review Walkthroughs with Codex exec schema output

Rudu will generate v1 Review Walkthroughs through a sidecar `codex exec --output-schema` call instead of the live ACP Review Chat turn. The walkthrough is still displayed in Review Chat as the assistant response to a Review Chat Command, but generation uses Codex exec because the ChainOfThought-style UI needs structured groups, file references, actions, and review scope values that should be schema-constrained rather than parsed from prose.

Normal Review Chat messages remain on the ACP runtime. The sidecar walkthrough generator runs against the same Review Workspace in an inspection-only mode and should receive only the compact context needed to produce the walkthrough, not arbitrary chat history.
