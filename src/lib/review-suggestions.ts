import type { ReviewCommentSide } from "../types/github";

function isAdditionOnlyReviewRange({
  endSide,
  hasStartLine,
  startSide,
}: {
  endSide: ReviewCommentSide | null;
  hasStartLine: boolean;
  startSide: ReviewCommentSide | null;
}) {
  return endSide === "RIGHT" && (!hasStartLine || startSide === "RIGHT");
}

export { isAdditionOnlyReviewRange };
