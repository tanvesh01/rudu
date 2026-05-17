import { queryOptions } from "@tanstack/react-query";
import {
  prepareReviewWorkspace,
  type ReviewWorkspaceEventHandler,
} from "./review-session-native";
import type { SelectedPullRequestRevision } from "../types/github";

const reviewSessionKeys = {
  all: ["review-session"] as const,
  sessions: () => [...reviewSessionKeys.all, "sessions"] as const,
  session: (pr: SelectedPullRequestRevision) =>
    [...reviewSessionKeys.sessions(), pr.repo, pr.number] as const,
};

type ReviewSessionQueryOptionsInput = {
  onWorkspaceEvent?: ReviewWorkspaceEventHandler;
};

function reviewSessionQueryOptions(
  pr: SelectedPullRequestRevision,
  options: ReviewSessionQueryOptionsInput = {},
) {
  return queryOptions({
    queryKey: reviewSessionKeys.session(pr),
    queryFn: () => prepareReviewWorkspace(pr, options.onWorkspaceEvent),
    staleTime: Infinity,
  });
}

export { reviewSessionKeys, reviewSessionQueryOptions };
