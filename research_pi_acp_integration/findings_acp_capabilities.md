# ACP Capabilities Relevant To Rudu/Pi

Date: 2026-05-16

Searches used: 3 web searches, plus direct opens of official ACP docs/source URLs and the local installed SDK/package sources.

## Primary Sources

- ACP overview: https://agentclientprotocol.com/protocol/overview
- ACP session setup: https://agentclientprotocol.com/protocol/session-setup
- ACP prompt turn and cancellation: https://agentclientprotocol.com/protocol/prompt-turn
- ACP tool calls and permission requests: https://agentclientprotocol.com/protocol/tool-calls
- ACP schema: https://agentclientprotocol.com/protocol/schema
- ACP TypeScript SDK typed docs: https://agentclientprotocol.github.io/typescript-sdk/classes/ClientSideConnection.html
- ACP TypeScript SDK source: https://github.com/agentclientprotocol/typescript-sdk/blob/main/src/acp.ts
- ACP Rust SDK source: https://github.com/agentclientprotocol/rust-sdk
- pi-acp source/README: https://github.com/svkozak/pi-acp
- Local installed sources inspected:
  - `agent-client-protocol = 0.11.1`
  - `agent-client-protocol-tokio = 0.11.1`
  - `@agentclientprotocol/sdk = 0.12.0`
  - `pi-acp = 0.0.27`
  - `@earendil-works/pi-coding-agent = 0.74.0`

## Protocol Capabilities

ACP is JSON-RPC 2.0 over a transport such as stdio. The expected flow is:

1. `initialize`
2. `session/new` or, if supported, `session/load` / `session/resume`
3. `session/prompt`
4. streaming `session/update` notifications from agent to client
5. `session/prompt` response with a stop reason

`session/new` takes an absolute `cwd` and a list of MCP servers, then returns a protocol session id. The local Rust SDK constructor Rudu uses, `NewSessionRequest::new(session_dir)`, sets `cwd` and leaves `mcp_servers` empty. That matches Rudu's current usage because `pi-acp` explicitly accepts MCP server params but does not wire them through to Pi.

`session/prompt` takes a session id plus `ContentBlock[]`. Baseline text prompts are enough for Rudu's current chat path. Embedded resources are capability-gated; `pi-acp` only advertises embedded context when `PI_ACP_ENABLE_EMBEDDED_CONTEXT=true`.

`session/update` already has the event vocabulary Rudu needs:

- `agent_message_chunk`
- `agent_thought_chunk`
- `tool_call`
- `tool_call_update`
- `plan`
- `available_commands_update`
- `current_mode_update`
- `config_option_update`
- `session_info_update`
- unstable `usage_update` in newer schema/builds

Tool calls are not a side channel. They are first-class `session/update` payloads. `tool_call_update` only requires `toolCallId`; status, title, kind, content, locations, raw input, and raw output are optional patch fields. Tool status values are `pending`, `in_progress`, `completed`, and `failed`.

Permission requests are agent-to-client requests through `session/request_permission`. The request includes `sessionId`, a `toolCall` update, and a list of permission options. The client responds with either `selected` plus an `optionId`, or `cancelled`. The docs explicitly allow clients to auto-allow or auto-reject based on user settings, but if a turn is cancelled, pending permission requests must receive the `cancelled` outcome.

Cancellation is a client-to-agent notification: `session/cancel`. The client should mark non-finished tool calls in the current turn as cancelled, respond to pending permission requests with `cancelled`, and keep accepting late `session/update` notifications until the original `session/prompt` resolves. The agent should stop model/tool work and return `stopReason: "cancelled"` rather than surfacing cancellation as an error.

## pi-acp Behavior

The installed `pi-acp@0.0.27` README says it speaks ACP JSON-RPC over stdio and spawns `pi --mode rpc`. It maps Pi assistant output to ACP `agent_message_chunk` and maps Pi tool execution to ACP `tool_call` / `tool_call_update`.

The installed package and upstream source show more detail:

- `initialize` advertises `loadSession: true`, no ACP fs/terminal delegation, image prompt support, optional embedded context, and a session-list capability used by Zed.
- `newSession` requires absolute `cwd`, creates a Pi RPC session, stores the ACP/Pi session mapping, and emits `available_commands_update`.
- `prompt` converts ACP content blocks into a Pi message, handles a subset of slash commands adapter-side, then resolves with an ACP stop reason.
- `cancel` calls the Pi session cancellation path.
- tool events are already translated by `pi-acp` into `agent_message_chunk`, `agent_thought_chunk`, `tool_call`, and `tool_call_update`, including `rawInput`, `rawOutput`, locations, and structured diffs for edits where possible.

Important limitation: `pi-acp` does not delegate ACP `fs/*` or `terminal/*` calls to the client, and it does not wire MCP servers through to Pi. Pi reads/writes and runs tools locally in the process cwd.

## Rudu Current Layer

Rudu's Rust layer already uses the Rust ACP SDK to act as the ACP client:

- `initialize_agent` sends `InitializeRequest::new(ProtocolVersion::V1)`.
- `create_session` sends `NewSessionRequest::new(session_dir)`.
- one-shot review uses `PromptRequest::new(acp_session_id, vec![prompt.into()])`.
- AI chat uses `PromptRequest::new(acp_session_id, vec![ContentBlock::Text(TextContent::new(text))])`.
- cancellation sends `CancelNotification::new(acp_session_id)`.
- permission handling currently auto-selects the first offered option, or returns `Cancelled` if there are no options.
- Rudu maps ACP `SessionUpdate` into custom `RemoteReviewAgentEvent` and `RemoteReviewChatEvent` enums, then the frontend maps chat events again into AI SDK `UIMessageChunk`s.

The wrapper script in `prepare_pi_acp_launcher` still has a concrete purpose: the Rust `AcpAgent` spawn helper supports command, args, and env, but not a child working directory. Rudu uses the script to `cd` into the session directory, set `PI_ACP_PI_COMMAND`, set `PI_SKIP_VERSION_CHECK`, and exec `pi-acp`.

## Simplification Findings

Rudu can simplify the event translation layer, but should not delete the ACP client/runtime layer.

What can simplify:

- Replace the two custom Rust event enums with one thin serializable envelope around the ACP update, e.g. `{ ruduSessionId, turnId?, acpSessionId, update }`, plus explicit `finished` / `error` events for prompt response and transport failures.
- Preserve ACP fields that are currently dropped: tool `content`, `locations`, `kind`, `rawInput`, `rawOutput`, `available_commands_update`, `session_info_update`, and mode/config updates. This lets the frontend decide what to render instead of hard-coding a lossy Rust projection.
- Share one update-mapping path for one-shot review and AI chat. The current `agent_event_from_update` and `chat_event_from_update` are mostly duplicate pattern matches.
- Keep AI SDK chunk mapping in TypeScript. That is a UI transport concern, not a Rust ACP concern.
- Change permission handling from "always first option" to an explicit policy. For read-only review sessions this could be "auto-allow read-only known tools and reject/ask for everything else." Long-term, surface `session/request_permission` to the UI.
- Improve cancellation semantics: after frontend abort, Rudu can still consume the ACP turn result and emit a final cancelled/error event for consistency, instead of closing the frontend stream immediately and losing the protocol stop reason.

What should stay:

- The Rust ACP client connection to `pi-acp`.
- The runtime registry keyed by Rudu session id.
- The app-level `turnId`. ACP stable fields identify the ACP session, not each prompt turn. Rudu needs a UI turn id to filter Tauri events, especially because current Rust SDK usage does not enable the unstable message-id feature.
- The launcher script, unless Rudu stops using `AcpAgent` or upstream adds cwd support. Environment variables alone are not enough because `pi-acp`/Pi must run from the review workspace cwd.
- The local Review Workspace preparation and Pi extension/tool setup. ACP is the agent-client protocol; it does not replace Pi's local tool runtime in this adapter.

## Practical Recommendation

The best simplification is not "remove translation entirely." It is "make translation non-lossy and protocol-shaped."

Recommended next shape:

```ts
type RuduAcpEvent =
  | { kind: "update"; ruduSessionId: string; turnId?: string; acpSessionId: string; update: SessionUpdate }
  | { kind: "finished"; ruduSessionId: string; turnId?: string; stopReason: StopReason }
  | { kind: "permission"; ruduSessionId: string; request: RequestPermissionRequest }
  | { kind: "error"; ruduSessionId: string; turnId?: string; message: string };
```

Then TypeScript can map `update.sessionUpdate` directly to the AI SDK chunks or the review activity UI. That removes the duplicate Rust projection while keeping the necessary Tauri boundary and UI turn filtering.

For the Review Workspace migration specifically: once context comes from local workspaces, Rudu can delete Worker-token/file-API-specific Pi tool plumbing, but ACP itself does not need to change. `session/new` should point at the local Review Workspace cwd, and `PI_ACP_PI_COMMAND` can launch Pi with whichever local extension/tool script Rudu still needs.
