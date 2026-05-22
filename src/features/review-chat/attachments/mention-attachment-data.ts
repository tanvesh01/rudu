import type {
  BeautifulMentionsItem,
  BeautifulMentionsItemData,
} from "lexical-beautiful-mentions";
import type { PullRequestSummary } from "../../../types/github";
import type { IssueSummary } from "../../../types/issues";
import {
  createWorkspaceFileAttachment,
  type ReviewChatAttachment,
  type ReviewChatIssueAttachment,
  type ReviewChatPullRequestAttachment,
  type ReviewChatWorkspaceFileAttachment,
} from "../selection/line-selection";

type MentionAttachmentKind =
  | "workspace-file"
  | "pull-request"
  | "issue";

type MentionAttachmentData = Record<string, BeautifulMentionsItemData> & {
  kind: MentionAttachmentKind;
};

function createWorkspaceFileMentionItem(
  path: string,
): BeautifulMentionsItem {
  return {
    value: path,
    kind: "workspace-file",
    path,
  };
}

function createPullRequestMentionItem(
  repo: string,
  pullRequest: PullRequestSummary,
): BeautifulMentionsItem {
  return {
    value: `${pullRequest.number}`,
    kind: "pull-request",
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
}

function getIssueMentionValue(issue: IssueSummary) {
  if (issue.key) return issue.key;
  if (issue.repo && issue.number) return `${issue.repo}#${issue.number}`;
  return issue.title;
}

function createIssueMentionItem(issue: IssueSummary): BeautifulMentionsItem {
  return {
    value: getIssueMentionValue(issue),
    kind: "issue",
    provider: issue.provider,
    issueId: issue.id,
    number: issue.number,
    key: issue.key,
    title: issue.title,
    state: issue.state,
    repo: issue.repo,
    teamName: issue.teamName,
    url: issue.url,
    linkedPullRequestsJson: JSON.stringify(issue.linkedPullRequests),
  };
}

function stringValue(value: BeautifulMentionsItemData | undefined) {
  return typeof value === "string" ? value : null;
}

function numberValue(value: BeautifulMentionsItemData | undefined) {
  return typeof value === "number" ? value : null;
}

function parseLinkedPullRequests(value: string | null) {
  if (!value) return [];

  try {
    const parsed = JSON.parse(value) as ReviewChatIssueAttachment["linkedPullRequests"];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function createWorkspaceFileAttachmentFromData(
  data: Record<string, BeautifulMentionsItemData>,
): ReviewChatWorkspaceFileAttachment | null {
  const path = stringValue(data.path);
  return path ? createWorkspaceFileAttachment(path) : null;
}

function createPullRequestAttachmentFromData(
  data: Record<string, BeautifulMentionsItemData>,
): ReviewChatPullRequestAttachment | null {
  const repo = stringValue(data.repo);
  const number = numberValue(data.number);
  const title = stringValue(data.title);
  const state = stringValue(data.state);
  const isDraft = data.isDraft === true;
  const mergeStateStatus = stringValue(data.mergeStateStatus) ?? "";
  const mergeable = stringValue(data.mergeable) ?? "";
  const authorLogin = stringValue(data.authorLogin);
  const headSha = stringValue(data.headSha);
  const url = stringValue(data.url);

  if (!repo || !number || !title || !state || !authorLogin || !headSha || !url) {
    return null;
  }

  const attachment = {
    kind: "pull-request" as const,
    id: "",
    repo,
    number,
    title,
    state,
    isDraft,
    mergeStateStatus,
    mergeable,
    authorLogin,
    headSha,
    url,
  };

  return {
    ...attachment,
    id: `pull-request:${repo}#${number}`,
  };
}

function createIssueAttachmentFromData(
  data: Record<string, BeautifulMentionsItemData>,
): ReviewChatIssueAttachment | null {
  const providerValue = stringValue(data.provider);
  const issueId = stringValue(data.issueId);
  const title = stringValue(data.title);
  const state = stringValue(data.state);
  const url = stringValue(data.url);

  if (
    (providerValue !== "github" && providerValue !== "linear") ||
    !issueId ||
    !title ||
    !state ||
    !url
  ) {
    return null;
  }
  const provider: ReviewChatIssueAttachment["provider"] = providerValue;

  const attachment = {
    kind: "issue" as const,
    id: "",
    provider,
    issueId,
    number: numberValue(data.number),
    key: stringValue(data.key),
    title,
    state,
    repo: stringValue(data.repo),
    teamName: stringValue(data.teamName),
    url,
    linkedPullRequests: parseLinkedPullRequests(
      stringValue(data.linkedPullRequestsJson),
    ),
  };

  return {
    ...attachment,
    id: `issue:${provider}:${issueId}`,
  };
}

function createAttachmentFromMentionData(
  data: Record<string, BeautifulMentionsItemData> | undefined,
): ReviewChatAttachment | null {
  if (!data) return null;

  if (data.kind === "workspace-file") {
    return createWorkspaceFileAttachmentFromData(data);
  }

  if (data.kind === "pull-request") {
    return createPullRequestAttachmentFromData(data);
  }

  if (data.kind === "issue") {
    return createIssueAttachmentFromData(data);
  }

  return null;
}

export {
  createAttachmentFromMentionData,
  createIssueMentionItem,
  createPullRequestMentionItem,
  createWorkspaceFileMentionItem,
  getIssueMentionValue,
};
export type { MentionAttachmentData };
