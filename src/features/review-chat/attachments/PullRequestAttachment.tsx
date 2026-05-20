import { AttachmentChip } from "./AttachmentChip";
import type { ReviewChatPullRequestAttachment } from "../line-selection";
import {
  getPullRequestStatus,
  PullRequestStatusIcon,
} from "../../../components/ui/pull-request-status";

function PullRequestAttachment({
  attachment,
}: {
  attachment: ReviewChatPullRequestAttachment;
}) {
  const status = getPullRequestStatus({
    isDraft: attachment.isDraft,
    mergeStateStatus: attachment.mergeStateStatus,
    mergeable: attachment.mergeable,
    state: attachment.state,
  });

  return (
    <AttachmentChip
      className={status.className}
      icon={<PullRequestStatusIcon status={status.status} />}
      title={attachment.title}
    >
      {attachment.repo}#{attachment.number}
    </AttachmentChip>
  );
}

export { PullRequestAttachment };
