import type { PullRequestSummary } from "../../../types/github";
import type { IssueLinkedPullRequest, IssueSummary } from "../../../types/issues";
import type { ReviewLineSelection } from "../selection/line-selection";

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
  isDraft: boolean;
  mergeStateStatus: string;
  mergeable: string;
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

type ReviewChatInlineAttachment =
  | ReviewChatDiffLinesAttachment
  | ReviewChatWorkspaceFileAttachment
  | ReviewChatPullRequestAttachment
  | ReviewChatIssueAttachment;

function getPathFileName(path: string) {
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? path;
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
    isDraft: pullRequest.isDraft,
    mergeStateStatus: pullRequest.mergeStateStatus,
    mergeable: pullRequest.mergeable,
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

function isInlineReviewChatAttachment(
  _attachment: ReviewChatAttachment,
): _attachment is ReviewChatInlineAttachment {
  return true;
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
    return `${attachment.label} · ${attachment.sideLabel}`;
  }

  if (attachment.kind === "workspace-file") {
    return "Workspace file";
  }

  if (attachment.kind === "pull-request") {
    return `${attachment.state} · ${attachment.authorLogin}`;
  }

  return `${attachment.provider} · ${attachment.state}`;
}

function getSelectionAttachmentSubtitle(selection: ReviewLineSelection) {
  return `${selection.label} · ${selection.sideLabel}`;
}

function getDiffLinesAttachmentDisplayText(
  attachment: ReviewChatDiffLinesAttachment,
) {
  return `${getPathFileName(attachment.path)} ${attachment.label}`;
}

function getDiffLinesAttachmentToken(
  attachment: ReviewChatDiffLinesAttachment,
) {
  return `[${getDiffLinesAttachmentDisplayText(attachment)}]`;
}

export {
  addReviewChatAttachment,
  createDiffLinesAttachment,
  createIssueAttachment,
  createPullRequestAttachment,
  createWorkspaceFileAttachment,
  getReviewChatAttachmentKey,
  getReviewChatAttachmentSubtitle,
  getReviewChatAttachmentTitle,
  getDiffLinesAttachmentDisplayText,
  getDiffLinesAttachmentToken,
  getSelectionAttachmentSubtitle,
  hasReviewChatAttachment,
  isInlineReviewChatAttachment,
};
export type {
  ReviewChatAttachment,
  ReviewChatDiffLinesAttachment,
  ReviewChatInlineAttachment,
  ReviewChatIssueAttachment,
  ReviewChatPullRequestAttachment,
  ReviewChatWorkspaceFileAttachment,
};
