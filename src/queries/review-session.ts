import { queryOptions } from "@tanstack/react-query";
import {
  getReviewChatReadinessForRuntime,
  loadReviewSession,
  prepareReviewWorkspace,
} from "./review-session-native";
import type {
  ReviewChatAdapterInstallEvent,
  ReviewChatRuntimeKind,
  SelectedPullRequestRevision,
} from "../types/github";

const reviewSessionKeys = {
  all: ["review-session"] as const,
  readiness: (runtime: ReviewChatRuntimeKind) =>
    [...reviewSessionKeys.all, "review-chat-readiness", runtime] as const,
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
  runtime: ReviewChatRuntimeKind,
  onAdapterInstallEvent?: (event: ReviewChatAdapterInstallEvent) => void,
) {
  return queryOptions({
    queryKey: reviewSessionKeys.readiness(runtime),
    queryFn: () => getReviewChatReadinessForRuntime(runtime, onAdapterInstallEvent),
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
