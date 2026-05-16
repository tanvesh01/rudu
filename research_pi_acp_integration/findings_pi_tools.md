# Pi Tool Extension Findings

Research date: 2026-05-16

Search budget used: 5 web search queries, then direct opens of primary source URLs and local installed package files.

## Primary Sources

- Pi extension docs: https://pi.dev/docs/latest/extensions
- Pi CLI usage docs: https://pi.dev/docs/latest/usage
- Pi RPC docs: https://pi.dev/docs/latest/rpc
- Pi ACP adapter README/source: https://github.com/svkozak/pi-acp
- ACP introduction: https://agentclientprotocol.com/get-started/introduction
- ACP session setup: https://agentclientprotocol.com/protocol/session-setup
- ACP filesystem methods: https://agentclientprotocol.com/protocol/file-system
- ACP terminal methods: https://agentclientprotocol.com/protocol/terminals

Local package evidence in this checkout:

- `package.json` pins `@earendil-works/pi-coding-agent` to `0.74.0` and `pi-acp` to `0.0.27`.
- `node_modules/pi-acp/README.md` matches the upstream adapter model: ACP stdio server that spawns `pi --mode rpc`.
- `node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/types.d.ts` exposes the current `ExtensionAPI`, `ToolDefinition`, `before_agent_start`, and active-tool APIs.

## Summary

Rudu can replace Worker-backed read/list/report tools with local Review Workspace-backed Pi extension tools without changing ACP. ACP already carries the session `cwd`, and `pi-acp` already runs local Pi behind the ACP boundary. The change is inside Rudu's Pi launch/extension layer: point Pi at a Review Workspace, keep built-in mutating/execution tools disabled, and register a small local inspection/report tool set.

The ACP layer should remain the app-to-agent transport and event stream. It does not need new Rudu-specific protocol methods for file reads, file listing, or report capture.

## Current Pi Tool Model

Pi extensions are TypeScript modules loaded from `~/.pi/agent/extensions`, `.pi/extensions`, settings, or `-e/--extension`. They can register tools, commands, events, custom UI, providers, and renderers. The docs explicitly call custom tools "callable by the LLM" through `pi.registerTool()`.

`pi.registerTool(definition)` takes a tool definition with:

- `name`, `label`, and `description`.
- TypeBox `parameters`.
- Optional prompt metadata: `promptSnippet` and `promptGuidelines`.
- Optional `prepareArguments`.
- `execute(toolCallId, params, signal, onUpdate, ctx)`, returning text content and details.
- Optional renderers for call/result UI.

Pi's documented built-in tools are `read`, `bash`, `edit`, `write`, `grep`, `find`, and `ls`. Extensions can override built-ins by registering the same tool name. Pi also supports `--no-builtin-tools`, which disables built-ins while keeping extension tools enabled; `--no-tools` disables all tools.

The local installed types also expose:

- `pi.getActiveTools()`
- `pi.getAllTools()`
- `pi.setActiveTools(names)`

So there are two usable controls:

1. Start Pi with built-ins disabled and only register Rudu's extension tools.
2. Keep built-ins loaded but narrow the active tool list.

For Rudu's inspection-only review mode, option 1 is the stronger baseline because `bash`, `edit`, and `write` never enter the active built-in tool set.

## `before_agent_start`

`before_agent_start` fires after the user prompt is submitted and before the agent loop begins. The event includes the raw prompt, images, the chained `systemPrompt`, and `systemPromptOptions`, including selected tools, tool snippets, cwd, context files, and skills. A handler can return:

- A persistent injected message stored in the session and sent to the model.
- A modified system prompt for that turn.

Rudu's current extension already uses this correctly for review-mode policy injection. For the Review Workspace migration, the same hook should change from Worker language to local workspace language:

- Say the active context is a local Rudu-managed Review Workspace.
- Say the review is inspection-only.
- Tell the agent to use Rudu's local read/list/diff/report tools.
- Explicitly forbid project commands and file mutation.

This remains prompt policy, not the only safety boundary. The real enforcement should stay in the tool set by disabling built-ins and exposing only local read/list/report-style tools.

## `pi-acp` Launch Model

`pi-acp` is a local ACP adapter. Its README says it communicates ACP JSON-RPC 2.0 over stdio to the client and spawns `pi --mode rpc`, bridging Pi events into ACP events.

The installed `pi-acp@0.0.27` code does the same: it spawns the Pi command with `--mode rpc --no-themes`, using `process.env.PI_ACP_PI_COMMAND` when provided. It also passes `process.env` through to the child.

Rudu already uses the right seam:

- `src-tauri/src/services/remote_review/acp.rs` writes a `run-pi-acp.sh` launcher.
- That launcher sets `PI_ACP_PI_COMMAND` to Rudu's `run-pi-review.sh`.
- `src-tauri/src/services/remote_review/pi.rs` writes `run-pi-review.sh`.
- The wrapper executes Pi with `--no-builtin-tools`, `--tools read,ls,get_pr_diff,get_changed_files,save_remote_review_report`, and `-e "$EXTENSION"`, then passes through `"$@"` from `pi-acp`.

That means Rudu can keep using ACP while controlling Pi's tool model through the wrapper. No ACP fork is needed.

## ACP Implications

ACP already has the concepts Rudu needs:

- ACP supports local agents as editor subprocesses over JSON-RPC stdio.
- `session/new` includes `cwd`.
- ACP says `cwd` is the filesystem context for the session, must be absolute, must be used regardless of where the agent subprocess was spawned, and should serve as a boundary for filesystem tool operations.

ACP also defines optional client-side `fs/*` and `terminal/*` methods. However, `pi-acp` explicitly does not implement ACP filesystem delegation or ACP terminal delegation; Pi reads, writes, and executes locally. That is fine for Rudu's desired shape. Rudu does not need ACP `fs/read_text_file`, `fs/write_text_file`, or `terminal/create` to replace the Worker file API.

The practical consequence: Rudu should treat ACP as transport and UI/event protocol, not as the file API. Review Workspace access should live in Pi extension tools or Pi's local tool factories.

## Replacing Worker-Backed Tools

Rudu's current extension registers:

- `read`: calls Worker `/file`.
- `ls`: calls Worker `/files`.
- `get_pr_diff`: reads a local captured diff file.
- `get_changed_files`: reads a local captured changed-files file.
- `save_remote_review_report`: writes a local report file.
- `before_agent_start`: injects Worker-backed review instructions.

The local Review Workspace replacement can preserve this same model and names:

- `read`: read from the Review Workspace filesystem.
- `ls`: list from the Review Workspace filesystem.
- `get_pr_diff`: read a Rudu-generated local diff snapshot, or read a snapshot stored near the Review Session.
- `get_changed_files`: read a Rudu-generated local changed-files snapshot.
- `save_remote_review_report`: write only to the Rudu-owned report path.

The tools should validate paths by resolving them against a single root and rejecting paths outside the Review Workspace. Prefer `ctx.cwd` as the root if the ACP session cwd is changed to the Review Workspace. If Rudu keeps ACP cwd as a session metadata directory, pass an explicit `RUDU_REVIEW_WORKSPACE_PATH` env var and validate against that.

Output truncation should stay. Pi docs say tools must truncate large output, and the current extension already caps text at 50 KB.

## Should Built-In Tools Stay Disabled?

Yes for the first Review Workspace migration.

If built-ins stay enabled, Pi's `bash`, `edit`, and `write` remain part of the possible tool surface unless they are separately removed with `setActiveTools()` or `--tools`. The current wrapper's `--no-builtin-tools` plus an explicit `--tools` allowlist matches the inspection-only product rule better.

If later Rudu wants richer local read-only code navigation, there are two reasonable options:

- Add custom local `grep` and `find` tools to the Rudu extension.
- Use Pi's exported read-only tool factories from the SDK, but still register only read-only tools and keep `bash`, `edit`, and `write` out.

Do not rely only on `before_agent_start` wording to prevent command execution or mutation.

## Can Review Workspace Replace Worker Tools Without ACP Changes?

Yes.

The cleanest path is:

1. Create/update the local Review Workspace before starting the ACP session.
2. Use the Review Workspace absolute path as the ACP session `cwd`, or pass it explicitly to the extension and keep path validation strict.
3. Keep the existing `pi-acp` wrapper approach with `PI_ACP_PI_COMMAND`.
4. Keep `--no-builtin-tools`.
5. Register local read/list/diff/changed-files/report tools.
6. Update `before_agent_start` copy from "Worker-indexed GitHub file tree" to "local Rudu-managed Review Workspace".
7. Delete Worker file-list/read/report-status dependencies after the local tools cover the same behavior.

ACP still only sees ordinary session updates and tool-call updates. The event translation layer does not need to understand whether a Pi tool read a Worker endpoint or a local worktree path.

## What Can Be Simplified

Likely deletable after local tools land:

- Worker file read/list endpoints for Pi review inspection.
- Worker-issued read token plumbing used only by Pi tools.
- Worker-specific prompt text and env vars in `pi_extension.ts`.
- Hydration paths whose only purpose was to make Worker file tools usable.

Should stay:

- `pi-acp` stdio launch and Rudu's ACP event bridge.
- The Pi wrapper script seam, because it is how Rudu passes `--no-builtin-tools`, `--tools`, `-e`, env vars, and the report/diff paths while still satisfying `pi-acp`'s `pi --mode rpc` launch.
- Report file capture unless/until Rudu adds a structured ACP-side result channel.
- Permission-response handling in the ACP client. It remains part of the ACP runtime even if the exposed Pi tools are read-only.

## Recommendation

Keep ACP unchanged. Change the Pi extension and session cwd/rooting.

For v1, implement a local `rudu-review-workspace-extension.ts` with the same tool names and result shapes where practical. Use `ctx.cwd` as the Review Workspace root if possible, block path escapes, keep truncation, and retain the final report tool. This gives Rudu the local-workspace architecture while preserving the existing ACP transport, frontend event rendering, and chat/runtime code.
