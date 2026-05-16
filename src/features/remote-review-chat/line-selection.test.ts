import { describe, expect, it } from "bun:test";
import type { FileDiffMetadata, SelectedLineRange } from "@pierre/diffs";
import {
  addReviewChatAttachment,
  buildPromptWithAttachments,
  buildPromptWithSelectionContext,
  buildRemoteReviewLineSelection,
  createDiffLinesAttachment,
  createPullRequestAttachment,
  createWorkspaceFileAttachment,
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

  it("prefixes outgoing prompts with mixed attachment summaries", () => {
    const selection = buildRemoteReviewLineSelection(FILE_DIFF, {
      start: 2,
      side: "additions",
      end: 2,
      endSide: "additions",
    });

    expect(
      buildPromptWithAttachments("Compare these", [
        createDiffLinesAttachment(selection!),
        createWorkspaceFileAttachment("src/App.tsx"),
        createPullRequestAttachment("tanvesh/rudu", {
          number: 57,
          title: "Add issues sidebar view",
          state: "OPEN",
          isDraft: true,
          mergeStateStatus: "UNKNOWN",
          mergeable: "UNKNOWN",
          additions: 1,
          deletions: 2,
          authorLogin: "tanvesh",
          updatedAt: "2026-05-16T00:00:00Z",
          url: "https://github.com/tanvesh/rudu/pull/57",
          headSha: "abc123",
          baseSha: null,
        }),
      ]),
    ).toBe(`Selected diff context:
File: src/example.ts
Range: Line 2
Side: Added lines
Snippet:
\`\`\`
newCall()
\`\`\`

Workspace file attachment:
File: src/App.tsx

Pull request attachment:
Repository: tanvesh/rudu
Pull request: #57
Title: Add issues sidebar view
State: OPEN
Author: tanvesh
Head SHA: abc123
URL: https://github.com/tanvesh/rudu/pull/57

User request:
Compare these`);
  });

  it("dedupes attachments by target", () => {
    const first = createWorkspaceFileAttachment("src/App.tsx");
    const second = createWorkspaceFileAttachment("src/App.tsx");

    expect(addReviewChatAttachment([first], second)).toEqual([first]);
  });
});
