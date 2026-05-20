# Chat Scroll API Research Plan

## Main Question

How is the Review Chat container currently scrolling, and does the `use-stick-to-bottom` component API suggest a cleaner way to structure the local components?

## Subtopics

1. `use-stick-to-bottom` public API
   - Confirm how `StickToBottom`, `StickToBottom.Content`, `useStickToBottomContext`, `isAtBottom`, and `scrollToBottom` are intended to be used.

2. Local implementation
   - Trace how Rudu wraps the library and where additional manual scrolling is still happening.

## Synthesis

Compare the documented component contract with Rudu's `Conversation`, `ConversationContent`, `ConversationScrollButton`, `MessageList`, and turn-activity component usage. Identify what is currently responsible for scrolling and which pieces are likely causing weird frontend behavior.
