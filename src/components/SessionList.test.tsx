import { test, expect, afterEach } from "bun:test";
import { testRender } from "@opentui/react/test-utils";
import { SessionList } from "./SessionList.js";
import type { SessionSnapshot } from "../services/SessionManager.js";

let testSetup: Awaited<ReturnType<typeof testRender>>;

afterEach(() => {
  if (testSetup) {
    testSetup.renderer.destroy();
  }
});

const mockSessions: SessionSnapshot[] = [
  {
    id: "session-1",
    title: "Test Session 1",
    command: ["echo", "test"],
    status: "running",
    queuedAt: Date.now(),
    startedAt: Date.now(),
    pid: 12345,
    logSummary: { retainedLines: 10, retainedBytes: 500, droppedLines: 0 },
    transcriptSummary: { retainedMessages: 0, retainedBytes: 0, droppedMessages: 0 },
  },
  {
    id: "session-2",
    title: "Test Session 2",
    command: ["echo", "test2"],
    status: "queued",
    queuedAt: Date.now(),
    logSummary: { retainedLines: 0, retainedBytes: 0, droppedLines: 0 },
    transcriptSummary: { retainedMessages: 0, retainedBytes: 0, droppedMessages: 0 },
  },
];

test("SessionList shows empty state when no sessions", async () => {
  testSetup = await testRender(
    <SessionList sessions={[]} selectedId={null} focused={true} onSelect={() => {}} />,
    { width: 80, height: 10 }
  );
  await testSetup.renderOnce();
  const frame = testSetup.captureCharFrame();
  expect(frame).toContain("No sessions yet");
  expect(frame).toContain("Ctrl+N");
});

test("SessionList renders session titles", async () => {
  testSetup = await testRender(
    <SessionList sessions={mockSessions} selectedId="session-1" focused={true} onSelect={() => {}} />,
    { width: 80, height: 10 }
  );
  await testSetup.renderOnce();
  const frame = testSetup.captureCharFrame();
  expect(frame).toContain("Test Session 1");
  expect(frame).toContain("Test Session 2");
});

test("SessionList shows session status", async () => {
  testSetup = await testRender(
    <SessionList sessions={mockSessions} selectedId="session-1" focused={true} onSelect={() => {}} />,
    { width: 80, height: 10 }
  );
  await testSetup.renderOnce();
  const frame = testSetup.captureCharFrame();
  expect(frame).toContain("running");
  expect(frame).toContain("queued");
});
