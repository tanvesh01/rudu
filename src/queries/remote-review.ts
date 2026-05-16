import { queryOptions } from "@tanstack/react-query";
import {
  getRemoteReviewWorkerConfig,
  prepareRemoteReviewSession,
} from "./remote-review-native";
import type { SelectedPullRequestRevision } from "../types/github";

const remoteReviewKeys = {
  all: ["remote-review"] as const,
  workerConfig: () => [...remoteReviewKeys.all, "worker-config"] as const,
  sessions: () => [...remoteReviewKeys.all, "sessions"] as const,
  session: (pr: SelectedPullRequestRevision) =>
    [
      ...remoteReviewKeys.sessions(),
      pr.repo,
      pr.number,
      pr.headSha,
    ] as const,
};

function remoteReviewWorkerConfigQueryOptions() {
  return queryOptions({
    queryKey: remoteReviewKeys.workerConfig(),
    queryFn: getRemoteReviewWorkerConfig,
    staleTime: 0,
  });
}

function remoteReviewSessionQueryOptions(pr: SelectedPullRequestRevision) {
  return queryOptions({
    queryKey: remoteReviewKeys.session(pr),
    queryFn: () => prepareRemoteReviewSession(pr),
    staleTime: 0,
  });
}

export {
  remoteReviewKeys,
  remoteReviewSessionQueryOptions,
  remoteReviewWorkerConfigQueryOptions,
};
