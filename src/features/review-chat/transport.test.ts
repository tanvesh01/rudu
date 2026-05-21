import { describe, expect, it } from "bun:test";
import {
  createReviewChatChunkMapper,
  extractLastUserText,
} from "./transport";
import type { ReviewChatEvent } from "../../types/github";

describe("createReviewChatChunkMapper", () => {
  it("buffers hidden reasoning and emits final text only on finish", () => {
    const originalDateNow = Date.now;
    Date.now = () => 1234;
    try {
      const mapper = createReviewChatChunkMapper("turn-1");
      const events: ReviewChatEvent[] = [
        {
          kind: "thought",
          sessionId: "session-1",
          turnId: "turn-1",
          text: "reading diff",
        },
        {
          kind: "message",
          sessionId: "session-1",
          turnId: "turn-1",
          text: "Looks good.",
        },
        {
          kind: "finished",
          sessionId: "session-1",
          turnId: "turn-1",
          stopReason: "end_turn",
        },
      ];

      expect(events.flatMap((event) => mapper.mapEvent(event))).toEqual([
        { type: "text-start", id: "turn-1-text-1" },
        { type: "text-delta", id: "turn-1-text-1", delta: "Looks good." },
        { type: "text-end", id: "turn-1-text-1" },
        {
          type: "finish",
          finishReason: "stop",
          messageMetadata: {
            acpStopReason: "end_turn",
            finishedAt: 1234,
            turnId: "turn-1",
          },
        },
      ]);
    } finally {
      Date.now = originalDateNow;
    }
  });

  it("replaces ACP plan data by stable part id", () => {
    const mapper = createReviewChatChunkMapper("turn-1");

    expect(
      mapper.mapEvent({
        kind: "plan",
        sessionId: "session-1",
        turnId: "turn-1",
        entries: [
          {
            content: "Inspect diff",
            priority: "high",
            status: "in_progress",
          },
        ],
      }),
    ).toEqual([
      {
        type: "data-acp-plan",
        id: "plan",
        data: {
          entries: [
            {
              content: "Inspect diff",
              priority: "high",
              status: "in_progress",
            },
          ],
        },
      },
    ]);
  });

  it("maps completed tools through dynamic AI SDK tool parts", () => {
    const mapper = createReviewChatChunkMapper("turn-1");

    expect(
      mapper.mapEvent({
        kind: "tool",
        sessionId: "session-1",
        turnId: "turn-1",
        toolCallId: "call-1",
        title: "Read File",
        status: "completed",
        rawInput: { path: "src/App.tsx" },
        rawOutput: "ok",
      }),
    ).toEqual([
      {
        type: "tool-input-start",
        toolCallId: "call-1",
        toolName: "read_file",
        dynamic: true,
        title: "Read File",
      },
      {
        type: "tool-input-available",
        toolCallId: "call-1",
        toolName: "read_file",
        input: { path: "src/App.tsx" },
        dynamic: true,
        title: "Read File",
      },
      {
        type: "tool-output-available",
        toolCallId: "call-1",
        output: "ok",
        dynamic: true,
      },
    ]);
  });

  it("drops pre-tool progress text and emits only the final answer on finish", () => {
    const mapper = createReviewChatChunkMapper("turn-1");
    const events: ReviewChatEvent[] = [
      {
        kind: "message",
        sessionId: "session-1",
        turnId: "turn-1",
        text: "I will inspect this with `gh pr view`.",
      },
      {
        kind: "tool",
        sessionId: "session-1",
        turnId: "turn-1",
        toolCallId: "call-1",
        title: "Inspect PR",
        status: "completed",
        rawInput: { body: "gh pr view" },
        rawOutput: "ok",
      },
      {
        kind: "message",
        sessionId: "session-1",
        turnId: "turn-1",
        text: "Issue #69 is about query keys.",
      },
      {
        kind: "finished",
        sessionId: "session-1",
        turnId: "turn-1",
        stopReason: "end_turn",
      },
    ];

    expect(events.flatMap((event) => mapper.mapEvent(event))).toEqual([
      {
        type: "tool-input-start",
        toolCallId: "call-1",
        toolName: "inspect_pr",
        dynamic: true,
        title: "Inspect PR",
      },
      {
        type: "tool-input-available",
        toolCallId: "call-1",
        toolName: "inspect_pr",
        input: { body: "gh pr view" },
        dynamic: true,
        title: "Inspect PR",
      },
      {
        type: "tool-output-available",
        toolCallId: "call-1",
        output: "ok",
        dynamic: true,
      },
      { type: "text-start", id: "turn-1-text-1" },
      {
        type: "text-delta",
        id: "turn-1-text-1",
        delta: "Issue #69 is about query keys.",
      },
      { type: "text-end", id: "turn-1-text-1" },
      {
        type: "finish",
        finishReason: "stop",
        messageMetadata: {
          acpStopReason: "end_turn",
          finishedAt: expect.any(Number),
          turnId: "turn-1",
        },
      },
    ]);
  });

  it("does not expose internal ACP tool ids as user-facing titles", () => {
    const mapper = createReviewChatChunkMapper("turn-1");

    expect(
      mapper.mapEvent({
        kind: "tool",
        sessionId: "session-1",
        turnId: "turn-1",
        toolCallId: "call-1",
        title: "call_VtRvNrxAUGHwrFdL8PCfrHZv|fc_0d6b64716",
        status: "completed",
        rawInput: { path: "src/App.tsx", startLine: 1 },
        rawOutput: "ok",
      }),
    ).toEqual([
      {
        type: "tool-input-start",
        toolCallId: "call-1",
        toolName: "read_src_app_tsx",
        dynamic: true,
        title: "Read src/App.tsx",
      },
      {
        type: "tool-input-available",
        toolCallId: "call-1",
        toolName: "read_src_app_tsx",
        input: { path: "src/App.tsx", startLine: 1 },
        dynamic: true,
        title: "Read src/App.tsx",
      },
      {
        type: "tool-output-available",
        toolCallId: "call-1",
        output: "ok",
        dynamic: true,
      },
    ]);
  });

  it("filters stale turn events", () => {
    const mapper = createReviewChatChunkMapper("turn-1");

    expect(
      mapper.mapEvent({
        kind: "message",
        sessionId: "session-1",
        turnId: "turn-2",
        text: "stale",
      }),
    ).toEqual([]);
  });

  it("builds the upstream prompt from user-message metadata without polluting visible text", () => {
    expect(
      extractLastUserText([
        {
          id: "user-1",
          role: "user",
          metadata: {
            attachments: [
              {
                kind: "diff-lines",
                id: "diff-lines:src/example.ts:12:14:additions:additions",
                path: "src/example.ts",
                startLine: 12,
                endLine: 14,
                startSide: "additions",
                endSide: "additions",
                lineCount: 3,
                label: "Lines 12-14",
                sideLabel: "Added lines",
                snippet: "foo()\nbar()\nbaz()",
                isSnippetTruncated: false,
              },
            ],
          },
          parts: [{ type: "text", text: "what changed here?" }],
        },
      ]),
    ).toBe(`Selected diff context:
File: src/example.ts
Range: Lines 12-14
Side: Added lines
Snippet:
\`\`\`
foo()
bar()
baz()
\`\`\`

User request:
what changed here?`);
  });
});
