import { invoke } from "@tauri-apps/api/core";
import type {
  GitHubFileContext,
  RemoteReviewReport,
  RemoteReviewSession,
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
    getRemoteReviewReport(sessionId: string) {
      return invokeCommand<RemoteReviewReport | null>(
        "get_remote_review_report",
        { sessionId },
      );
    },
  };
}

const remoteReviewNativeCommands = createRemoteReviewNativeCommands(invoke);

export const {
  getRemoteReviewReport,
  hydrateRemoteReviewSession,
  launchPiReviewTerminal,
  prepareRemoteReviewSession,
} = remoteReviewNativeCommands;

export { createRemoteReviewNativeCommands };
export type { InvokeFn };
