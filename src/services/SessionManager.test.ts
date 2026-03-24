import { test, expect, beforeEach, afterEach } from "bun:test";
import { SessionManager } from "./SessionManager.js";

let sessionManager: SessionManager;

beforeEach(() => {
  sessionManager = new SessionManager({
    autoInstallShutdownHooks: false,
  });
});

afterEach(async () => {
  await sessionManager.dispose();
});

test("SessionManager queues a session and starts it", async () => {
  const snapshot = sessionManager.queueSession({
    title: "Test Session",
    command: ["echo", "hello"],
  });

  expect(snapshot.title).toBe("Test Session");
  expect(snapshot.command).toEqual(["echo", "hello"]);
  
  // Wait for the session to start
  await new Promise((resolve) => setTimeout(resolve, 100));
  
  const session = sessionManager.getSession(snapshot.id);
  expect(session?.status).toBeOneOf(["starting", "running", "succeeded"]);
});

test("SessionManager lists all sessions", () => {
  sessionManager.queueSession({
    title: "Session 1",
    command: ["echo", "1"],
  });

  sessionManager.queueSession({
    title: "Session 2",
    command: ["echo", "2"],
  });

  const sessions = sessionManager.listSessions();
  expect(sessions.length).toBe(2);
  expect(sessions[0]?.title).toBe("Session 1");
  expect(sessions[1]?.title).toBe("Session 2");
});

test("SessionManager cancels a running session", async () => {
  const snapshot = sessionManager.queueSession({
    title: "Test Session",
    command: ["sleep", "10"],
  });

  // Wait for session to start
  await new Promise((resolve) => setTimeout(resolve, 100));
  
  const result = sessionManager.cancelSession(snapshot.id, "user");
  expect(result).toBe(true);

  // Session should be cancelling or cancelled
  const session = sessionManager.getSession(snapshot.id);
  expect(session?.status).toBeOneOf(["cancelling", "cancelled"]);
  
  // Wait for cancellation to complete
  await new Promise((resolve) => setTimeout(resolve, 3000));
  
  const finalSession = sessionManager.getSession(snapshot.id);
  expect(finalSession?.status).toBe("cancelled");
});

test("SessionManager emits sessionQueued event", async () => {
  let receivedEvent: any = null;

  sessionManager.on("sessionQueued", (event) => {
    receivedEvent = event;
  });

  sessionManager.queueSession({
    title: "Test Session",
    command: ["echo", "hello"],
  });

  // Wait for event flush
  await new Promise((resolve) => setTimeout(resolve, 150));

  expect(receivedEvent).not.toBeNull();
  expect(receivedEvent.session.title).toBe("Test Session");
  expect(receivedEvent.session.status).toBe("queued");
});

test("SessionManager respects maxConcurrent limit", async () => {
  // Create manager with max 1 concurrent
  const limitedManager = new SessionManager({
    maxConcurrent: 1,
    autoInstallShutdownHooks: false,
  });

  // Queue two sessions with long-running commands
  const session1 = limitedManager.queueSession({
    title: "Session 1",
    command: ["sleep", "10"],
  });

  const session2 = limitedManager.queueSession({
    title: "Session 2",
    command: ["sleep", "10"],
  });

  // Wait for first to start
  await new Promise((resolve) => setTimeout(resolve, 100));

  // Second should be queued
  const s2 = limitedManager.getSession(session2.id);
  expect(s2?.status).toBe("queued");

  await limitedManager.dispose();
});

test("SessionManager returns undefined for unknown session", () => {
  const session = sessionManager.getSession("non-existent-id");
  expect(session).toBeUndefined();
});

test("SessionManager returns empty logs for unknown session", () => {
  const logs = sessionManager.getSessionLogs("non-existent-id");
  expect(logs.length).toBe(0);
});

test("SessionManager completes a simple command", async () => {
  const snapshot = sessionManager.queueSession({
    title: "Quick Command",
    command: ["echo", "success"],
  });

  // Wait for completion
  const finalSnapshot = await sessionManager.waitForSession(snapshot.id);
  
  expect(finalSnapshot.status).toBe("succeeded");
  expect(finalSnapshot.exitCode).toBe(0);
});

test("SessionManager emits sessionTranscriptUpdate events for PI sessions", async () => {
  let transcriptUpdates: { sessionId: string; message: unknown }[] = [];

  sessionManager.on("sessionTranscriptUpdate", ({ sessionId, message }) => {
    transcriptUpdates.push({ sessionId, message });
  });

  // Queue a PI session which emits transcript events
  sessionManager.queuePiSession({
    title: "PI Test Session",
    prompt: "Test prompt",
  });

  // Wait for event flush
  await new Promise((resolve) => setTimeout(resolve, 150));

  // PI sessions emit the user prompt as the first transcript message
  expect(transcriptUpdates.length).toBeGreaterThan(0);
});

test("SessionManager sendFollowUp throws for unknown session", async () => {
  await expect(
    sessionManager.sendFollowUp("unknown-id", "test message")
  ).rejects.toThrow('Unknown session "unknown-id"');
});

test("SessionManager sendFollowUp throws for non-PI session", async () => {
  const snapshot = sessionManager.queueSession({
    title: "Regular Session",
    command: ["echo", "hello"],
  });

  await new Promise((resolve) => setTimeout(resolve, 100));

  await expect(
    sessionManager.sendFollowUp(snapshot.id, "test message")
  ).rejects.toThrow(`Session "${snapshot.id}" is not a PI session`);
});

test("SessionManager sendFollowUp throws for non-running session", async () => {
  // Create a manager with max 0 concurrent to keep session in queued state
  const limitedManager = new SessionManager({
    maxConcurrent: 0,
    autoInstallShutdownHooks: false,
  });

  const snapshot = limitedManager.queuePiSession({
    title: "PI Session",
    prompt: "Test prompt",
  });

  // Session should remain queued since maxConcurrent is 0
  expect(snapshot.status).toBe("queued");

  await expect(
    limitedManager.sendFollowUp(snapshot.id, "test message")
  ).rejects.toThrow(`Session "${snapshot.id}" is not running`);

  await limitedManager.dispose();
});

test("SessionManager sendFollowUp throws for empty message", async () => {
  const snapshot = sessionManager.queuePiSession({
    title: "PI Session",
    prompt: "Test prompt",
  });

  await expect(
    sessionManager.sendFollowUp(snapshot.id, "   ")
  ).rejects.toThrow("Message text cannot be empty");
});

test("SessionManager snapshot includes canSendFollowUp", async () => {
  // Regular subprocess session
  const regularSnapshot = sessionManager.queueSession({
    title: "Regular Session",
    command: ["echo", "hello"],
  });
  expect(regularSnapshot.canSendFollowUp).toBe(false);

  // PI session (queued, not running)
  const piSnapshot = sessionManager.queuePiSession({
    title: "PI Session",
    prompt: "Test prompt",
  });
  expect(piSnapshot.canSendFollowUp).toBe(false);
});
