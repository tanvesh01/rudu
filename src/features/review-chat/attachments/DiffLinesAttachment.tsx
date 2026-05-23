import {
  getDiffLinesAttachmentDisplayText,
  type ReviewChatDiffLinesAttachment,
} from "../selection/line-selection";
import { AttachmentChip } from "./AttachmentChip";
import { FileTreeAttachmentIcon } from "./FileTreeAttachmentIcon";

function DiffLinesAttachment({
  attachment,
}: {
  attachment: ReviewChatDiffLinesAttachment;
}) {
  return (
    <AttachmentChip
      icon={<FileTreeAttachmentIcon path={attachment.path} />}
      title={attachment.path}
    >
      {getDiffLinesAttachmentDisplayText(attachment)}
    </AttachmentChip>
  );
}

export { DiffLinesAttachment };
