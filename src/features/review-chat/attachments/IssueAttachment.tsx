import githubLogoUrl from "@/assets/provider-logos/github-invertocat-white.svg";
import linearLogoUrl from "@/assets/provider-logos/linear-light-logo.svg";
import { AttachmentChip } from "./AttachmentChip";
import type { ReviewChatIssueAttachment } from "../selection/line-selection";

function getIssueLabel(attachment: ReviewChatIssueAttachment) {
  if (attachment.key) return attachment.key;
  if (attachment.repo && attachment.number) {
    return `${attachment.repo}#${attachment.number}`;
  }
  return attachment.title;
}

function getIssueChipText(attachment: ReviewChatIssueAttachment) {
  return getIssueLabel(attachment);
}

function IssueProviderIcon({
  provider,
}: {
  provider: ReviewChatIssueAttachment["provider"];
}) {
  if (provider === "linear") {
    return (
      <span className="inline-flex size-3.5 items-center justify-center rounded-[3px] bg-gradient-to-b from-[#828fff] to-[#5f6cf2]">
        <img
          alt=""
          aria-hidden="true"
          className="size-2.5"
          src={linearLogoUrl}
        />
      </span>
    );
  }

  return (
    <img
      alt=""
      aria-hidden="true"
      className="size-3.5 invert dark:invert-0"
      src={githubLogoUrl}
    />
  );
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
      icon={<IssueProviderIcon provider={attachment.provider} />}
      title={attachment.title}
    >
      {getIssueChipText(attachment)}
    </AttachmentChip>
  );
}

export { IssueAttachment, IssueProviderIcon };
