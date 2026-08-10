import type { LocalDiffSource } from "../types/local-checkouts";

const WORKING_TREE_REVIEW_SCOPE = "working-tree";

function getLocalReviewScope(
  source: LocalDiffSource | null,
  revision: string,
  displayedRevision: string | null,
  isCurrentPatch: boolean,
): string | null {
  if (!revision || !isCurrentPatch || displayedRevision !== revision) {
    return null;
  }
  return source
    ? JSON.stringify({ source, revision })
    : WORKING_TREE_REVIEW_SCOPE;
}

export { getLocalReviewScope, WORKING_TREE_REVIEW_SCOPE };
