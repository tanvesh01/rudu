import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type {
  ReviewChatAdapterInstallEvent,
  ReviewChatEvent,
  ReviewChatReadinessStatus,
  ReviewChatTranscript,
  ReviewSession,
  ReviewWalkthrough,
  ReviewWalkthroughEvent,
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
type ReviewChatAdapterInstallEventHandler = (
  event: ReviewChatAdapterInstallEvent,
) => void;
type ReviewWalkthroughEventHandler = (event: ReviewWalkthroughEvent) => void;

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

async function withReviewWalkthroughEvents<T>(
  handler: ReviewWalkthroughEventHandler | undefined,
  run: () => Promise<T>,
) {
  const unlisten = handler
    ? await listenReviewWalkthroughEvents(handler)
    : null;

  try {
    return await run();
  } finally {
    unlisten?.();
  }
}

async function withReviewChatAdapterInstallEvents<T>(
  handler: ReviewChatAdapterInstallEventHandler | undefined,
  run: () => Promise<T>,
) {
  const unlisten = handler
    ? await listenReviewChatAdapterInstallEvents(handler)
    : null;

  try {
    return await run();
  } finally {
    unlisten?.();
  }
}

function createReviewSessionNativeCommands(invokeCommand: InvokeFn) {
  return {
    getReviewChatReadiness(
      onAdapterInstallEvent?: ReviewChatAdapterInstallEventHandler,
    ) {
      return withReviewChatAdapterInstallEvents(onAdapterInstallEvent, () =>
        invokeCommand<ReviewChatReadinessStatus>(
          "get_review_chat_readiness",
        ),
      );
    },
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
    loadReviewSession(repo: string, number: number) {
      return invokeCommand<ReviewSession | null>("load_review_session", {
        repo,
        number,
      });
    },
    refreshReviewSession(
      sessionId: string,
      headSha: string,
      messageCount: number,
      onWorkspaceEvent?: ReviewWorkspaceEventHandler,
    ) {
      return withReviewWorkspaceEvents(onWorkspaceEvent, () =>
        invokeCommand<ReviewSession>("refresh_review_session", {
          sessionId,
          headSha,
          messageCount,
        }),
      );
    },
    listReviewWorkspaceFiles(sessionId: string) {
      return invokeCommand<string[]>("list_review_workspace_files", {
        sessionId,
      });
    },
    generateReviewWalkthrough(
      sessionId: string,
      onWalkthroughEvent?: ReviewWalkthroughEventHandler,
    ) {
      return withReviewWalkthroughEvents(onWalkthroughEvent, () =>
        invokeCommand<ReviewWalkthrough>("generate_review_walkthrough", {
          sessionId,
        }),
      );
    },
    ensureReviewChatSession(sessionId: string) {
      return invokeCommand<void>("ensure_review_chat_session", {
        sessionId,
      });
    },
    loadReviewChatTranscript(sessionId: string) {
      return invokeCommand<ReviewChatTranscript>("load_review_chat_transcript", {
        sessionId,
      });
    },
    saveReviewChatTranscript(sessionId: string, messages: unknown[]) {
      return invokeCommand<void>("save_review_chat_transcript", {
        sessionId,
        messages,
      });
    },
    setReviewChatEffortMode(
      sessionId: string,
      mode: "fast" | "deep",
      messageCount: number,
    ) {
      return invokeCommand<void>("set_review_chat_effort_mode", {
        sessionId,
        mode,
        messageCount,
      });
    },
    setPendingReviewChatEffortMode(sessionId: string, mode: "fast" | "deep") {
      return invokeCommand<void>("set_pending_review_chat_effort_mode", {
        sessionId,
        mode,
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

function listenReviewChatAdapterInstallEvents(
  handler: ReviewChatAdapterInstallEventHandler,
): Promise<UnlistenFn> {
  return listen<ReviewChatAdapterInstallEvent>(
    "review-chat-adapter-install-event",
    ({ payload }) => {
      handler(payload);
    },
  );
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

function listenReviewWalkthroughEvents(
  handler: ReviewWalkthroughEventHandler,
): Promise<UnlistenFn> {
  return listen<ReviewWalkthroughEvent>("review-walkthrough-event", ({
    payload,
  }) => {
    handler(payload);
  });
}

export const {
  cancelReviewChatTurn,
  ensureReviewChatSession,
  getReviewChatReadiness,
  generateReviewWalkthrough,
  listReviewWorkspaceFiles,
  loadReviewSession,
  loadReviewChatTranscript,
  prepareReviewWorkspace,
  refreshReviewSession,
  saveReviewChatTranscript,
  setReviewChatEffortMode,
  setPendingReviewChatEffortMode,
  sendReviewChatMessage,
} = reviewSessionNativeCommands;

export {
  createReviewSessionNativeCommands,
  listenReviewChatAdapterInstallEvents,
  listenReviewChatEvents,
  listenReviewWalkthroughEvents,
  listenReviewWorkspaceEvents,
};
export type {
  InvokeFn,
  ReviewChatAdapterInstallEventHandler,
  ReviewWalkthroughEventHandler,
  ReviewWorkspaceEventHandler,
};
