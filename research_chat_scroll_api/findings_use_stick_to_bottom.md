# Findings: `use-stick-to-bottom` API

Sources:
- https://github.com/stackblitz-labs/use-stick-to-bottom/blob/main/README.md
- https://github.com/stackblitz-labs/use-stick-to-bottom/blob/main/src/StickToBottom.tsx
- Local installed package: `node_modules/use-stick-to-bottom`, version `1.1.4`

Key facts:
- The library provides `StickToBottom`, `StickToBottom.Content`, and `useStickToBottomContext`.
- `StickToBottom.Content` creates the actual scroll container and inner measured content container.
- In the installed `1.1.4` package, `StickToBottom.Content` renders:
  - an outer div with `ref={context.scrollRef}`, inline `height: "100%"`, `width: "100%"`, and `scrollbarGutter: "stable both-edges"`, plus `scrollClassName`
  - an inner div with `ref={context.contentRef}` and the caller's `className` / content props
- `useStickToBottomContext` exposes `isAtBottom`, `scrollToBottom`, `stopScroll`, `escapedFromLock`, refs, and internal state.
- The README's component example renders the scroll-to-bottom button as a sibling of `StickToBottom.Content`, not inside the measured content.
- The library is designed to handle content resize via `ResizeObserver` and custom spring scrolling; manually changing scroll position inside nested content can compete with this model.
