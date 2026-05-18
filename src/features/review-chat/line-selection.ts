import type {
  FileDiffMetadata,
  SelectedLineRange,
  SelectionSide,
} from "@pierre/diffs";
import type { PullRequestSummary } from "../../types/github";
import type { IssueLinkedPullRequest, IssueSummary } from "../../types/issues";

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

type ReviewChatDiffLinesAttachment = ReviewLineSelection & {
  kind: "diff-lines";
  id: string;
};

type ReviewChatWorkspaceFileAttachment = {
  kind: "workspace-file";
  id: string;
  path: string;
};

type ReviewChatPullRequestAttachment = {
  kind: "pull-request";
  id: string;
  repo: string;
  number: number;
  title: string;
  state: string;
  authorLogin: string;
  headSha: string;
  url: string;
};

type ReviewChatIssueAttachment = {
  kind: "issue";
  id: string;
  provider: IssueSummary["provider"];
  issueId: string;
  number: number | null;
  key: string | null;
  title: string;
  state: string;
  repo: string | null;
  teamName: string | null;
  url: string;
  linkedPullRequests: IssueLinkedPullRequest[];
};

type ReviewChatAttachment =
  | ReviewChatDiffLinesAttachment
  | ReviewChatWorkspaceFileAttachment
  | ReviewChatPullRequestAttachment
  | ReviewChatIssueAttachment;

type ReviewChatMessageMetadata = {
  acpStopReason?: string | null;
  attachments?: ReviewChatAttachment[];
  selectedLineContext?: ReviewLineSelection | null;
  finishedAt?: number;
  startedAt?: number;
  turnId?: string;
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

function getSelectionAttachmentSubtitle(selection: ReviewLineSelection) {
  return `${selection.label} · ${selection.sideLabel}`;
}

function getPathFileName(path: string) {
  return path.split(/[\\/]/).filter(Boolean).at(-1) ?? path;
}

function getReviewChatAttachmentKey(attachment: ReviewChatAttachment) {
  if (attachment.kind === "diff-lines") {
    return [
      "diff-lines",
      attachment.path,
      attachment.startLine,
      attachment.endLine,
      attachment.startSide,
      attachment.endSide,
    ].join(":");
  }

  if (attachment.kind === "workspace-file") {
    return `workspace-file:${attachment.path}`;
  }

  if (attachment.kind === "pull-request") {
    return `pull-request:${attachment.repo}#${attachment.number}`;
  }

  return `issue:${attachment.provider}:${attachment.issueId}`;
}

function createDiffLinesAttachment(
  selection: ReviewLineSelection,
): ReviewChatDiffLinesAttachment {
  const attachment = {
    ...selection,
    kind: "diff-lines" as const,
    id: "",
  };

  return {
    ...attachment,
    id: getReviewChatAttachmentKey(attachment),
  };
}

function createWorkspaceFileAttachment(
  path: string,
): ReviewChatWorkspaceFileAttachment {
  const attachment = {
    kind: "workspace-file" as const,
    id: "",
    path,
  };

  return {
    ...attachment,
    id: getReviewChatAttachmentKey(attachment),
  };
}

function createPullRequestAttachment(
  repo: string,
  pullRequest: PullRequestSummary,
): ReviewChatPullRequestAttachment {
  const attachment = {
    kind: "pull-request" as const,
    id: "",
    repo,
    number: pullRequest.number,
    title: pullRequest.title,
    state: pullRequest.state,
    authorLogin: pullRequest.authorLogin,
    headSha: pullRequest.headSha,
    url: pullRequest.url,
  };

  return {
    ...attachment,
    id: getReviewChatAttachmentKey(attachment),
  };
}

function createIssueAttachment(issue: IssueSummary): ReviewChatIssueAttachment {
  const attachment = {
    kind: "issue" as const,
    id: "",
    provider: issue.provider,
    issueId: issue.id,
    number: issue.number,
    key: issue.key,
    title: issue.title,
    state: issue.state,
    repo: issue.repo,
    teamName: issue.teamName,
    url: issue.url,
    linkedPullRequests: issue.linkedPullRequests,
  };

  return {
    ...attachment,
    id: getReviewChatAttachmentKey(attachment),
  };
}

function addReviewChatAttachment(
  attachments: ReviewChatAttachment[],
  attachment: ReviewChatAttachment,
) {
  const key = getReviewChatAttachmentKey(attachment);
  if (attachments.some((item) => getReviewChatAttachmentKey(item) === key)) {
    return attachments;
  }

  return [...attachments, attachment];
}

function hasReviewChatAttachment(
  attachments: ReviewChatAttachment[],
  attachment: ReviewChatAttachment,
) {
  const key = getReviewChatAttachmentKey(attachment);
  return attachments.some((item) => getReviewChatAttachmentKey(item) === key);
}

function getReviewChatAttachmentTitle(attachment: ReviewChatAttachment) {
  if (attachment.kind === "pull-request") {
    return `${attachment.repo}#${attachment.number}`;
  }

  if (attachment.kind === "issue") {
    return (
      attachment.key ??
      `${attachment.repo ?? attachment.provider}#${attachment.number ?? attachment.issueId}`
    );
  }

  return getPathFileName(attachment.path);
}

function getReviewChatAttachmentSubtitle(attachment: ReviewChatAttachment) {
  if (attachment.kind === "diff-lines") {
    return getSelectionAttachmentSubtitle(attachment);
  }

  if (attachment.kind === "workspace-file") {
    return "Workspace file";
  }

  if (attachment.kind === "pull-request") {
    return `${attachment.state} · ${attachment.authorLogin}`;
  }

  return `${attachment.provider} · ${attachment.state}`;
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

function appendDiffLinesAttachmentContext(
  contextLines: string[],
  attachment: ReviewChatDiffLinesAttachment,
) {
  contextLines.push("Selected diff context:");
  contextLines.push(`File: ${attachment.path}`);
  contextLines.push(`Range: ${attachment.label}`);
  contextLines.push(`Side: ${attachment.sideLabel}`);

  if (attachment.snippet) {
    contextLines.push("Snippet:");
    contextLines.push("```");
    contextLines.push(attachment.snippet);
    contextLines.push("```");
    if (attachment.isSnippetTruncated) {
      contextLines.push(
        `Note: snippet truncated to the first ${MAX_SELECTION_SNIPPET_LINES} lines of the selection.`,
      );
    }
  }
}

function appendWorkspaceFileAttachmentContext(
  contextLines: string[],
  attachment: ReviewChatWorkspaceFileAttachment,
) {
  contextLines.push("Workspace file attachment:");
  contextLines.push(`File: ${attachment.path}`);
}

function appendPullRequestAttachmentContext(
  contextLines: string[],
  attachment: ReviewChatPullRequestAttachment,
) {
  contextLines.push("Pull request attachment:");
  contextLines.push(`Repository: ${attachment.repo}`);
  contextLines.push(`Pull request: #${attachment.number}`);
  contextLines.push(`Title: ${attachment.title}`);
  contextLines.push(`State: ${attachment.state}`);
  contextLines.push(`Author: ${attachment.authorLogin}`);
  contextLines.push(`Head SHA: ${attachment.headSha}`);
  contextLines.push(`URL: ${attachment.url}`);
}

function appendIssueAttachmentContext(
  contextLines: string[],
  attachment: ReviewChatIssueAttachment,
) {
  contextLines.push("Issue attachment:");
  contextLines.push(`Provider: ${attachment.provider}`);
  if (attachment.key) {
    contextLines.push(`Key: ${attachment.key}`);
  }
  if (attachment.repo && attachment.number) {
    contextLines.push(`Repository: ${attachment.repo}`);
    contextLines.push(`Issue: #${attachment.number}`);
  }
  if (attachment.teamName) {
    contextLines.push(`Team: ${attachment.teamName}`);
  }
  contextLines.push(`Title: ${attachment.title}`);
  contextLines.push(`State: ${attachment.state}`);
  contextLines.push(`URL: ${attachment.url}`);

  if (attachment.linkedPullRequests.length > 0) {
    contextLines.push("Linked pull requests:");
    for (const pullRequest of attachment.linkedPullRequests) {
      contextLines.push(
        `- ${pullRequest.repo}#${pullRequest.number}: ${pullRequest.title}`,
      );
    }
  }
}

function normalizeAttachmentsFromMetadata(
  metadata: ReviewChatMessageMetadata | undefined,
) {
  if (!metadata) {
    return [];
  }

  if (metadata.attachments) {
    return metadata.attachments;
  }

  if (metadata.selectedLineContext) {
    return [createDiffLinesAttachment(metadata.selectedLineContext)];
  }

  return [];
}

function buildPromptWithAttachments(
  prompt: string,
  attachments: ReviewChatAttachment[],
) {
  const trimmedPrompt = prompt.trim();
  if (attachments.length === 0) {
    return trimmedPrompt;
  }

  const contextLines: string[] = [];

  for (const attachment of attachments) {
    if (contextLines.length > 0) {
      contextLines.push("");
    }

    if (attachment.kind === "diff-lines") {
      appendDiffLinesAttachmentContext(contextLines, attachment);
    } else if (attachment.kind === "workspace-file") {
      appendWorkspaceFileAttachmentContext(contextLines, attachment);
    } else if (attachment.kind === "pull-request") {
      appendPullRequestAttachmentContext(contextLines, attachment);
    } else {
      appendIssueAttachmentContext(contextLines, attachment);
    }
  }

  return `${contextLines.join("\n")}\n\nUser request:\n${trimmedPrompt}`;
}

export {
  addReviewChatAttachment,
  buildPromptWithSelectionContext,
  buildPromptWithAttachments,
  createDiffLinesAttachment,
  createIssueAttachment,
  createPullRequestAttachment,
  createWorkspaceFileAttachment,
  buildReviewLineSelection,
  getReviewChatAttachmentKey,
  getReviewChatAttachmentSubtitle,
  getReviewChatAttachmentTitle,
  getSelectionAttachmentSubtitle,
  hasReviewChatAttachment,
  normalizeAttachmentsFromMetadata,
};
export type {
  ReviewChatMessageMetadata,
  ReviewLineSelection,
  ReviewChatAttachment,
  ReviewChatDiffLinesAttachment,
  ReviewChatIssueAttachment,
  ReviewChatPullRequestAttachment,
  ReviewChatWorkspaceFileAttachment,
};
