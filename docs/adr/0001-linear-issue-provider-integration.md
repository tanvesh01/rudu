# Linear issue provider integration

Rudu will add Linear by first making the issue dashboard provider-neutral, then wiring GitHub and Linear through issue provider adapters. The shared dashboard command will return issue buckets plus Linear integration status, while GitHub remains governed by the existing GH CLI gate. Linear authentication will use a personal Linear API key stored through Rust-side OS keychain access, validated before save, and Linear issue data will not be persistently cached in v1.

## Considered Options

- Keep the dashboard GitHub-specific and bolt Linear rows into the UI.
- Add Linear first, then generalize the issue model later.
- Use Linear OAuth from the start.
- Store the Linear API key in SQLite, local config, Tauri Store, or frontend storage.
- Persist Linear issue responses for offline or faster reloads.

## Consequences

- The first implementation slice is a generic issue service refactor, even before Linear data appears.
- Provider failures must be isolated: an unconfigured or failing Linear integration does not block GitHub issue buckets.
- The issue dashboard uses exclusive bucket membership with priority: In Progress, Assigned, Subscribed, Created.
- The Linear integration dialog is launched from the issue dashboard header link labeled "Integrate Linear into Rudu" and includes the API key input plus links to Linear's API key documentation.
- The saved Linear API key is never shown back to React; connected, invalid, replace, and remove states are represented through integration status.
