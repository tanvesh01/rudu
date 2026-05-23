import { AttachmentChip } from "./AttachmentChip";
import { FileTreeAttachmentIcon } from "./FileTreeAttachmentIcon";
import type { ReviewChatWorkspaceFileAttachment } from "../selection/line-selection";

function getPathFileName(path: string) {
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? path;
}

function WorkspaceFileAttachment({
  attachment,
}: {
  attachment: ReviewChatWorkspaceFileAttachment;
}) {
  return (
    <AttachmentChip
      icon={<FileTreeAttachmentIcon path={attachment.path} />}
      title={attachment.path}
    >
      {getPathFileName(attachment.path)}
    </AttachmentChip>
  );
}

export { WorkspaceFileAttachment };
