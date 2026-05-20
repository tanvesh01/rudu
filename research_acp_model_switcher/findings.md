# ACP model switcher findings

## Current Rudu runtime

- Rudu starts one `codex-acp` process per Review Chat runtime from `src-tauri/src/services/review_session/acp.rs`.
- The current command only passes static config: `sandbox_mode=read-only`, `approval_policy=on-request`, `hide_agent_reasoning=false`, and `model_reasoning_summary="auto"`.
- Rudu persists the ACP session id on the Review Session and uses `session/load` for continuity.
- The installed `agent-client-protocol` dependency exposes `session/set_config_option`; model-specific `session/set_model` is behind the `unstable_session_model` feature.
- The current app does not read `NewSessionResponse.models` or `config_options`.
- `codex-acp@0.14.0` implements `session/set_config_option`; its source maps `config_id="model"` to the Codex model and `config_id="reasoning_effort"` to Codex reasoning effort.

## ACP and Codex facts

- ACP session setup says sessions have a unique id and can be prompted, loaded, resumed, or closed depending on capabilities; the `cwd` is the session filesystem context and should bound filesystem tool operations.
- ACP docs say initial mode/model/session configuration state may appear in session setup responses when supported.
- ACP Session Config Options are now the preferred protocol-level selector mechanism. Agents may expose model/mode/thought-level selectors in `configOptions`, and clients can call `session/set_config_option`.
- ACP docs say a config option can be changed while the agent is idle or generating, but Rudu's product rule is stricter: active turns keep their original Review Effort Mode and changes apply to the next turn.
- ACP Session Modes still exist, but docs say config options supersede modes and modes will be removed later.
- `@zed-industries/codex-acp@0.14.0` supports `-c key=value` config overrides and wraps Codex CLI.
- The local `codex-acp --help` confirms `-c key=value` overrides `~/.codex/config.toml`.
- `codex-acp` public README documents auth, MCP, slash commands, and basic launch, but does not document model switching semantics.
- Official Codex CLI docs support model override via `--model` / `-m` and config key `model`; Codex config docs also document `model_reasoning_effort`.

## OpenAI/Codex model facts

- Codex docs recommend `gpt-5.5` for complex coding/research workflows and `gpt-5.4-mini` for faster/lower-cost lighter coding or subagents.
- Codex docs list `gpt-5.3-codex-spark` as a text-only research preview optimized for near-instant coding iteration and available to ChatGPT Pro users, but Rudu is intentionally leaving Spark out of v1.
- Codex CLI supports `-m/--model`, and the shared `config.toml` supports `model = "..."`.
- During an active Codex CLI thread, the CLI can use `/model` to switch model, but Rudu should not rely on hidden slash-command behavior as the primary app state mechanism.
- Codex speed mode is different from Spark. Fast mode speeds up supported models at higher credit rates; Spark is its own model choice with its own limits. Rudu's v1 Fast mode should mean `gpt-5.4-mini`, not Codex Speed mode or Spark.

## Subscription and pricing facts

- Codex is included with ChatGPT Plus, Pro, Business, and Enterprise/Edu plans; Codex Free/Go inclusion is currently described as limited-time.
- Codex token-based credit pricing applies across Plus, Pro, Business, Enterprise, Edu, Health, and Gov plans, with a small subset of Enterprise customers possibly still on legacy pricing.
- Current Codex rate card credits per 1M tokens:
  - GPT-5.5: 125 input, 12.50 cached input, 750 output credits.
  - GPT-5.4-Mini: 18.75 input, 1.875 cached input, 113 output credits.
  - GPT-5.3-Codex-Spark: research preview, rates not final. Excluded from Rudu v1.
- OpenAI API pricing is separate from ChatGPT/Codex credits. Standard API pricing lists `gpt-5.5` at $5 input / $0.50 cached / $30 output per 1M tokens and `gpt-5.4-mini` at $0.75 / $0.075 / $4.50.
- `codex-acp` README says auth can be ChatGPT subscription, `CODEX_API_KEY`, or `OPENAI_API_KEY`; its ChatGPT subscription auth requires paid subscription and does not work in remote projects.

## Recommended Rudu shape

- Treat the two choices as **Review Effort Modes**, not as a generic provider switcher.
- Store the selected mode as per-Review Session state, not as prompt text or a global app preference.
- Before implementing the switcher, fix Review Chat continuity so the visible transcript is restored for the same Review Session across URL changes and app restarts.
- Use the existing SQLite app database for durable Review Chat transcript and Review Effort Mode state instead of adding a separate `chat.jsonl` artifact.
- Map modes to static Codex config:
  - Fast: default mode, `model="gpt-5.4-mini"`, `model_reasoning_effort="medium"` or repo default.
  - Deep: `model="gpt-5.5"`, `model_reasoning_effort="high"`.
- Show primary labels as Fast and Deep, with model details as secondary text or tooltip.
- Order the selector Fast first, Deep second.
- Reuse the existing composer-side `PromptModeToggle` beside Send as the Review Effort Mode selector. Rename its local `processor` / `lightning` state to Fast / Deep and wire it to Review Session state instead of component-local state.
- If the mode changes while a runtime is active and no turn is active, send ACP `session/set_config_option` before the next developer prompt:
  - `model = gpt-5.4-mini`, `reasoning_effort = low` for Fast
  - `model = gpt-5.5`, `reasoning_effort = high` for Deep
- If a turn is active, accept the selection as a pending mode only; the active turn continues on its original model, and Rudu applies the pending mode before the next developer prompt.
- Mode changes preserve the same Review Chat transcript and ACP session identity.
- Use ACP `session/set_config_option` for v1; keep restart/load only as a fallback if a future `codex-acp` version regresses config option support.

## Continuity correction

- Backend Review Session identity is stable by repository and pull request number, and `prepare_workspace` copies `agent_session_id` from previous metadata.
- Backend runtime startup can load an existing ACP session when `agent_session_id` is present, but the current code deliberately drops that id when session-scoped MCP servers are enabled.
- Frontend `useChat` state is currently in-memory; switching URLs or remounting the Review Chat panel can lose the visible transcript even when the backend ACP session is still alive.
- The repo already has `cache.sqlite` as a local SQLite store for app-owned persistence. It should be treated as the App Database for Review Chat continuity, not just as a patch/list cache.
- Persist completed Review Chat state: user prompts, explicit attachments, assistant Final Answers, compact turn activity metadata, Revision Checkpoints, timestamps, turn ids, and effort mode used.
- Do not persist raw streaming deltas as primary transcript rows. Active streaming stays in memory until completion.
- Hidden context/mode/revision notices may be stored as internal events if useful, but they must not render as visible transcript messages.
- Keep Review Chat transcript history indefinitely while the pull request remains tracked. Archiving/untracking a pull request should delete its Review Chat transcript.
- Revision changes stay in one continuous transcript with checkpoint-style dividers. AI Elements' Checkpoint component is a suitable frontend primitive, but Rudu should use it as an informational divider rather than a restore/branch control.
- Review Effort Mode changes should create lighter visible timeline markers, for example "Rudu switched to Deep for future turns"; these are not user or assistant messages.
- The product requirement is stronger: opening Review Chat for an existing Review Session must restore the same visible transcript and must not feel like a new chat.

## Sources

- https://agentclientprotocol.com/protocol/session-setup
- https://agentclientprotocol.com/rfds/session-config-options
- https://developers.openai.com/codex/models
- https://developers.openai.com/codex/cli/reference
- https://developers.openai.com/codex/speed
- https://developers.openai.com/api/docs/models
- https://developers.openai.com/api/docs/pricing
- https://help.openai.com/en/articles/11369540-using-codex-with-your-chatgpt-plan/
- https://help.openai.com/en/articles/20001106
- https://elements.ai-sdk.dev/components/checkpoint
