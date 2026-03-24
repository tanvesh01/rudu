import { test, expect, afterEach } from "bun:test";
import { testRender } from "@opentui/react/test-utils";
import { LogPane } from "./LogPane.js";
import type { SessionSnapshot, SessionLogLine } from "../services/SessionManager.js";

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
};

const mockLogs: SessionLogLine[] = [
  { timestamp: Date.now(), stream: "stdout", text: "Starting process..." },
  { timestamp: Date.now(), stream: "stdout", text: "Processing..." },
  { timestamp: Date.now(), stream: "stderr", text: "Warning: deprecated" },
];

test("LogPane shows placeholder when no session selected", async () => {
  testSetup = await testRender(
    <LogPane session={null} logs={[]} />,
    { width: 80, height: 20 }
  );
  await testSetup.renderOnce();
  const frame = testSetup.captureCharFrame();
  expect(frame).toContain("Select a session to view logs");
});

test("LogPane shows session title", async () => {
  testSetup = await testRender(
    <LogPane session={mockSession} logs={[]} />,
    { width: 80, height: 20 }
  );
  await testSetup.renderOnce();
  const frame = testSetup.captureCharFrame();
  expect(frame).toContain("Test Session");
  expect(frame).toContain("running");
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
