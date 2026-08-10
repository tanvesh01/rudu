import { describe, expect, it } from "bun:test";
import { getLocalReviewScope } from "./local-review-scope";

const source = {
  kind: "git_diff" as const,
  target: "origin/main...HEAD",
  staged: false,
  includeUntracked: true,
  paths: [],
};

describe("local review scopes", () => {
  it("keeps working-tree notes stable and selected-diff notes revision-scoped", () => {
    expect(
      getLocalReviewScope(null, "revision-1", "revision-1", true),
    ).toBe("working-tree");
    expect(getLocalReviewScope(null, "revision-1", "revision-1", false)).toBeNull();
    expect(
      getLocalReviewScope(source, "revision-1", "old-revision", true),
    ).toBeNull();
    expect(
      getLocalReviewScope(source, "same-revision", "same-revision", false),
    ).toBeNull();
    expect(
      getLocalReviewScope(source, "revision-1", "revision-1", true),
    ).not.toBe(
      getLocalReviewScope(source, "revision-2", "revision-2", true),
    );
  });
});
