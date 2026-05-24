import { queryOptions } from "@tanstack/react-query";
import {
  getReviewChatReadiness,
  loadReviewSession,
  prepareReviewWorkspace,
} from "./review-session-native";
import type {
  ReviewChatAdapterInstallEvent,
  SelectedPullRequestRevision,
} from "../types/github";

const reviewSessionKeys = {
  all: ["review-session"] as const,
  readiness: () => [...reviewSessionKeys.all, "review-chat-readiness"] as const,
  sessions: () => [...reviewSessionKeys.all, "sessions"] as const,
  session: (pr: Pick<SelectedPullRequestRevision, "repo" | "number">) =>
    [...reviewSessionKeys.sessions(), pr.repo, pr.number] as const,
  workspace: (pr: SelectedPullRequestRevision) =>
    [...reviewSessionKeys.session(pr), "workspace", pr.headSha] as const,
};

function reviewSessionQueryOptions(
  pr: Pick<SelectedPullRequestRevision, "repo" | "number">,
) {
  return queryOptions({
    queryKey: reviewSessionKeys.session(pr),
    queryFn: () => loadReviewSession(pr.repo, pr.number),
    staleTime: Infinity,
  });
}

function reviewChatReadinessQueryOptions(
  onAdapterInstallEvent?: (event: ReviewChatAdapterInstallEvent) => void,
) {
  return queryOptions({
    queryKey: reviewSessionKeys.readiness(),
    queryFn: () => getReviewChatReadiness(onAdapterInstallEvent),
    staleTime: Infinity,
    retry: false,
  });
}

function prepareReviewWorkspaceQueryOptions(pr: SelectedPullRequestRevision) {
  return queryOptions({
    queryKey: reviewSessionKeys.workspace(pr),
    queryFn: () => prepareReviewWorkspace(pr),
    staleTime: Infinity,
  });
}

export {
  prepareReviewWorkspaceQueryOptions,
  reviewChatReadinessQueryOptions,
  reviewSessionKeys,
  reviewSessionQueryOptions,
};
