# Findings: OSS visibility over ACP with Codex

## ACP-native visibility

- ACP itself already has app-visible events: `session/update` carries message chunks, thought chunks, tool calls/tool updates, plans, commands, and mode changes.
- ACP tool calls include human-facing title, kind, status, content, locations, raw input, and raw output. That is enough for a live debug/event timeline.
- ACP plans are also reported through `session/update`, so an ACP client can expose progress without relying on model prose.
- `codex-acp` is the current Zed-maintained adapter for Codex. It supports tool calls, permission requests, edit review, TODO lists, context mentions, images, slash commands, and client MCP servers.

Sources:
- https://agentclientprotocol.com/protocol/overview
- https://agentclientprotocol.com/protocol/tool-calls
- https://agentclientprotocol.com/protocol/agent-plan
- https://github.com/zed-industries/codex-acp

## ACP-specific OSS tools

- `ACP UI` is the closest off-the-shelf OSS visibility tool found. It is an MIT-licensed cross-platform ACP client with Codex configured via `@zed-industries/codex-acp`. It advertises tool-call visualization, collapsible agent thinking, permission controls, and a traffic monitor for inspecting ACP protocol messages in real time.
- `acpx` is an OSS headless CLI client for ACP. It is useful for testing / scripting Codex ACP sessions without a full IDE, but it appears more like a client harness than an observability dashboard.
- The official ACP clients list includes ACP UI, acpx, Zed, VS Code ACP client, etc. Most are clients, not telemetry backends.

Sources:
- https://github.com/formulahendry/acp-ui
- https://github.com/openclaw/acpx
- https://agentclientprotocol.com/get-started/clients

## Generic OSS observability stacks

- Langfuse is OSS and can trace LLM calls, tool invocations, retrieval steps, cost, latency, and metadata. It is useful if Rudu emits OpenTelemetry or uses a supported SDK, but it will not automatically understand ACP stdio unless we translate/export events.
- OpenTelemetry now has GenAI agent/tool span conventions. Its docs show `invoke_agent`, child chat spans, and `execute_tool` spans, including optional structured prompts/messages/tool calls when content capture is enabled.
- ACP has a draft Agent Telemetry Export RFD proposing exactly this direction: clients run a local OTLP receiver and inject standard `OTEL_EXPORTER_*` env vars into agent subprocesses, while keeping telemetry out of the ACP stdio channel.
- ACP also has a draft `_meta` propagation convention for trace/correlation IDs.

Sources:
- https://langfuse.com/
- https://opentelemetry.io/docs/specs/semconv/gen-ai/gen-ai-agent-spans/
- https://opentelemetry.io/blog/2026/genai-observability/
- https://zed-685ed6d6.mintlify.app/rfds/agent-telemetry-export
- https://agentclientprotocol.com/rfds/meta-propagation

## Fit for Rudu/Yangon

- Prior local context says Rudu already translates ACP notifications into review-chat events, and that reasoning/tool updates exist at the protocol layer but recent visibility work was not runtime-validated.
- Best near-term fit is ACP UI as a protocol/debug reference, not as the product UI.
- Best product architecture is: keep Rudu's in-app activity timeline from ACP events, optionally mirror events into OTLP/Langfuse later for persistent trace browsing.
