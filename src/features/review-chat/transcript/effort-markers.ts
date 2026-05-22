import type { ReviewRevisionCheckpoint } from "../../../types/github";

function revisionCheckpointsForMessageCount(
  checkpoints: ReviewRevisionCheckpoint[],
  messageCount: number,
) {
  return checkpoints.filter(
    (checkpoint) => checkpoint.messageCount === messageCount,
  );
}

export { revisionCheckpointsForMessageCount };
