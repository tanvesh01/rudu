import { test, expect, afterEach } from "bun:test";
import { testRender } from "@opentui/react/test-utils";
import { LogPane } from "./LogPane.js";
import type { SessionSnapshot, SessionLogLine } from "../services/SessionManager.js";
import { buildMissingPiSessionFileError } from "../services/SessionManager.js";
import type { TranscriptMessage } from "../domain/transcript.js";

let testSetup: Awaited<ReturnType<typeof testRender>>;

afterEach(() => {
  if (testSetup) {
    testSetup.renderer.destroy();
  }
});

const mockSession: SessionSnapshot = {
  id: "session-1",
  title: "Test Session",
  command: ["echo", "test"],
  status: "running",
  queuedAt: Date.now(),
  startedAt: Date.now(),
  pid: 12345,
  logSummary: { retainedLines: 3, retainedBytes: 150, droppedLines: 0 },
  transcriptSummary: { retainedMessages: 0, retainedBytes: 0, droppedMessages: 0 },
  canSendFollowUp: false,
};

const mockLogs: SessionLogLine[] = [
  { timestamp: Date.now(), stream: "stdout", text: "Starting process..." },
  { timestamp: Date.now(), stream: "stdout", text: "Processing..." },
  { timestamp: Date.now(), stream: "stderr", text: "Warning: deprecated" },
];

const missingPiFilePath = "/tmp/missing-session.jsonl";
const mockPiSessionMissingHistory: SessionSnapshot = {
  ...mockSession,
  runtimeType: "pi-sdk",
  canResume: false,
  error: buildMissingPiSessionFileError(missingPiFilePath),
};

test("LogPane shows placeholder when no session selected", async () => {
  testSetup = await testRender(
    <LogPane session={null} logs={[]} />,
    { width: 80, height: 20 }
  );
  await testSetup.renderOnce();
  const frame = testSetup.captureCharFrame();
  expect(frame).toContain("Select a session to view logs");
});

test("LogPane shows waiting message for empty session", async () => {
  testSetup = await testRender(
    <LogPane session={mockSession} logs={[]} />,
    { width: 80, height: 20 }
  );
  await testSetup.renderOnce();
  const frame = testSetup.captureCharFrame();
  expect(frame).toContain("Waiting for output...");
});

test("LogPane renders log lines", async () => {
  testSetup = await testRender(
    <LogPane session={mockSession} logs={mockLogs} />,
    { width: 80, height: 20 }
  );
  await testSetup.renderOnce();
  const frame = testSetup.captureCharFrame();
  expect(frame).toContain("Starting process...");
  expect(frame).toContain("Processing...");
  expect(frame).toContain("Warning: deprecated");
});

test("LogPane shows waiting message when no logs", async () => {
  testSetup = await testRender(
    <LogPane session={mockSession} logs={[]} />,
    { width: 80, height: 20 }
  );
  await testSetup.renderOnce();
  const frame = testSetup.captureCharFrame();
  expect(frame).toContain("Waiting for output...");
});

test("LogPane renders tool burst messages with minimal chrome", async () => {
  const transcripts: TranscriptMessage[] = [
    { id: "user-1", role: "user", text: "Test prompt", timestamp: Date.now() },
    { id: "tool-burst-1", role: "tool", text: "bash, edit, write, cd", timestamp: Date.now() },
  ];
  testSetup = await testRender(
    <LogPane session={mockSession} logs={mockLogs} transcripts={transcripts} />,
    { width: 80, height: 20 }
  );
  await testSetup.renderOnce();
  const frame = testSetup.captureCharFrame();
  expect(frame).toContain("bash, edit, write, cd");
  // Should NOT contain "Tool" label since tool messages render with minimal chrome
  expect(frame).not.toContain("Tool");
});

test("LogPane shows PI history-unavailable state when PI session file is missing", async () => {
  testSetup = await testRender(
    <LogPane session={mockPiSessionMissingHistory} logs={[]} transcripts={[]} />,
    { width: 80, height: 20 }
  );
  await testSetup.renderOnce();
  const frame = testSetup.captureCharFrame();
  expect(frame).toContain("History unavailable for this PI session.");
  expect(frame).toContain("PI session history unavailable: session file missing:");
});

test("LogPane keeps generic waiting state for empty transcript when error is unrelated", async () => {
  testSetup = await testRender(
    <LogPane
      session={{
        ...mockSession,
        runtimeType: "pi-sdk",
        canResume: false,
        error: "Network timeout",
      }}
      logs={[]}
      transcripts={[]}
    />,
    { width: 80, height: 20 }
  );
  await testSetup.renderOnce();
  const frame = testSetup.captureCharFrame();
  expect(frame).toContain("Waiting for output...");
  expect(frame).not.toContain("History unavailable for this PI session.");
});
