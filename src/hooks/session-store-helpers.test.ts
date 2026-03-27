import { expect, test } from "bun:test";
import type {
  SessionLogLine,
  SessionSnapshot,
  SessionStatus,
} from "../services/SessionManager.js";
import type { TranscriptMessage } from "../domain/transcript.js";
import {
  appendSessionLogs,
  replaceSessionSnapshot,
  upsertTranscriptMessage,
} from "./session-store-helpers.js";

function createSessionSnapshot(
  id: string,
  status: SessionStatus = "queued",
): SessionSnapshot {
  return {
    id,
    title: id,
    command: ["echo", id],
    status,
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

test("replaceSessionSnapshot updates existing sessions by id", () => {
  const initial = [createSessionSnapshot("a"), createSessionSnapshot("b")];
  const updated = replaceSessionSnapshot(
    initial,
    createSessionSnapshot("b", "running"),
  );

  expect(updated).toHaveLength(2);
  expect(updated[1]?.status).toBe("running");
});

test("appendSessionLogs appends to the existing batch", () => {
  const initial = new Map<string, SessionLogLine[]>([
    ["a", [{ timestamp: 1, stream: "stdout", text: "one" }]],
  ]);

  const updated = appendSessionLogs(initial, "a", [
    { timestamp: 2, stream: "stderr", text: "two" },
  ]);

  expect(updated.get("a")).toEqual([
    { timestamp: 1, stream: "stdout", text: "one" },
    { timestamp: 2, stream: "stderr", text: "two" },
  ]);
});

test("upsertTranscriptMessage replaces existing transcript entries", () => {
  const initialMessage: TranscriptMessage = {
    id: "m1",
    role: "assistant",
    text: "old",
    timestamp: 1,
    streaming: true,
  };
  const updatedMessage: TranscriptMessage = {
    ...initialMessage,
    text: "new",
    streaming: false,
  };

  const initial = new Map<string, TranscriptMessage[]>([
    ["a", [initialMessage]],
  ]);
  const updated = upsertTranscriptMessage(initial, "a", updatedMessage);

  expect(updated.get("a")).toEqual([updatedMessage]);
});
