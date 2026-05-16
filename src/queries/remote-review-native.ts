import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type {
  GitHubFileContext,
  RemoteReviewAgentEvent,
  RemoteReviewChatEvent,
  RemoteReviewReport,
  RemoteReviewSession,
  RemoteReviewWorkerConfigInput,
  RemoteReviewWorkerConfigPairInput,
  RemoteReviewWorkerConfigStatus,
  RemoteReviewWorkerConfigTestInput,
  SelectedPullRequestRevision,
} from "../types/github";

type InvokeFn = <T>(command: string, args?: Record<string, unknown>) => Promise<T>;

function createRemoteReviewNativeCommands(invokeCommand: InvokeFn) {
  return {
    prepareRemoteReviewSession(pr: SelectedPullRequestRevision) {
      return invokeCommand<RemoteReviewSession>("prepare_remote_review_session", {
        repo: pr.repo,
        number: pr.number,
        headSha: pr.headSha,
      });
    },
    hydrateRemoteReviewSession(sessionId: string) {
      return invokeCommand<GitHubFileContext>("hydrate_remote_review_session", {
        sessionId,
      });
    },
    launchPiReviewTerminal(sessionId: string) {
      return invokeCommand<void>("launch_pi_review_terminal", { sessionId });
    },
    startRemoteReviewAgent(sessionId: string) {
      return invokeCommand<void>("start_remote_review_agent", { sessionId });
    },
    ensureRemoteReviewChatSession(sessionId: string) {
      return invokeCommand<void>("ensure_remote_review_chat_session", {
        sessionId,
      });
    },
    sendRemoteReviewChatMessage(sessionId: string, turnId: string, text: string) {
      return invokeCommand<void>("send_remote_review_chat_message", {
        sessionId,
        turnId,
        text,
      });
    },
    cancelRemoteReviewChatTurn(sessionId: string, turnId: string) {
      return invokeCommand<void>("cancel_remote_review_chat_turn", {
        sessionId,
        turnId,
      });
    },
    getRemoteReviewReport(sessionId: string) {
      return invokeCommand<RemoteReviewReport | null>(
        "get_remote_review_report",
        { sessionId },
      );
    },
    getRemoteReviewWorkerConfig() {
      return invokeCommand<RemoteReviewWorkerConfigStatus>(
        "get_remote_review_worker_config",
      );
    },
    saveRemoteReviewWorkerConfig(input: RemoteReviewWorkerConfigInput) {
      return invokeCommand<RemoteReviewWorkerConfigStatus>(
        "save_remote_review_worker_config",
        input,
      );
    },
    pairRemoteReviewWorkerConfig(input: RemoteReviewWorkerConfigPairInput) {
      return invokeCommand<RemoteReviewWorkerConfigStatus>(
        "pair_remote_review_worker_config",
        input,
      );
    },
    clearRemoteReviewWorkerConfig() {
      return invokeCommand<RemoteReviewWorkerConfigStatus>(
        "clear_remote_review_worker_config",
      );
    },
    testRemoteReviewWorkerConfig(input: RemoteReviewWorkerConfigTestInput = {}) {
      return invokeCommand<void>("test_remote_review_worker_config", input);
    },
  };
}

const remoteReviewNativeCommands = createRemoteReviewNativeCommands(invoke);

function listenRemoteReviewAgentEvents(
  handler: (event: RemoteReviewAgentEvent) => void,
): Promise<UnlistenFn> {
  return listen<RemoteReviewAgentEvent>("remote-review-agent-event", ({ payload }) => {
    handler(payload);
  });
}

function listenRemoteReviewChatEvents(
  handler: (event: RemoteReviewChatEvent) => void,
): Promise<UnlistenFn> {
  return listen<RemoteReviewChatEvent>("remote-review-chat-event", ({ payload }) => {
    handler(payload);
  });
}

export const {
  cancelRemoteReviewChatTurn,
  ensureRemoteReviewChatSession,
  getRemoteReviewReport,
  getRemoteReviewWorkerConfig,
  hydrateRemoteReviewSession,
  launchPiReviewTerminal,
  pairRemoteReviewWorkerConfig,
  prepareRemoteReviewSession,
  saveRemoteReviewWorkerConfig,
  sendRemoteReviewChatMessage,
  startRemoteReviewAgent,
  clearRemoteReviewWorkerConfig,
  testRemoteReviewWorkerConfig,
} = remoteReviewNativeCommands;

export {
  createRemoteReviewNativeCommands,
  listenRemoteReviewAgentEvents,
  listenRemoteReviewChatEvents,
};
export type { InvokeFn };
