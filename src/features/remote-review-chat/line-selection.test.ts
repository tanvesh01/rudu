import { describe, expect, it } from "bun:test";
import type { FileDiffMetadata, SelectedLineRange } from "@pierre/diffs";
import {
  buildPromptWithSelectionContext,
  buildRemoteReviewLineSelection,
} from "./line-selection";

const FILE_DIFF: FileDiffMetadata = {
  name: "src/example.ts",
  type: "change",
  hunks: [],
  splitLineCount: 0,
  unifiedLineCount: 0,
  isPartial: true,
  deletionLines: ["before()", "oldCall()", "return oldValue;"],
  additionLines: ["before()", "newCall()", "return newValue;"],
};

describe("remote review line selection helpers", () => {
  it("normalizes reversed ranges and extracts added-line snippets", () => {
    const range: SelectedLineRange = {
      start: 3,
      side: "additions",
      end: 2,
      endSide: "additions",
    };

    expect(buildRemoteReviewLineSelection(FILE_DIFF, range)).toEqual({
      path: "src/example.ts",
      startLine: 2,
      endLine: 3,
      startSide: "additions",
      endSide: "additions",
      lineCount: 2,
      label: "Lines 2-3",
      sideLabel: "Added lines",
      snippet: "newCall()\nreturn newValue;",
      isSnippetTruncated: false,
    });
  });

  it("omits snippets for mixed-side selections", () => {
    const range: SelectedLineRange = {
      start: 2,
      side: "deletions",
      end: 2,
      endSide: "additions",
    };

    expect(buildRemoteReviewLineSelection(FILE_DIFF, range)).toEqual({
      path: "src/example.ts",
      startLine: 2,
      endLine: 2,
      startSide: "deletions",
      endSide: "additions",
      lineCount: 1,
      label: "Line 2",
      sideLabel: "Mixed diff selection",
      snippet: null,
      isSnippetTruncated: false,
    });
  });

  it("prefixes outgoing prompts with selected diff context", () => {
    const selection = buildRemoteReviewLineSelection(FILE_DIFF, {
      start: 2,
      side: "additions",
      end: 2,
      endSide: "additions",
    });

    expect(buildPromptWithSelectionContext("Explain this change", selection))
      .toBe(`Selected diff context:
File: src/example.ts
Range: Line 2
Side: Added lines
Snippet:
\`\`\`
newCall()
\`\`\`

User request:
Explain this change`);
  });
});
