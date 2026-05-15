import { queryOptions } from "@tanstack/react-query";
import {
  getRemoteReviewReport,
  prepareRemoteReviewSession,
} from "./remote-review-native";
import type { SelectedPullRequestRevision } from "../types/github";

const remoteReviewKeys = {
  all: ["remote-review"] as const,
  sessions: () => [...remoteReviewKeys.all, "sessions"] as const,
  session: (pr: SelectedPullRequestRevision) =>
    [
      ...remoteReviewKeys.sessions(),
      pr.repo,
      pr.number,
      pr.headSha,
    ] as const,
  reports: () => [...remoteReviewKeys.all, "reports"] as const,
  report: (sessionId: string) =>
    [...remoteReviewKeys.reports(), sessionId] as const,
};

function remoteReviewSessionQueryOptions(pr: SelectedPullRequestRevision) {
  return queryOptions({
    queryKey: remoteReviewKeys.session(pr),
    queryFn: () => prepareRemoteReviewSession(pr),
    staleTime: 0,
  });
}

function remoteReviewReportQueryOptions(sessionId: string) {
  return queryOptions({
    queryKey: remoteReviewKeys.report(sessionId),
    queryFn: () => getRemoteReviewReport(sessionId),
    staleTime: 0,
  });
}

export {
  remoteReviewKeys,
  remoteReviewReportQueryOptions,
  remoteReviewSessionQueryOptions,
};
