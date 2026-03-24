# AGENTS.md

## Project Overview

Rudu is a terminal user interface (TUI) for managing background coding agent sessions.

Tech stack:

- **Runtime:** Bun
- **Language:** TypeScript
- **UI:** React + OpenTUI
- **Execution model:** local subprocess/session orchestration

Core user workflows:

- create a new coding session from a prompt
- queue and run sessions with bounded concurrency
- monitor lifecycle state in real time
- stream and inspect stdout/stderr logs
- cancel queued or running sessions safely

This project is intentionally split into:

1. a **session orchestration layer** (`SessionManager`)
2. a **React state bridge** (`useSessionStore`)
3. a **TUI presentation layer** (OpenTUI components)

Keep those layers separate.

---

## Architecture Overview

### 1. SessionManager: the source of truth
**File:** `src/services/SessionManager.ts`

`SessionManager` owns session lifecycle, subprocess management, queueing, cancellation, and log buffering.

Responsibilities:

- queue sessions
- enforce **max 2 concurrent sessions** by default
- spawn subprocesses with Bun
- stream stdout/stderr in real time
- batch and throttle events to roughly **10Hz** (`eventThrottleMs = 100`)
- retain logs in a bounded in-memory ring buffer
  - **2000 lines max**
  - **~1MB max**
- support **two-phase cancellation**
  - mark session as `cancelling`
  - send `SIGTERM`
  - escalate to `SIGKILL` after grace period
- expose immutable-ish snapshots for the UI

Important lifecycle:

- `queued`
- `starting`
- `running`
- `cancelling`
- `succeeded`
- `failed`
- `cancelled`

Design rule: **all session state transitions must originate here**.

---

### 2. React state bridge
**File:** `src/hooks/useSessionStore.ts`

`useSessionStore` subscribes to `SessionManager` events and turns them into React state suitable for rendering.

Responsibilities:

- maintain the current list of session snapshots
- track selected session ID
- cache streamed log lines per session for the UI
- provide UI-facing actions such as:
  - `selectSession`
  - `cancelSession`
  - `getSessionLogs`

Design rule: **this hook mirrors manager state; it should not invent business rules**.

If behavior changes in the session model, update `SessionManager` first, then adapt this hook.

---

### 3. OpenTUI presentation layer
**Files:**
- `src/app/App.tsx`
- `src/components/Header.tsx`
- `src/components/Footer.tsx`
- `src/components/SessionList.tsx`
- `src/components/LogPane.tsx`
- `src/components/PromptInput.tsx`

The UI layer is responsible for layout, keyboard interactions, and rendering session/log data.

Responsibilities by file:

- `src/index.tsx`
  - creates the CLI renderer
  - mounts the app

- `src/app/App.tsx`
  - composes the full screen
  - owns top-level mode (`list` vs `prompt`)
  - wires keyboard shortcuts
  - creates and owns the `SessionManager` instance

- `src/components/Header.tsx`
  - app title and mode indicator

- `src/components/Footer.tsx`
  - keyboard shortcut help

- `src/components/SessionList.tsx`
  - session selection and session summary display

- `src/components/LogPane.tsx`
  - log display for selected session
  - shows retained/dropped log info

- `src/components/PromptInput.tsx`
  - prompt entry for creating sessions

Design rule: **components should stay presentational and thin**. Avoid putting subprocess, queue, or lifecycle logic in components.

---

## Repository Structure

```text
src/
  index.tsx                  # entry point
  app/
    App.tsx                  # top-level app composition and keyboard flow
  components/
    Header.tsx
    Footer.tsx
    SessionList.tsx
    LogPane.tsx
    PromptInput.tsx
  services/
    SessionManager.ts        # core orchestration
  hooks/
    useSessionStore.ts       # React bridge to SessionManager
  domain/
    session.ts               # shared types/utilities
```

Tests live beside implementation files as `*.test.ts` / `*.test.tsx`.

---

## Development Workflow

### Install dependencies
```bash
bun install
```

### Run the app
```bash
bun dev
```

Current script definition is in `package.json`:

- `bun dev` -> `bun run --watch src/index.tsx`

### Run tests
```bash
bun test
```

There is currently no dedicated `test` script in `package.json`, so use `bun test` directly.

---

## Key Abstractions and Responsibilities

### SessionSnapshot
Represents the UI-safe view of a session.

Use it for:

- list display
- status display
- timing and exit metadata
- log retention summary

Do **not** put mutable runtime internals into UI state.

---

### SessionManagerEventMap
Defines the event contract between orchestration and UI.

Key events include:

- `sessionQueued`
- `sessionStarting`
- `sessionStarted`
- `sessionLogBatch`
- `sessionCancelRequested`
- `sessionCancelled`
- `sessionSucceeded`
- `sessionFailed`

Rule: when adding a new lifecycle behavior, update the event contract intentionally.

---

### SessionLogRingBuffer
Private helper inside `SessionManager`.

Responsibilities:

- bounded log retention
- UTF-8-aware byte accounting
- line dropping when limits are exceeded
- summary reporting via `retainedLines`, `retainedBytes`, `droppedLines`

Rule: do not let logs grow unbounded in React state or component-local state.

---

### useSessionStore
The only place that should translate manager events into React updates.

Rule: if multiple components need the same derived session state, derive it here or in a shared selector/helper, not ad hoc in several components.

---

### src/domain/session.ts
Holds shared session/domain utilities such as:

- status-related types
- terminal-state helpers
- duration formatting

Use this file for pure domain logic that does not depend on Bun, OpenTUI, or React.

---

## Common Patterns and Conventions

### 1. Single orchestration boundary
Business logic belongs in `SessionManager`, not in components.

Good:

- queue rules
- cancellation semantics
- log retention
- subprocess lifecycle

Bad:

- starting/killing processes from React components
- ad hoc status mutation in hooks
- direct UI ownership of execution state

---

### 2. Event-driven updates
The app is designed around events, not polling.

Use manager events to drive UI updates. If a feature needs real-time updates, prefer extending the event model over introducing polling loops.

---

### 3. Throttled rendering
Session/log updates are intentionally batched.

Why:

- avoid overwhelming the TUI renderer
- keep UI responsive under high log volume

Implication:

- do not assume every log line causes an immediate React render
- account for batched `sessionLogBatch` behavior in tests and feature design

---

### 4. Immutable UI updates
React state updates should replace arrays/maps predictably.

When updating sessions:

- map over prior sessions and replace by ID
- avoid mutating snapshots in place

When updating logs:

- clone `Map`
- append new batches
- keep behavior deterministic

---

### 5. Clear separation of summary vs detail
Keep the session list lightweight and the log pane detailed.

- list views show concise session status/duration
- log pane handles high-volume text output
- selection determines which session's full logs are shown

---

### 6. Keyboard-first UX
All major actions should remain keyboard accessible.

If adding a new action:

- wire shortcut handling in `src/app/App.tsx`
- expose it in `src/components/Footer.tsx`
- test visible affordances

---

### 7. Favor stable UI text
Tests rely on rendered text content.

If you change copy such as:

- empty states
- footer shortcuts
- status labels
- placeholders

expect test updates to be required.

---

## Testing Approach

### Primary tools
- `bun:test`
- `@opentui/react/test-utils`

### Existing style
Tests render components into an OpenTUI test renderer and inspect the output frame.

Common pattern:

- `testRender(<Component />)`
- `await renderOnce()`
- `captureCharFrame()`
- assert on visible text

### What to test

#### Component tests
Focus on:

- visible labels
- empty states
- selected states
- mode indicators
- log rendering
- shortcut help

#### App-level tests
Verify:

- shell layout renders correctly
- initial empty state
- key UI affordances are present

#### SessionManager tests
If adding or changing orchestration behavior, test:

- queue ordering
- max concurrency
- lifecycle transitions
- cancellation behavior
- log buffering and truncation
- shutdown/disposal behavior

### Snapshot testing guidance
Use snapshot-like frame assertions when layout is stable.

Good candidates:

- header/footer
- empty states
- simple list rendering
- prompt mode vs list mode

Avoid brittle snapshots for highly dynamic content like timestamps unless you stub time.

### Test hygiene
Always destroy the OpenTUI renderer in `afterEach`.

This pattern already exists in the test suite and should be preserved to avoid leaking renderer state.

---

## How to Extend the System

### Adding a new session field
Example: priority, agent name, workspace path, tags

Update in this order:

1. `src/services/SessionManager.ts`
   - input type
   - internal record
   - snapshot generation
   - event payloads if relevant

2. `src/hooks/useSessionStore.ts`
   - ensure state updates propagate the new snapshot shape

3. UI components
   - render the new field where appropriate

4. tests
   - service tests
   - component tests if visible in UI

---

### Adding a new lifecycle state or event
Be careful: this affects the full stack.

Update:

1. `SessionStatus` and related helpers
2. `SessionManagerEventMap`
3. transition logic in `SessionManager`
4. `useSessionStore` subscriptions
5. status display in UI
6. tests for transitions and rendering

Rule: lifecycle changes are architecture changes, not just UI changes.

---

### Adding a new UI component
Place new presentational components in `src/components/`.

Guidelines:

- pass data in via props
- keep behavior local to rendering/input concerns
- do not instantiate subprocess or orchestration logic there
- add a colocated `*.test.tsx`

If the component needs shared session state, consume it through `App`/`useSessionStore`, not directly from the manager unless there is a strong reason.

---

### Adding a new keyboard shortcut
Update:

1. `src/app/App.tsx`
2. `src/components/Footer.tsx`
3. relevant tests

Keep shortcuts discoverable in the footer.

---

### Adding a new session action
Examples:

- retry
- rerun
- clear logs
- archive completed sessions

Prefer this flow:

1. define the domain behavior in `SessionManager`
2. expose a hook action in `useSessionStore`
3. invoke it from `App` or a focused component
4. render the result
5. add service + UI tests

---

### Changing log handling
If adjusting retention, streaming, or formatting:

- keep memory bounded
- preserve stdout/stderr/system distinction
- make dropped-log behavior observable
- test both normal and overflow paths

Do not move unbounded log accumulation into React state.

---

## Troubleshooting

### UI is not updating after a session change
Check:

- was an event emitted from `SessionManager`?
- is `useSessionStore` subscribed to that event?
- is the session being replaced by ID in React state?
- are you expecting immediate updates despite throttling?

Remember: log updates are batched at roughly 100ms.

---

### A session never leaves `queued`
Check:

- `maxConcurrent` capacity
- whether active sessions are being removed on completion
- whether `pumpQueue()` is called after finalization
- whether the session was cancelled before start

Primary file: `src/services/SessionManager.ts`

---

### Cancellation appears stuck
Expected flow:

1. `running` -> `cancelling`
2. `SIGTERM`
3. possible `SIGKILL` escalation after grace period
4. terminal state `cancelled`

If it stalls, inspect:

- `cancelSession(...)`
- `observeExit(...)`
- timer cleanup
- subprocess signal handling behavior

---

### Logs are missing or truncated
This may be expected.

Rudu uses a bounded ring buffer:

- 2000 lines max
- ~1MB max

If logs exceed limits, old lines are dropped and `droppedLines` increases.

Check the log summary in the session snapshot and `LogPane`.

---

### Tests are flaky
Common causes:

- dynamic timestamps or durations
- relying on exact layout for unstable content
- not waiting for render completion
- not destroying the renderer after tests

Prefer stable text assertions unless the snapshot is intentionally fixed.

---

### Terminal process leaks or hangs on exit
Check:

- `shutdown()` usage
- `dispose()` on unmount
- process hook registration/removal
- force termination fallback

Relevant files:

- `src/app/App.tsx`
- `src/services/SessionManager.ts`

---

### UI and domain types drift apart
There is overlap between `src/domain/session.ts` and `src/services/SessionManager.ts`.

If changing status names, event semantics, or timing fields, keep them aligned. Do not let the domain model and manager contract diverge.

---

## Guidance for Future Agents

When making changes:

1. start with the orchestration model
2. update the React bridge
3. update the TUI
4. update tests

Preferred order of reasoning:

- lifecycle correctness
- memory safety
- event consistency
- UI clarity
- test stability

If unsure where logic belongs:

- **Session semantics** -> `SessionManager`
- **React synchronization** -> `useSessionStore`
- **Rendering and input** -> components / `App`
- **Pure helpers/types** -> `src/domain/session.ts`

Above all: **preserve the separation between process management, state synchronization, and presentation**.
