# Pi ACP Integration Research Report

## Answer

Rudu can simplify the review AI architecture by removing Cloudflare Worker-backed file access from the active path, but it should not remove `pi-acp` or the Rust ACP client/runtime layer.

The best migration is:

- keep `pi-acp` as the ACP stdio adapter
- keep Rudu's launcher wrapper while Rudu needs custom Pi flags, env, cwd, and extension loading
- keep `--no-builtin-tools`
- replace Worker-backed Pi tools with local Review Workspace-backed tools
- point ACP `session/new` at the local Review Workspace cwd
- remove Worker setup, pairing, hydration, and Worker read/list APIs from the active chat path

## Source Summary

- `pi-acp` speaks ACP JSON-RPC over stdio and spawns Pi in RPC mode.
- `PI_ACP_PI_COMMAND` overrides the Pi executable used by `pi-acp`, but Rudu still needs a wrapper if it wants to pass custom Pi flags and extension paths.
- ACP already provides session setup, prompt turns, updates, tool calls, permission requests, and cancellation; Rudu should keep using it as the app-to-agent transport.
- Pi extensions can register custom tools and inject per-turn review policy through `before_agent_start`.
- The local Review Workspace can replace the Cloudflare file API without changing ACP.

## What Can Go

- Cloudflare Worker setup UI and pairing from the chat path
- Worker config gating for AI chat
- Worker session prepare/hydrate/read/list dependencies
- Worker-specific environment variables in the Pi extension
- Worker-specific prompt copy

## What Should Stay

- Rust ACP client/runtime registry
- app-level `turnId`
- Tauri event stream
- AI SDK chat transport in TypeScript
- `pi-acp`
- launcher wrapper seam
- Rudu custom Pi extension
- `--no-builtin-tools` plus explicit tool allowlist
- report file capture

## Design Implication

The migration is not "Rudu becomes a direct Pi RPC client." It remains:

```text
Rudu UI
  -> Tauri Rust ACP client
  -> pi-acp
  -> pi --mode rpc
  -> Rudu Review Workspace tools
```

Only the backing store changes:

```text
Before:
  Pi read/ls tools -> Cloudflare Worker -> GitHub API

After:
  Pi read/ls tools -> local Review Workspace filesystem
```

## Sources

- https://github.com/svkozak/pi-acp
- https://pi.dev/docs/latest/extensions
- https://pi.dev/docs/latest/rpc
- https://agentclientprotocol.com/protocol/overview
- https://agentclientprotocol.com/protocol/session-setup
- https://agentclientprotocol.com/protocol/prompt-turn
- https://agentclientprotocol.com/protocol/tool-calls
- Local findings:
  - `findings_pi_acp_adapter.md`
  - `findings_acp_capabilities.md`
  - `findings_pi_tools.md`
