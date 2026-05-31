# Generate Review Walkthroughs with Runtime-Specific Output

Rudu will generate v1 Review Walkthroughs through a sidecar generator instead of the live ACP Review Chat turn. The walkthrough is still displayed in Review Chat as the assistant response to a Review Chat Command, but generation uses runtime-specific output handling because the UI needs structured groups, file references, actions, and review scope values.

Normal Review Chat messages remain on the ACP runtime. The sidecar walkthrough generator runs against the same Review Workspace in an inspection-only mode and should receive only the compact context needed to produce the walkthrough, not arbitrary chat history.

Codex-backed Review Sessions use `codex exec --output-schema`. OpenCode-backed Review Sessions use OpenCode's session prompt API with the selected OpenCode model, ask for plain text JSON, parse and validate the response locally, and run one repair retry when the first output cannot be parsed or deserialized. Rudu must not silently fall back to Codex when OpenCode is selected.
