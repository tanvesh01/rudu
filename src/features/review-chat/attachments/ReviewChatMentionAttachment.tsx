import { forwardRef } from "react";
import type { BeautifulMentionComponentProps } from "lexical-beautiful-mentions";
import { DiffLinesAttachment } from "./DiffLinesAttachment";
import { IssueAttachment } from "./IssueAttachment";
import { PullRequestAttachment } from "./PullRequestAttachment";
import { WorkspaceFileAttachment } from "./WorkspaceFileAttachment";
import {
  createAttachmentFromMentionData,
} from "./mention-attachment-data";

const ReviewChatMentionAttachment = forwardRef<
  HTMLSpanElement,
  BeautifulMentionComponentProps
>(function ReviewChatMentionAttachment({ data, value, ...props }, ref) {
  const attachment = createAttachmentFromMentionData(data);

  if (!attachment) {
    return (
      <span {...props} ref={ref}>
        @{value}
      </span>
    );
  }

  return (
    <span {...props} ref={ref}>
      {attachment.kind === "workspace-file" ? (
        <WorkspaceFileAttachment attachment={attachment} />
      ) : null}
      {attachment.kind === "diff-lines" ? (
        <DiffLinesAttachment attachment={attachment} />
      ) : null}
      {attachment.kind === "pull-request" ? (
        <PullRequestAttachment attachment={attachment} />
      ) : null}
      {attachment.kind === "issue" ? (
        <IssueAttachment attachment={attachment} />
      ) : null}
    </span>
  );
});

export { ReviewChatMentionAttachment };
