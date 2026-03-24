import { expect, test } from "bun:test";
import { SessionEventBus } from "./event-bus.js";
import type { SessionSnapshot } from "./types.js";

function createSessionSnapshot(id: string): SessionSnapshot {
  return {
    id,
    title: `Session ${id}`,
    command: ["echo", id],
    status: "running",
    queuedAt: 1,
    logSummary: {
      retainedLines: 0,
      retainedBytes: 0,
      droppedLines: 0,
    },
    transcriptSummary: {
      retainedMessages: 0,
      retainedBytes: 0,
      droppedMessages: 0,
    },
    canSendFollowUp: false,
  };
}

test("SessionEventBus coalesces log batches per session", () => {
  const batches: string[][] = [];
  const bus = new SessionEventBus({
    eventThrottleMs: 100,
    getLogPayload: (sessionId) => ({
      session: createSessionSnapshot(sessionId),
      logSummary: {
        retainedLines: 2,
        retainedBytes: 8,
        droppedLines: 0,
      },
    }),
  });

  bus.on("sessionLogBatch", ({ lines }) => {
    batches.push(lines.map((line) => line.text));
  });

  bus.enqueueLogBatch("s1", [{ timestamp: 1, stream: "stdout", text: "one" }]);
  bus.enqueueLogBatch("s1", [{ timestamp: 2, stream: "stderr", text: "two" }]);
  bus.flushNow();

  expect(batches).toEqual([["one", "two"]]);
});
