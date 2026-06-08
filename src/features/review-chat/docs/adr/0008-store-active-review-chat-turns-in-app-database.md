# Store Active Review Chat Turns in the App Database

Rudu will store Active Review Chat Turn state in the App Database instead of treating the mounted Review Chat UI or `useChat` stream as the owner of running work. Normal chat prompts and Review Walkthrough requests share one active-turn lifecycle, distinguished by Review Chat Turn Kind, so switching tabs, changing pull request selection, or remounting the chat UI detaches and reattaches the view without cancelling work.

The tradeoff is extra backend state and recovery logic, but it avoids losing loading/progress state when the UI unmounts and keeps cancellation semantics explicit: only Stop cancels an active turn. Rudu commits the user-visible request immediately, keeps compact running state on the active turn, appends the terminal assistant result on success/failure/cancel, and clears the active turn only after that terminal transcript message is committed.
