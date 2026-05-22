import type {
  ReviewChatAttachment,
  ReviewChatDiffLinesAttachment,
  ReviewChatIssueAttachment,
  ReviewChatPullRequestAttachment,
  ReviewChatWorkspaceFileAttachment,
} from "./model";

const MAX_SELECTION_SNIPPET_LINES = 40;

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
  contextLines.push(
    "Detail lookup: use read-only gh pr view if the pull request body is needed.",
  );
}

function appendIssueAttachmentContext(
  contextLines: string[],
  attachment: ReviewChatIssueAttachment,
) {
  contextLines.push("Issue attachment:");
  contextLines.push(`Provider: ${attachment.provider}`);
  if (attachment.provider === "linear") {
    contextLines.push(`Linear issue ID: ${attachment.issueId}`);
    contextLines.push(
      "Detail lookup: when the user asks to fetch, inspect, summarize, or use the Linear issue details, call get_linear_issue_details with this Linear issue ID before answering. Do not answer from the issue title alone.",
    );
  }
  if (attachment.key) {
    contextLines.push(`Key: ${attachment.key}`);
  }
  if (attachment.repo && attachment.number) {
    contextLines.push(`Repository: ${attachment.repo}`);
    contextLines.push(`Issue: #${attachment.number}`);
    if (attachment.provider === "github") {
      contextLines.push(
        "Detail lookup: use read-only gh issue view if the issue body is needed.",
      );
    }
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

export { buildPromptWithAttachments };
