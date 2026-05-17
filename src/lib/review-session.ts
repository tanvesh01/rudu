import type {
  ReviewSession,
  SelectedPullRequestRevision,
} from "../types/github";

function getReviewSessionKey(pr: SelectedPullRequestRevision) {
  return `${pr.repo}#${pr.number}`;
}

function isReviewSessionStale(
  session: ReviewSession | null,
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

function getReviewSessionStatusLabel(session: ReviewSession | null) {
  switch (session?.status) {
    case "prepared":
      return "Prepared";
    case "indexed":
      return "Indexed";
    case "launched":
      return "Rudu launched";
    case "stale":
      return "Stale";
    case "failed":
      return "Failed";
    case undefined:
      return "No session";
  }
}

export {
  getReviewSessionKey,
  getReviewSessionStatusLabel,
  isReviewSessionStale,
};
