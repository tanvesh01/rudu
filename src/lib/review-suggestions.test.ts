import { describe, expect, it } from "bun:test";
import { isAdditionOnlyReviewRange } from "./review-suggestions";

describe("isAdditionOnlyReviewRange", () => {
  it("allows single-line addition comments", () => {
    expect(
      isAdditionOnlyReviewRange({
        endSide: "RIGHT",
        hasStartLine: false,
        startSide: null,
      }),
    ).toBe(true);
  });

  it("allows multi-line ranges when start and end are additions", () => {
    expect(
      isAdditionOnlyReviewRange({
        endSide: "RIGHT",
        hasStartLine: true,
        startSide: "RIGHT",
      }),
    ).toBe(true);
  });

  it("rejects deletion-only and mixed ranges", () => {
    expect(
      isAdditionOnlyReviewRange({
        endSide: "LEFT",
        hasStartLine: false,
        startSide: null,
      }),
    ).toBe(false);

    expect(
      isAdditionOnlyReviewRange({
        endSide: "RIGHT",
        hasStartLine: true,
        startSide: "LEFT",
      }),
    ).toBe(false);
  });

  it("rejects multi-line ranges when the start side is unknown", () => {
    expect(
      isAdditionOnlyReviewRange({
        endSide: "RIGHT",
        hasStartLine: true,
        startSide: null,
      }),
    ).toBe(false);
  });
});
