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
    await commands.launchPiReviewTerminal("session-1");
    await commands.getRemoteReviewReport("session-1");

    expect(calls).toEqual([
      {
        command: "hydrate_remote_review_session",
        args: { sessionId: "session-1" },
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
});
