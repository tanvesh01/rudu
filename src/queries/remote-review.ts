import { queryOptions } from "@tanstack/react-query";
import { prepareReviewWorkspace } from "./remote-review-native";
import type { SelectedPullRequestRevision } from "../types/github";

const remoteReviewKeys = {
  all: ["remote-review"] as const,
  sessions: () => [...remoteReviewKeys.all, "sessions"] as const,
  session: (pr: SelectedPullRequestRevision) =>
    [
      ...remoteReviewKeys.sessions(),
      pr.repo,
      pr.number,
    ] as const,
};

function remoteReviewSessionQueryOptions(pr: SelectedPullRequestRevision) {
  return queryOptions({
    queryKey: remoteReviewKeys.session(pr),
    queryFn: () => prepareReviewWorkspace(pr),
    staleTime: Infinity,
  });
}

export {
  remoteReviewKeys,
  remoteReviewSessionQueryOptions,
};
