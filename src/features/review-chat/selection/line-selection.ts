import type {
  FileDiffMetadata,
  SelectedLineRange,
  SelectionSide,
} from "@pierre/diffs";
import { createDiffLinesAttachment } from "../attachments/model";
import { buildPromptWithAttachments } from "../attachments/prompt-context";

const MAX_SELECTION_SNIPPET_LINES = 40;
const MAX_SELECTION_SNIPPET_CHARS = 4000;

type ReviewLineSelection = {
  path: string;
  startLine: number;
  endLine: number;
  startSide: SelectionSide;
  endSide: SelectionSide;
  lineCount: number;
  label: string;
  sideLabel: string;
  snippet: string | null;
  isSnippetTruncated: boolean;
};

function normalizeRange(range: SelectedLineRange) {
  const startSide = range.side ?? range.endSide;
  const endSide = range.endSide ?? range.side;

  if (!startSide || !endSide) {
    return null;
  }

  const startsFirst = range.start <= range.end;
  return startsFirst
    ? {
        startLine: range.start,
        endLine: range.end,
        startSide,
        endSide,
      }
    : {
        startLine: range.end,
        endLine: range.start,
        startSide: endSide,
        endSide: startSide,
      };
}

function getLineLabel(startLine: number, endLine: number) {
  if (startLine === endLine) {
    return `Line ${startLine}`;
  }

  return `Lines ${startLine}-${endLine}`;
}

function getSideLabel(startSide: SelectionSide, endSide: SelectionSide) {
  if (startSide === endSide) {
    return startSide === "additions" ? "Added lines" : "Removed lines";
  }

  return "Mixed diff selection";
}

function getLineSource(fileDiff: FileDiffMetadata, side: SelectionSide) {
  return side === "deletions" ? fileDiff.deletionLines : fileDiff.additionLines;
}

function extractSnippet(
  fileDiff: FileDiffMetadata,
  startLine: number,
  endLine: number,
  side: SelectionSide,
) {
  const source = getLineSource(fileDiff, side);
  const selectedLineCount = endLine - startLine + 1;
  const collectedLines: string[] = [];
  const didTruncateByLineCount = selectedLineCount > MAX_SELECTION_SNIPPET_LINES;
  const lastIncludedLine = Math.min(
    endLine,
    startLine + MAX_SELECTION_SNIPPET_LINES - 1,
  );

  for (let lineNumber = startLine; lineNumber <= lastIncludedLine; lineNumber += 1) {
    const line = source[lineNumber - 1];
    if (line === undefined) {
      return { snippet: null, isSnippetTruncated: false };
    }

    collectedLines.push(line);
  }

  let snippet = collectedLines.join("\n");
  let didTruncateByCharCount = false;

  if (snippet.length > MAX_SELECTION_SNIPPET_CHARS) {
    snippet = `${snippet.slice(0, MAX_SELECTION_SNIPPET_CHARS).trimEnd()}\n...`;
    didTruncateByCharCount = true;
  }

  return {
    snippet,
    isSnippetTruncated: didTruncateByLineCount || didTruncateByCharCount,
  };
}

function buildReviewLineSelection(
  fileDiff: FileDiffMetadata,
  range: SelectedLineRange,
): ReviewLineSelection | null {
  const normalized = normalizeRange(range);
  if (!normalized) {
    return null;
  }

  const { endLine, endSide, startLine, startSide } = normalized;
  const sameSide = startSide === endSide;
  const extracted = sameSide
    ? extractSnippet(fileDiff, startLine, endLine, startSide)
    : { snippet: null, isSnippetTruncated: false };

  return {
    path: fileDiff.name,
    startLine,
    endLine,
    startSide,
    endSide,
    lineCount: endLine - startLine + 1,
    label: getLineLabel(startLine, endLine),
    sideLabel: getSideLabel(startSide, endSide),
    snippet: extracted.snippet,
    isSnippetTruncated: extracted.isSnippetTruncated,
  };
}

function buildPromptWithSelectionContext(
  prompt: string,
  selection: ReviewLineSelection | null,
) {
  return buildPromptWithAttachments(
    prompt,
    selection ? [createDiffLinesAttachment(selection)] : [],
  );
}

export { buildPromptWithSelectionContext, buildReviewLineSelection };
export {
  addReviewChatAttachment,
  createDiffLinesAttachment,
  createIssueAttachment,
  createPullRequestAttachment,
  createWorkspaceFileAttachment,
  getDiffLinesAttachmentDisplayText,
  getDiffLinesAttachmentToken,
  getReviewChatAttachmentKey,
  getReviewChatAttachmentSubtitle,
  getReviewChatAttachmentTitle,
  getSelectionAttachmentSubtitle,
  hasReviewChatAttachment,
  isInlineReviewChatAttachment,
} from "../attachments/model";
export { buildPromptWithAttachments } from "../attachments/prompt-context";
export {
  getMessageAttachmentStripItems,
  normalizeAttachmentsFromMetadata,
  normalizeInlineAttachmentsFromMetadata,
  splitTextByInlineAttachments,
  trimInlineAttachmentRanges,
} from "../attachments/message-metadata";
export type { ReviewLineSelection };
export type {
  ReviewChatAttachment,
  ReviewChatDiffLinesAttachment,
  ReviewChatInlineAttachment,
  ReviewChatIssueAttachment,
  ReviewChatPullRequestAttachment,
  ReviewChatWorkspaceFileAttachment,
} from "../attachments/model";
export type {
  ReviewChatCommandMetadata,
  ReviewChatInlineAttachmentRange,
  ReviewChatInlineMessageSegment,
  ReviewChatMessageMetadata,
} from "../attachments/message-metadata";
