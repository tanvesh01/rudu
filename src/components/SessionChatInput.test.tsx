import { test, expect, afterEach } from "bun:test";
import { testRender } from "@opentui/react/test-utils";
import { SessionChatInput } from "./SessionChatInput.js";
import type { SessionSnapshot } from "../services/SessionManager.js";

let testSetup: Awaited<ReturnType<typeof testRender>>;

afterEach(() => {
  if (testSetup) {
    testSetup.renderer.destroy();
  }
});

const createMockSession = (canSend: boolean): SessionSnapshot => ({
  id: "session-1",
  title: "Test Session",
  command: ["echo", "test"],
  status: "running",
  queuedAt: Date.now(),
  startedAt: Date.now(),
  pid: 12345,
  logSummary: { retainedLines: 0, retainedBytes: 0, droppedLines: 0 },
  transcriptSummary: { retainedMessages: 0, retainedBytes: 0, droppedMessages: 0 },
  runtimeType: canSend ? "pi-sdk" : "subprocess",
  canSendFollowUp: canSend,
});

test("SessionChatInput shows placeholder when no session", async () => {
  testSetup = await testRender(
    <SessionChatInput session={null} focused={true} onSubmit={() => {}} />,
    { width: 80, height: 5 }
  );
  await testSetup.renderOnce();
  const frame = testSetup.captureCharFrame();
  expect(frame).toContain("Ctrl+N");
});

test("SessionChatInput shows placeholder when session cannot send", async () => {
  const mockSession = createMockSession(false);
  testSetup = await testRender(
    <SessionChatInput session={mockSession} focused={true} onSubmit={() => {}} />,
    { width: 80, height: 5 }
  );
  await testSetup.renderOnce();
  const frame = testSetup.captureCharFrame();
  expect(frame).toContain("Only PI sessions");
});

test("SessionChatInput shows first-message placeholder when can send", async () => {
  const mockSession = createMockSession(true);
  testSetup = await testRender(
    <SessionChatInput session={mockSession} focused={true} onSubmit={() => {}} />,
    { width: 80, height: 5 }
  );
  await testSetup.renderOnce();
  const frame = testSetup.captureCharFrame();
  expect(frame).toContain("first message");
});

test("SessionChatInput renders prompt character", async () => {
  const mockSession = createMockSession(true);
  testSetup = await testRender(
    <SessionChatInput session={mockSession} focused={true} onSubmit={() => {}} />,
    { width: 80, height: 5 }
  );
  await testSetup.renderOnce();
  const frame = testSetup.captureCharFrame();
  expect(frame).toContain(">");
});
