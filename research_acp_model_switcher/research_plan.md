# ACP model switcher research plan

## Main question

How should Rudu add a small Codex ACP model switcher with exactly two modes: Fast on GPT-5.4 Mini and Deep on GPT-5.5 High?

## Subtopics

1. ACP and `codex-acp` configuration surface
   - Confirm whether model and reasoning can be passed through adapter config.
   - Identify whether changing a mode requires restarting/loading the ACP runtime.

2. OpenAI model and subscription availability
   - Verify current OpenAI/Codex model availability and auth boundaries.
   - Identify how paid ChatGPT subscription auth differs from API-key auth in `codex-acp`.

3. Rudu domain fit
   - Map the switcher into Review Chat language, Review Session continuity, and Inspection-Only Review.
   - Decide what belongs in glossary versus ADR.

## Synthesis

Use official docs where available, then reconcile them with current `src-tauri/src/services/review_session/acp.rs`, `src/features/review-chat/CONTEXT.md`, and ADR 0003. The output should be a recommended product/implementation shape plus the first unresolved design question.
