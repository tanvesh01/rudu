import { describe, expect, it } from "bun:test";
import {
  normalizeEditorMarkdown,
  roundTripReviewCommentMarkdown,
} from "./markdown";

describe("review comment editor markdown", () => {
  it("round trips GitHub suggestion fences with embedded backticks", () => {
    const markdown = [
      "Before",
      "",
      "````suggestion",
      "const fence = \"```\";",
      "````",
      "",
      "After",
    ].join("\n");

    const roundTripped = roundTripReviewCommentMarkdown(markdown, {
      suggestionLanguage: "typescript",
    });

    expect(roundTripped).toContain("````suggestion");
    expect(roundTripped).toContain('const fence = "```";');
    expect(normalizeEditorMarkdown(roundTripped)).toBe(
      normalizeEditorMarkdown(markdown),
    );
  });

  it("round trips supported markdown formatting without rendering the UI", () => {
    const markdown = [
      "### Heading",
      "",
      "> Quote",
      "",
      "- Item one",
      "- Item two",
      "",
      "`inline` and ~~strike~~",
      "",
      "```",
      "const value = 1;",
      "```",
    ].join("\n");

    expect(
      normalizeEditorMarkdown(roundTripReviewCommentMarkdown(markdown)),
    ).toBe(normalizeEditorMarkdown(markdown));
  });
});
