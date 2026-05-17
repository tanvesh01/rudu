import type { ReactNode } from "react";
import LucideGitMerge from "@/assets/icons/LucideGitMerge";
import type { IssueLinkedPullRequest } from "@/types/issues";

function MetadataPill({
  children,
  title,
}: {
  children: ReactNode;
  title?: string;
}) {
  return (
    <span
      className="inline-flex h-6 max-w-[14rem] shrink-0 items-center gap-1.5 truncate rounded-full border border-ink-100 bg-surface px-2.5 text-xs text-ink-600 dark:bg-[#343438]"
      title={title}
    >
      <span className="inline-flex min-w-0 items-center gap-1.5 truncate">
        {children}
      </span>
    </span>
  );
}

function LinkedPullRequestPills({
  linkedPullRequests,
  onOpenLinkedPullRequest,
}: {
  linkedPullRequests: IssueLinkedPullRequest[];
  onOpenLinkedPullRequest: (pullRequest: IssueLinkedPullRequest) => void;
}) {
  if (linkedPullRequests.length === 0) return null;

  return (
    <>
      {linkedPullRequests.map((pullRequest) => (
        <button
          aria-label={`Open PR #${pullRequest.number} in Rudu`}
          className="inline-flex h-6 max-w-[14rem] shrink-0 items-center gap-1.5 truncate rounded-full bg-[#08872B] px-2.5 font-mono text-xs text-white transition hover:bg-[#077625] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600"
          key={`${pullRequest.repo}#${pullRequest.number}`}
          onClick={() => onOpenLinkedPullRequest(pullRequest)}
          title={pullRequest.title}
          type="button"
        >
          <span aria-hidden="true" className="text-sm leading-none text-white">
            <LucideGitMerge className="text-white" />
          </span>
          #{pullRequest.number}
        </button>
      ))}
    </>
  );
}

export { LinkedPullRequestPills, MetadataPill };
