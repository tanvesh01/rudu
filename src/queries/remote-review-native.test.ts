import { describe, expect, it } from "bun:test";
import {
  createRemoteReviewNativeCommands,
  type InvokeFn,
} from "./remote-review-native";

describe("createRemoteReviewNativeCommands", () => {
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
        reportPath: "/tmp/report.md",
        createdAt: 1,
        updatedAt: 1,
        lastError: null,
      } as never;
    };

    const commands = createRemoteReviewNativeCommands(invokeFn);
    await commands.prepareReviewWorkspace({
      repo: "tanvesh/rudu",
      number: 1,
      headSha: "abc",
    });

    expect(calls).toEqual([
      {
        command: "prepare_review_workspace",
        args: { repo: "tanvesh/rudu", number: 1, headSha: "abc" },
      },
    ]);
  });

  it("starts chat and reads report by session id", async () => {
    const calls: Array<{ command: string; args?: Record<string, unknown> }> = [];
    const invokeFn: InvokeFn = async (command, args) => {
      calls.push({ command, args });
      return null as never;
    };

    const commands = createRemoteReviewNativeCommands(invokeFn);
    await commands.startReviewAgent("session-1");
    await commands.refreshReviewSession("session-1", "new-head");
    await commands.listReviewWorkspaceFiles("session-1");
    await commands.ensureReviewChatSession("session-1");
    await commands.sendReviewChatMessage("session-1", "turn-1", "hello");
    await commands.cancelReviewChatTurn("session-1", "turn-1");
    await commands.getReviewReport("session-1");

    expect(calls).toEqual([
      {
        command: "start_review_agent",
        args: { sessionId: "session-1" },
      },
      {
        command: "refresh_review_session",
        args: { sessionId: "session-1", headSha: "new-head" },
      },
      {
        command: "list_review_workspace_files",
        args: { sessionId: "session-1" },
      },
      {
        command: "ensure_review_chat_session",
        args: { sessionId: "session-1" },
      },
      {
        command: "send_review_chat_message",
        args: { sessionId: "session-1", turnId: "turn-1", text: "hello" },
      },
      {
        command: "cancel_review_chat_turn",
        args: { sessionId: "session-1", turnId: "turn-1" },
      },
      {
        command: "get_review_report",
        args: { sessionId: "session-1" },
      },
    ]);
  });
});
