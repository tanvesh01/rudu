import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type {
  RemoteReviewAgentEvent,
  RemoteReviewChatEvent,
  RemoteReviewReport,
  RemoteReviewSession,
  SelectedPullRequestRevision,
} from "../types/github";

type InvokeFn = <T>(command: string, args?: Record<string, unknown>) => Promise<T>;

function createRemoteReviewNativeCommands(invokeCommand: InvokeFn) {
  return {
    prepareReviewWorkspace(pr: SelectedPullRequestRevision) {
      return invokeCommand<RemoteReviewSession>("prepare_review_workspace", {
        repo: pr.repo,
        number: pr.number,
        headSha: pr.headSha,
      });
    },
    startReviewAgent(sessionId: string) {
      return invokeCommand<void>("start_review_agent", { sessionId });
    },
    refreshReviewSession(sessionId: string, headSha: string) {
      return invokeCommand<RemoteReviewSession>("refresh_review_session", {
        sessionId,
        headSha,
      });
    },
    ensureReviewChatSession(sessionId: string) {
      return invokeCommand<void>("ensure_review_chat_session", {
        sessionId,
      });
    },
    sendReviewChatMessage(sessionId: string, turnId: string, text: string) {
      return invokeCommand<void>("send_review_chat_message", {
        sessionId,
        turnId,
        text,
      });
    },
    cancelReviewChatTurn(sessionId: string, turnId: string) {
      return invokeCommand<void>("cancel_review_chat_turn", {
        sessionId,
        turnId,
      });
    },
    getReviewReport(sessionId: string) {
      return invokeCommand<RemoteReviewReport | null>("get_review_report", {
        sessionId,
      });
    },
  };
}

const remoteReviewNativeCommands = createRemoteReviewNativeCommands(invoke);

function listenRemoteReviewAgentEvents(
  handler: (event: RemoteReviewAgentEvent) => void,
): Promise<UnlistenFn> {
  return listen<RemoteReviewAgentEvent>("review-agent-event", ({ payload }) => {
    handler(payload);
  });
}

function listenRemoteReviewChatEvents(
  handler: (event: RemoteReviewChatEvent) => void,
): Promise<UnlistenFn> {
  return listen<RemoteReviewChatEvent>("review-chat-event", ({ payload }) => {
    handler(payload);
  });
}

export const {
  cancelReviewChatTurn,
  ensureReviewChatSession,
  getReviewReport,
  prepareReviewWorkspace,
  refreshReviewSession,
  sendReviewChatMessage,
  startReviewAgent,
} = remoteReviewNativeCommands;

export {
  createRemoteReviewNativeCommands,
  listenRemoteReviewAgentEvents,
  listenRemoteReviewChatEvents,
};
export type { InvokeFn };
