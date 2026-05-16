import type {
  RemoteReviewSession,
  RemoteReviewWorkerConfigStatus,
  SelectedPullRequestRevision,
} from "../types/github";

function getRemoteReviewSessionKey(pr: SelectedPullRequestRevision) {
  return `${pr.repo}#${pr.number}@${pr.headSha}`;
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
    session.number !== selectedRevision.number ||
    session.headSha !== selectedRevision.headSha
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

function shouldHydrateRemoteReviewSession(session: RemoteReviewSession) {
  return session.status !== "indexed" && session.status !== "launched";
}

function canPrepareRemoteReviewSession(
  workerConfig: RemoteReviewWorkerConfigStatus | null,
) {
  return workerConfig?.configured === true;
}

export {
  canPrepareRemoteReviewSession,
  getRemoteReviewSessionKey,
  getRemoteReviewStatusLabel,
  isRemoteReviewSessionStale,
  shouldHydrateRemoteReviewSession,
};
