import { describe, expect, it } from "bun:test";
import type { ReviewRevisionCheckpoint } from "../../../types/github";
import { revisionCheckpointsForMessageCount } from "./effort-markers";

function checkpoint(
  id: string,
  messageCount: number,
): ReviewRevisionCheckpoint {
  return {
    id,
    sessionId: "session-1",
    headSha: "head-b",
    previousHeadSha: "head-a",
    messageCount,
    createdAt: 1,
  };
}

describe("transcript marker helpers", () => {
  it("finds revision checkpoints anchored at transcript positions", () => {
    const checkpoints = [checkpoint("first", 0), checkpoint("later", 3)];

    expect(revisionCheckpointsForMessageCount(checkpoints, 0)).toEqual([
      checkpoints[0],
    ]);
    expect(revisionCheckpointsForMessageCount(checkpoints, 3)).toEqual([
      checkpoints[1],
    ]);
  });
});
