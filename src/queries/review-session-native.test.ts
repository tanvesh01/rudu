import { describe, expect, it } from "bun:test";
import {
  createReviewSessionNativeCommands,
  type InvokeFn,
} from "./review-session-native";

describe("createReviewSessionNativeCommands", () => {
  it("prepares a review workspace with the selected revision", async () => {
    const calls: Array<{ command: string; args?: Record<string, unknown> }> = [];
    const invokeFn: InvokeFn = async (command, args) => {
      calls.push({ command, args });
      return {
        id: "session-1",
        repo: "tanvesh/rudu",
        number: 1,
        headSha: "abc",
        status: "indexed",
        workspacePath: "/tmp/workspace",
        agentSessionId: null,
        agentContextHeadSha: null,
        createdAt: 1,
        updatedAt: 1,
        lastError: null,
      } as never;
    };

    const commands = createReviewSessionNativeCommands(invokeFn);
    await commands.getReviewChatReadiness();
    await commands.loadReviewSession("tanvesh/rudu", 1);
    await commands.prepareReviewWorkspace({
      repo: "tanvesh/rudu",
      number: 1,
      headSha: "abc",
    });

    expect(calls).toEqual([
      {
        command: "get_review_chat_readiness",
        args: undefined,
      },
      {
        command: "load_review_session",
        args: { repo: "tanvesh/rudu", number: 1 },
      },
      {
        command: "prepare_review_workspace",
        args: { repo: "tanvesh/rudu", number: 1, headSha: "abc" },
      },
    ]);
  });

  it("runs review session commands by session id", async () => {
    const calls: Array<{ command: string; args?: Record<string, unknown> }> = [];
    const invokeFn: InvokeFn = async (command, args) => {
      calls.push({ command, args });
      return null as never;
    };

    const commands = createReviewSessionNativeCommands(invokeFn);
    await commands.refreshReviewSession("session-1", "new-head", 3);
    await commands.listReviewWorkspaceFiles("session-1");
    await commands.generateReviewWalkthrough("session-1");
    await commands.ensureReviewChatSession("session-1");
    await commands.loadReviewChatTranscript("session-1");
    await commands.saveReviewChatTranscript("session-1", [
      { id: "message-1", role: "user", parts: [{ type: "text", text: "hi" }] },
    ]);
    await commands.setReviewChatEffortMode("session-1", "deep", 2);
    await commands.setPendingReviewChatEffortMode("session-1", "fast");
    await commands.sendReviewChatMessage("session-1", "turn-1", "hello");
    await commands.cancelReviewChatTurn("session-1", "turn-1");

    expect(calls).toEqual([
      {
        command: "refresh_review_session",
        args: { sessionId: "session-1", headSha: "new-head", messageCount: 3 },
      },
      {
        command: "list_review_workspace_files",
        args: { sessionId: "session-1" },
      },
      {
        command: "generate_review_walkthrough",
        args: { sessionId: "session-1" },
      },
      {
        command: "ensure_review_chat_session",
        args: { sessionId: "session-1" },
      },
      {
        command: "load_review_chat_transcript",
        args: { sessionId: "session-1" },
      },
      {
        command: "save_review_chat_transcript",
        args: {
          sessionId: "session-1",
          messages: [
            {
              id: "message-1",
              role: "user",
              parts: [{ type: "text", text: "hi" }],
            },
          ],
        },
      },
      {
        command: "set_review_chat_effort_mode",
        args: { sessionId: "session-1", mode: "deep", messageCount: 2 },
      },
      {
        command: "set_pending_review_chat_effort_mode",
        args: { sessionId: "session-1", mode: "fast" },
      },
      {
        command: "send_review_chat_message",
        args: { sessionId: "session-1", turnId: "turn-1", text: "hello" },
      },
      {
        command: "cancel_review_chat_turn",
        args: { sessionId: "session-1", turnId: "turn-1" },
      },
    ]);
  });
});
