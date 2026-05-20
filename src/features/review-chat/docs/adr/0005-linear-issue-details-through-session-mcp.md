# ADR 0005: Linear Issue Details Through Session MCP

## Status

Accepted

## Context

Review Chat Attachments intentionally carry compact prompt summaries. For GitHub pull requests and issues, Codex can expand those summaries with read-only `gh` commands from the Review Workspace. Linear issue descriptions are different because Rudu stores the Linear API key as an app integration secret, and the Review Chat agent should not receive that credential directly.

Rudu needs Linear issue bodies and descriptions available when they matter, but embedding every Linear description into every prompt would make attachments heavier and would weaken the existing compact-summary model.

## Decision

Rudu will expose Linear issue details through a Review Session-scoped MCP server passed through ACP `mcpServers` when starting or loading a Codex Review Chat session.

The MCP server is Rudu-owned, read-only, and exposes a narrow `get_linear_issue_details` tool. Rudu reads the Linear credential through its existing integration boundary and passes it only to the session-scoped Rudu MCP child process. The child process returns issue details such as identifier, title, state, URL, and description. Codex receives the tool result, not the stored Linear API key.

GitHub pull request and issue bodies remain agent-driven through read-only `gh` commands. Rudu will not route GitHub details through this Linear MCP server in this decision.

## Consequences

- Linear issue descriptions become available on demand without bloating every prompt.
- Linear credentials stay inside Rudu-controlled process boundaries instead of being copied into prompt text or global Codex configuration.
- Review Sessions that load an existing Codex conversation must pass the same session-scoped MCP server list as newly created sessions.
- A live Review Chat runtime must be restarted before the next prompt if Linear issue-detail access changes while the runtime is already alive.
- GitHub and Linear issue expansion use different mechanisms, so prompt guidance must make that split explicit.
