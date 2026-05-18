import { ChatBubbleLeftRightIcon } from "@heroicons/react/20/solid";
import { AttachmentChip } from "./AttachmentChip";
import type { ReviewChatIssueAttachment } from "../line-selection";

function getIssueLabel(attachment: ReviewChatIssueAttachment) {
  if (attachment.key) return attachment.key;
  if (attachment.repo && attachment.number) {
    return `${attachment.repo}#${attachment.number}`;
  }
  return attachment.title;
}

function getIssueChipText(attachment: ReviewChatIssueAttachment) {
  const label = getIssueLabel(attachment);
  return label === attachment.title ? label : `${label} ${attachment.title}`;
}

function IssueAttachment({
  attachment,
}: {
  attachment: ReviewChatIssueAttachment;
}) {
  return (
    <AttachmentChip
      className={
        attachment.provider === "linear"
          ? "border-[#828fff]/50 bg-[#828fff]/10 text-ink-900"
          : "border-ink-200 bg-ink-50 text-ink-900"
      }
      icon={
        <ChatBubbleLeftRightIcon aria-hidden="true" className="size-3.5" />
      }
      title={attachment.title}
    >
      {getIssueChipText(attachment)}
    </AttachmentChip>
  );
}

export { IssueAttachment };
