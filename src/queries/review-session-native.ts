import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type {
  ReviewChatEvent,
  ReviewSession,
  ReviewWorkspaceEvent,
  SelectedPullRequestRevision,
} from "../types/github";

type InvokeFn = <T>(
  command: string,
  args?: Record<string, unknown>,
) => Promise<T>;
type ReviewWorkspaceEventHandler = (
  event: ReviewWorkspaceEvent,
) => void;

async function withReviewWorkspaceEvents<T>(
  handler: ReviewWorkspaceEventHandler | undefined,
  run: () => Promise<T>,
) {
  const unlisten = handler
    ? await listenReviewWorkspaceEvents(handler)
    : null;

  try {
    return await run();
  } finally {
    unlisten?.();
  }
}

function createReviewSessionNativeCommands(invokeCommand: InvokeFn) {
  return {
    prepareReviewWorkspace(
      pr: SelectedPullRequestRevision,
      onWorkspaceEvent?: ReviewWorkspaceEventHandler,
    ) {
      return withReviewWorkspaceEvents(onWorkspaceEvent, () =>
        invokeCommand<ReviewSession>("prepare_review_workspace", {
          repo: pr.repo,
          number: pr.number,
          headSha: pr.headSha,
        }),
      );
    },
    refreshReviewSession(
      sessionId: string,
      headSha: string,
      onWorkspaceEvent?: ReviewWorkspaceEventHandler,
    ) {
      return withReviewWorkspaceEvents(onWorkspaceEvent, () =>
        invokeCommand<ReviewSession>("refresh_review_session", {
          sessionId,
          headSha,
        }),
      );
    },
    listReviewWorkspaceFiles(sessionId: string) {
      return invokeCommand<string[]>("list_review_workspace_files", {
        sessionId,
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
  };
}

const reviewSessionNativeCommands = createReviewSessionNativeCommands(invoke);

function listenReviewChatEvents(
  handler: (event: ReviewChatEvent) => void,
): Promise<UnlistenFn> {
  return listen<ReviewChatEvent>("review-chat-event", ({ payload }) => {
    handler(payload);
  });
}

function listenReviewWorkspaceEvents(
  handler: ReviewWorkspaceEventHandler,
): Promise<UnlistenFn> {
  return listen<ReviewWorkspaceEvent>(
    "review-workspace-event",
    ({ payload }) => {
      handler(payload);
    },
  );
}

export const {
  cancelReviewChatTurn,
  ensureReviewChatSession,
  listReviewWorkspaceFiles,
  prepareReviewWorkspace,
  refreshReviewSession,
  sendReviewChatMessage,
} = reviewSessionNativeCommands;

export {
  createReviewSessionNativeCommands,
  listenReviewChatEvents,
  listenReviewWorkspaceEvents,
};
export type { InvokeFn, ReviewWorkspaceEventHandler };
