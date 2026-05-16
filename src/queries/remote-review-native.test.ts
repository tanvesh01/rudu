import { describe, expect, it } from "bun:test";
import {
  createRemoteReviewNativeCommands,
  type InvokeFn,
} from "./remote-review-native";

describe("createRemoteReviewNativeCommands", () => {
  it("prepares a remote review session with the selected revision", async () => {
    const calls: Array<{ command: string; args?: Record<string, unknown> }> = [];
    const invokeFn: InvokeFn = async (command, args) => {
      calls.push({ command, args });
      return {
        id: "session-1",
        repo: "tanvesh/rudu",
        number: 1,
        headSha: "abc",
        status: "prepared",
        fileContext: null,
        reportPath: "/tmp/report.md",
        createdAt: 1,
        updatedAt: 1,
        lastError: null,
      } as never;
    };

    const commands = createRemoteReviewNativeCommands(invokeFn);
    await commands.prepareRemoteReviewSession({
      repo: "tanvesh/rudu",
      number: 1,
      headSha: "abc",
    });

    expect(calls).toEqual([
      {
        command: "prepare_remote_review_session",
        args: { repo: "tanvesh/rudu", number: 1, headSha: "abc" },
      },
    ]);
  });

  it("hydrates, launches, and reads report by session id", async () => {
    const calls: Array<{ command: string; args?: Record<string, unknown> }> = [];
    const invokeFn: InvokeFn = async (command, args) => {
      calls.push({ command, args });
      return null as never;
    };

    const commands = createRemoteReviewNativeCommands(invokeFn);
    await commands.hydrateRemoteReviewSession("session-1");
    await commands.startRemoteReviewAgent("session-1");
    await commands.ensureRemoteReviewChatSession("session-1");
    await commands.sendRemoteReviewChatMessage("session-1", "turn-1", "hello");
    await commands.cancelRemoteReviewChatTurn("session-1", "turn-1");
    await commands.launchPiReviewTerminal("session-1");
    await commands.getRemoteReviewReport("session-1");

    expect(calls).toEqual([
      {
        command: "hydrate_remote_review_session",
        args: { sessionId: "session-1" },
      },
      {
        command: "start_remote_review_agent",
        args: { sessionId: "session-1" },
      },
      {
        command: "ensure_remote_review_chat_session",
        args: { sessionId: "session-1" },
      },
      {
        command: "send_remote_review_chat_message",
        args: { sessionId: "session-1", turnId: "turn-1", text: "hello" },
      },
      {
        command: "cancel_remote_review_chat_turn",
        args: { sessionId: "session-1", turnId: "turn-1" },
      },
      {
        command: "launch_pi_review_terminal",
        args: { sessionId: "session-1" },
      },
      {
        command: "get_remote_review_report",
        args: { sessionId: "session-1" },
      },
    ]);
  });

  it("reads, pairs, tests, saves, and clears Worker config", async () => {
    const calls: Array<{ command: string; args?: Record<string, unknown> }> = [];
    const invokeFn: InvokeFn = async (command, args) => {
      calls.push({ command, args });
      return null as never;
    };

    const commands = createRemoteReviewNativeCommands(invokeFn);
    await commands.getRemoteReviewWorkerConfig();
    await commands.testRemoteReviewWorkerConfig({
      workerUrl: "https://worker.example",
      apiToken: "secret",
    });
    await commands.pairRemoteReviewWorkerConfig({
      workerUrl: "https://worker.example",
    });
    await commands.saveRemoteReviewWorkerConfig({
      workerUrl: "https://worker.example",
      apiToken: "secret",
    });
    await commands.clearRemoteReviewWorkerConfig();

    expect(calls).toEqual([
      {
        command: "get_remote_review_worker_config",
        args: undefined,
      },
      {
        command: "test_remote_review_worker_config",
        args: { workerUrl: "https://worker.example", apiToken: "secret" },
      },
      {
        command: "pair_remote_review_worker_config",
        args: { workerUrl: "https://worker.example" },
      },
      {
        command: "save_remote_review_worker_config",
        args: { workerUrl: "https://worker.example", apiToken: "secret" },
      },
      {
        command: "clear_remote_review_worker_config",
        args: undefined,
      },
    ]);
  });
});
