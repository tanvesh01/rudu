import { describe, expect, it } from "bun:test";
import {
  buildSuggestionPatch,
  parseCommentBodySegments,
} from "./review-comment-body";

describe("parseCommentBodySegments", () => {
  it("splits markdown and GitHub suggestion fences", () => {
    expect(
      parseCommentBodySegments(
        [
          "Before",
          "",
          "```suggestion",
          "const value = 1;",
          "```",
          "",
          "After",
        ].join("\n"),
      ),
    ).toEqual([
      { type: "markdown", body: "Before\n" },
      { type: "suggestion", body: "const value = 1;" },
      { type: "markdown", body: "\nAfter" },
    ]);
  });

  it("leaves an unclosed suggestion fence as markdown", () => {
    expect(
      parseCommentBodySegments(
        ["Before", "```suggestion", "const value = 1;"].join("\n"),
      ),
    ).toEqual([
      {
        type: "markdown",
        body: "Before\n```suggestion\nconst value = 1;",
      },
    ]);
  });
});

describe("buildSuggestionPatch", () => {
  it("builds a synthetic unified patch for the selected line range", () => {
    expect(
      buildSuggestionPatch(
        "src/example.ts",
        12,
        14,
        "const oldValue = 1;\nreturn oldValue;",
        "const newValue = 2;\nreturn newValue;",
      ),
    ).toBe(
      [
        "diff --git a/src/example.ts b/src/example.ts",
        "--- a/src/example.ts",
        "+++ b/src/example.ts",
        "@@ -12,2 +12,2 @@",
        "-const oldValue = 1;",
        "-return oldValue;",
        "+const newValue = 2;",
        "+return newValue;",
        "",
      ].join("\n"),
    );
  });

  it("removes interleaved blank rows from seeded suggestion text", () => {
    expect(
      buildSuggestionPatch(
        "src/example.ts",
        57,
        59,
        "repos,\n\nselectedPr,\n\nrefreshTrackedPullRequests,",
        "repos,\nselectedPr,\nrefreshTrackedPullRequests,\nheycom",
      ),
    ).toBe(
      [
        "diff --git a/src/example.ts b/src/example.ts",
        "--- a/src/example.ts",
        "+++ b/src/example.ts",
        "@@ -57,3 +57,4 @@",
        "-repos,",
        "-selectedPr,",
        "-refreshTrackedPullRequests,",
        "+repos,",
        "+selectedPr,",
        "+refreshTrackedPullRequests,",
        "+heycom",
        "",
      ].join("\n"),
    );
  });

  it("preserves intentional blank rows in the submitted suggestion", () => {
    expect(
      buildSuggestionPatch(
        "src/example.ts",
        57,
        58,
        "repos,\nselectedPr,",
        "repos,\n\nselectedPr,",
      ),
    ).toBe(
      [
        "diff --git a/src/example.ts b/src/example.ts",
        "--- a/src/example.ts",
        "+++ b/src/example.ts",
        "@@ -57,2 +57,3 @@",
        "-repos,",
        "-selectedPr,",
        "+repos,",
        "+",
        "+selectedPr,",
        "",
      ].join("\n"),
    );
  });
});
