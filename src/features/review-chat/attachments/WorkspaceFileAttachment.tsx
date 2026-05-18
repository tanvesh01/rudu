import { DocumentTextIcon } from "@heroicons/react/20/solid";
import { AttachmentChip } from "./AttachmentChip";
import type { ReviewChatWorkspaceFileAttachment } from "../line-selection";

function getPathFileName(path: string) {
  return path.split(/[\\/]/).filter(Boolean).at(-1) ?? path;
}

function WorkspaceFileAttachment({
  attachment,
}: {
  attachment: ReviewChatWorkspaceFileAttachment;
}) {
  return (
    <AttachmentChip
      icon={<DocumentTextIcon aria-hidden="true" className="size-3.5" />}
      title={attachment.path}
    >
      {getPathFileName(attachment.path)}
    </AttachmentChip>
  );
}

export { WorkspaceFileAttachment };
