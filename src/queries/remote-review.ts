import { queryOptions } from "@tanstack/react-query";
import {
  prepareReviewWorkspace,
  type RemoteReviewWorkspaceEventHandler,
} from "./remote-review-native";
import type { SelectedPullRequestRevision } from "../types/github";

const remoteReviewKeys = {
  all: ["remote-review"] as const,
  sessions: () => [...remoteReviewKeys.all, "sessions"] as const,
  session: (pr: SelectedPullRequestRevision) =>
    [...remoteReviewKeys.sessions(), pr.repo, pr.number] as const,
};

type RemoteReviewSessionQueryOptionsInput = {
  onWorkspaceEvent?: RemoteReviewWorkspaceEventHandler;
};

function remoteReviewSessionQueryOptions(
  pr: SelectedPullRequestRevision,
  options: RemoteReviewSessionQueryOptionsInput = {},
) {
  return queryOptions({
    queryKey: remoteReviewKeys.session(pr),
    queryFn: () => prepareReviewWorkspace(pr, options.onWorkspaceEvent),
    staleTime: Infinity,
  });
}

export { remoteReviewKeys, remoteReviewSessionQueryOptions };
