import { CodeBracketIcon } from "@heroicons/react/20/solid";
import { AttachmentChip } from "./AttachmentChip";
import type { ReviewChatDiffLinesAttachment } from "../line-selection";

function DiffLinesAttachment({
  attachment,
}: {
  attachment: ReviewChatDiffLinesAttachment;
}) {
  return (
    <AttachmentChip
      icon={<CodeBracketIcon aria-hidden="true" className="size-3.5" />}
      title={attachment.path}
    >
      {attachment.label}
    </AttachmentChip>
  );
}

export { DiffLinesAttachment };
