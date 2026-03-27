# react

To install dependencies:

```bash
bun install
```

To run:

```bash
bun dev
```

This project was created using `bun create tui`. [create-tui](https://git.new/create-tui) is the easiest way to get started with OpenTUI.

## TODO

### Chat/Session UI

- **New messages indicator**: When the user has scrolled up to read old messages and new messages arrive, show a visual indicator (e.g., "↓ New messages") at the bottom of the chat area. Clicking it should scroll to the bottom. This helps users know when new content has arrived while they're reviewing history.

- **Sidebar busy spinner**: Show an animated spinner (⠋⠙⠹⠸) in the sidebar next to worktrees when the assistant is busy generating a response. Currently we show session status (running/queued/etc) but it would be better to show a spinner like we do in the chat. This requires manually cycling through spinner frames since OpenTUI's `<select>` component only accepts strings, not React components.
