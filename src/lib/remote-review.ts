import type {
  RemoteReviewSession,
  SelectedPullRequestRevision,
} from "../types/github";

function getRemoteReviewSessionKey(pr: SelectedPullRequestRevision) {
  return `${pr.repo}#${pr.number}`;
}

function isRemoteReviewSessionStale(
  session: RemoteReviewSession | null,
  selectedRevision: SelectedPullRequestRevision | null,
) {
  if (!session || !selectedRevision) {
    return false;
  }

  return (
    session.repo !== selectedRevision.repo ||
    session.number !== selectedRevision.number
  );
}

function getRemoteReviewStatusLabel(session: RemoteReviewSession | null) {
  switch (session?.status) {
    case "prepared":
      return "Prepared";
    case "indexed":
      return "Indexed";
    case "launched":
      return "Pi launched";
    case "stale":
      return "Stale";
    case "failed":
      return "Failed";
    case undefined:
      return "No session";
  }
}

export {
  getRemoteReviewSessionKey,
  getRemoteReviewStatusLabel,
  isRemoteReviewSessionStale,
};
