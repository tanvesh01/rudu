# Pi ACP Adapter Findings

Checked on 2026-05-16. Search budget used: 4 web searches, plus local `node_modules`.

## Short Answer

`pi-acp` is the official ACP-facing adapter for Pi. A client launches `pi-acp` as the ACP agent process and talks ACP JSON-RPC 2.0 over the adapter process stdio. `pi-acp` then starts a separate Pi subprocess in RPC mode.

Rudu does not need wrapper scripts for ACP framing itself. It still needs a wrapper, or equivalent executable, when it wants to change how the inner Pi process starts: custom env, custom `pi` binary resolution, `-e <extension>`, `--tools ...`, `--no-builtin-tools`, or other Pi args. `PI_ACP_PI_COMMAND` is only the override for the Pi command executable that `pi-acp` spawns; `pi-acp` still appends its own RPC args.

## Current Published Version

- npm registry latest is `pi-acp@0.0.27`.
- This repo is pinned to the same version in `package.json` and `bun.lock`.

Source:
- https://registry.npmjs.org/pi-acp/latest
- https://www.npmjs.com/package/pi-acp

## How `pi-acp` Starts Pi

Current `pi-acp` source starts Pi with:

- command: `process.env.PI_ACP_PI_COMMAND` if set, otherwise platform default `pi` / `pi.cmd`
- args appended by the adapter: `--mode rpc --no-themes`
- if loading a previous session: also appends `--session <sessionPath>`
- cwd: ACP session cwd
- env: inherited `process.env`

This means `PI_ACP_PI_COMMAND` is not a general args string. On non-Windows it is passed to `child_process.spawn` as the executable path/name, with args supplied separately by `pi-acp`. If Rudu needs to pass extra Pi flags, the override should point at a wrapper executable/script that forwards `"$@"`.

Sources:
- https://github.com/svkozak/pi-acp/blob/main/README.md
- https://github.com/svkozak/pi-acp/blob/main/src/pi-rpc/process.ts
- https://github.com/svkozak/pi-acp/blob/main/src/pi-rpc/command.ts
- https://pi.dev/docs/latest/rpc

## Stdio / JSON-RPC Behavior

There are two stdio protocols in play:

- Client to `pi-acp`: ACP JSON-RPC 2.0 over stdio.
- `pi-acp` to Pi: Pi RPC JSONL over Pi subprocess stdin/stdout.

Pi's own RPC docs describe newline-delimited JSON commands on stdin, response objects, and streamed event objects on stdout. `pi-acp` translates that Pi event stream into ACP updates such as assistant message chunks and tool call updates.

Sources:
- https://github.com/svkozak/pi-acp/blob/main/README.md
- https://github.com/svkozak/pi-acp/blob/main/src/acp/agent.ts
- https://pi.dev/docs/latest/rpc
- https://agentclientprotocol.com/protocol/session-setup

## `quietStartup`

`quietStartup` is a Pi settings value read by `pi-acp` from merged Pi settings:

- global: `~/.pi/agent/settings.json`
- project/session cwd: `<cwd>/.pi/settings.json`

When enabled, `pi-acp` suppresses the full startup info block, but may still surface an update notice. Rudu's current practice of writing `<session_dir>/.pi/settings.json` with `{ "quietStartup": true }` matches the adapter contract because the ACP session cwd is the session dir.

Sources:
- https://github.com/svkozak/pi-acp/blob/main/README.md
- https://github.com/svkozak/pi-acp/blob/main/src/acp/pi-settings.ts
- https://github.com/svkozak/pi-acp/blob/main/src/acp/agent.ts

## `session/load`

ACP requires clients to check `agentCapabilities.loadSession` before calling `session/load`. `pi-acp` advertises `loadSession: true`.

`pi-acp` persists a small ACP-to-Pi mapping at `~/.pi/pi-acp/session-map.json`. On `session/load`, it looks up or discovers the Pi session file, starts Pi with `--session <sessionPath>`, calls Pi `get_messages`, and replays history back to the ACP client as `session/update` notifications before returning.

Sources:
- https://agentclientprotocol.com/protocol/session-setup
- https://github.com/svkozak/pi-acp/blob/main/README.md
- https://github.com/svkozak/pi-acp/blob/main/src/acp/agent.ts
- https://github.com/svkozak/pi-acp/blob/main/src/acp/session-store.ts

## Wrapper Script Implication For Rudu

Rudu can delete ACP-protocol wrapper logic if any exists outside `pi-acp`; the adapter already owns ACP JSON-RPC, session creation/loading, Pi RPC bridging, startup info, command listing, and basic history replay.

Rudu should keep a Pi command wrapper while it still needs Pi-specific launch customization. The current Rudu inner wrapper is doing real work that upstream `pi-acp` does not model as adapter settings: exporting remote-review env vars and launching Pi with custom extension/tool flags. The outer `pi-acp` wrapper is also pragmatically useful if the Rust ACP launcher cannot set cwd/env directly, because it sets the session cwd, `PI_ACP_PI_COMMAND`, and version-check noise controls before execing `pi-acp`.

If Rudu moves review context to local Review Workspaces and no longer needs Worker env vars or custom extension/tool flags, then it can likely launch `pi-acp` directly with a normal Pi binary. Until then, keep the wrapper boundary but make it explicit: `pi-acp` wrapper for adapter env/cwd, Pi wrapper for extra Pi startup flags.
