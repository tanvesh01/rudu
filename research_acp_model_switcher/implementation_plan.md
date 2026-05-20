# Review Chat persistence and Review Effort Mode plan

## Decisions

- Build persistence before wiring the Fast/Deep selector.
- Use the existing SQLite app database, not `chat.jsonl`, for durable Review Chat state.
- Keep one Review Session per repository and pull request number.
- Opening the Review Chat URL for an existing Review Session restores the same visible transcript.
- Revision changes stay in one continuous transcript with Revision Checkpoints.
- Review Effort Mode changes stay in the same transcript and create lighter Review Effort Markers.
- Review Effort Mode is per Review Session.
- Fast is the default mode and appears first in the selector.
- Deep is the second mode.
- Spark is out of v1.
- The existing `PromptModeToggle` beside Send is the UI hook point.
- Active streaming stays in memory; completed turns are persisted.
- If the user changes mode while a turn is active, the active turn keeps its original model and the selected mode applies before the next developer prompt.
- Archiving or untracking a pull request deletes that pull request's Review Chat transcript.

## Phase 1: SQLite continuity foundation

1. Rename the mental model from cache-only storage to App Database in code where useful, without broad churn.
2. Add SQLite schema for Review Sessions and Review Chat transcript:
   - `review_sessions`
   - `review_chat_messages`
   - `review_chat_timeline_events` or equivalent for Revision Checkpoints and Review Effort Markers
3. Migrate existing `session.json` fields into SQLite-compatible read/write paths:
   - repo
   - PR number
   - head SHA
   - workspace path
   - agent session id
   - agent context head SHA
   - status
   - active Review Effort Mode
   - pending Review Effort Mode
4. Keep `session.json` as workspace metadata only if needed during transition.
5. Add Tauri commands to load the Review Chat transcript for a Review Session.
6. Persist completed user/assistant turns and compact activity metadata after each turn finishes.
7. Load persisted messages into `useChat({ messages })` when Review Chat mounts.
8. Make untrack/archive PR cascade-delete Review Session transcript rows.

## Phase 2: Revision checkpoints in persisted transcript

1. Persist Revision Checkpoints into the transcript timeline when Revision Refresh succeeds.
2. Render persisted Revision Checkpoints as checkpoint-style dividers.
3. Use AI Elements Checkpoint styling as the primitive, but not restore/branch behavior.

## Phase 3: Review Effort Mode state

1. Add Review Effort Mode types:
   - `fast`
   - `deep`
2. Persist active and pending effort mode per Review Session.
3. Add Tauri command to update Review Effort Mode for a Review Session.
4. If no turn is active:
   - update active mode immediately
   - send ACP `session/set_config_option` before the next prompt
   - send a hidden mode-change notice
   - persist a Review Effort Marker
5. If a turn is active:
   - store pending mode
   - leave the active turn unchanged
   - apply pending mode before the next prompt
   - persist a Review Effort Marker when it becomes active

## Phase 4: Connect existing selector

1. Rename `PromptModeToggle` state from `processor` / `lightning` to Review Effort Mode language.
2. Order options Fast, then Deep.
3. Use existing icons:
   - Lightning icon = Fast
   - Processor icon = Deep
4. Replace local `useState` with controlled props:
   - `value`
   - `pendingValue`
   - `onValueChange`
5. Surface secondary model context in tooltip/title:
   - Fast: GPT-5.4 Mini
   - Deep: GPT-5.5 High

## Phase 5: Codex ACP config

1. Use ACP `session/set_config_option`, not a runtime restart, for model changes.
2. Fast config option updates:
   - `config_id="model"`, `value="gpt-5.4-mini"`
   - `config_id="reasoning_effort"`, `value="low"`
3. Deep config option updates:
   - `config_id="model"`, `value="gpt-5.5"`
   - `config_id="reasoning_effort"`, `value="high"`
4. Keep `codex_acp_agent` startup safety config unchanged:
   - `sandbox_mode=read-only`
   - `approval_policy=on-request`
   - `hide_agent_reasoning=false`
   - `model_reasoning_summary="auto"`
5. Revisit the current `mcp_servers.is_empty()` branch that drops `agent_session_id`; it can break ACP session continuity when session-scoped MCP is enabled.
6. Keep restart/load with explicit Codex config as a fallback only if a future `codex-acp` version regresses config option support.

## Verification

- Focused Rust tests for session id stability, SQLite transcript persistence, mode state, pending mode application, and PR untrack cascade.
- Focused Bun tests for transcript hydration, checkpoint rendering, effort marker rendering, and controlled PromptModeToggle behavior.
- Run TypeScript checks only; do not run disallowed full build commands.
