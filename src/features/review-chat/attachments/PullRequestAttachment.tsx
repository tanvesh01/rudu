import { ArrowTopRightOnSquareIcon } from "@heroicons/react/20/solid";
import { AttachmentChip } from "./AttachmentChip";
import type { ReviewChatPullRequestAttachment } from "../line-selection";

function PullRequestAttachment({
  attachment,
}: {
  attachment: ReviewChatPullRequestAttachment;
}) {
  return (
    <AttachmentChip
      className="border-emerald-200 bg-emerald-50 text-emerald-900"
      icon={
        <ArrowTopRightOnSquareIcon aria-hidden="true" className="size-3.5" />
      }
      title={attachment.title}
    >
      {attachment.repo}#{attachment.number}
    </AttachmentChip>
  );
}

export { PullRequestAttachment };
