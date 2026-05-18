import { describe, expect, it } from "bun:test";
import type { FileDiffMetadata, SelectedLineRange } from "@pierre/diffs";
import {
  addReviewChatAttachment,
  buildPromptWithAttachments,
  buildPromptWithSelectionContext,
  buildReviewLineSelection,
  createDiffLinesAttachment,
  createIssueAttachment,
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

describe("Rudu line selection helpers", () => {
  it("normalizes reversed ranges and extracts added-line snippets", () => {
    const range: SelectedLineRange = {
      start: 3,
      side: "additions",
      end: 2,
      endSide: "additions",
    };

    expect(buildReviewLineSelection(FILE_DIFF, range)).toEqual({
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

    expect(buildReviewLineSelection(FILE_DIFF, range)).toEqual({
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
    const selection = buildReviewLineSelection(FILE_DIFF, {
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
    const selection = buildReviewLineSelection(FILE_DIFF, {
      start: 2,
      side: "additions",
      end: 2,
      endSide: "additions",
    });

    expect(
      buildPromptWithAttachments("Compare these", [
        createDiffLinesAttachment(selection!),
        createWorkspaceFileAttachment("src/App.tsx"),
        createIssueAttachment({
          id: "FOL-605",
          provider: "linear",
          number: null,
          key: "FOL-605",
          title: "Add trip date to active campaign",
          state: "In Progress",
          repo: null,
          teamName: "FOL",
          authorLogin: "tanvesh",
          authorAvatarUrl: null,
          assigneeName: "Tanvesh",
          commentCount: 0,
          createdAt: "2026-05-15T00:00:00Z",
          updatedAt: "2026-05-16T00:00:00Z",
          url: "https://linear.app/followalice/issue/FOL-605",
          linkedPullRequests: [
            {
              number: 57,
              repo: "tanvesh/rudu",
              title: "Add issues sidebar view",
              url: "https://github.com/tanvesh/rudu/pull/57",
            },
          ],
        }),
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

Issue attachment:
Provider: linear
Key: FOL-605
Team: FOL
Title: Add trip date to active campaign
State: In Progress
URL: https://linear.app/followalice/issue/FOL-605
Linked pull requests:
- tanvesh/rudu#57: Add issues sidebar view

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
