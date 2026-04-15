import * as React from "react";
import {
  AccordionItem,
  AccordionHeader,
  AccordionTrigger,
  AccordionPanel,
} from "./accordion";
import { TruncateText } from "./truncate";
import {
  PullRequestBadgeStatus,
  type PullRequestSummary,
} from "../../types/github";
import { getOwnerAvatarUrl, getOwnerLogin } from "../../lib/github-owner";
import LucideGitBranch from "../../assets/icons/LucideGitBranch";
import LucideGitPullRequestClosed from "../../assets/icons/LucideGitPullRequestClosed";
import LucideGitMerge from "../../assets/icons/LucideGitMerge";
import LucideGitPullRequestArrow from "../../assets/icons/LucideGitPullRequestArrow";

type RepoSidebarItemProps = {
  value: string;
  nameWithOwner: string;
  pullRequests: PullRequestSummary[] | undefined;
  isLoading: boolean;
  error: string | undefined;
  onSelectPr: (repo: string, pr: PullRequestSummary) => void;
  onOpenChange: (open: boolean) => void;
};

type PullRequestStatusViewModel = {
  status: PullRequestBadgeStatus;
  label: string;
  className: string;
};

function getPullRequestStatus(
  pullRequest: PullRequestSummary,
): PullRequestStatusViewModel {
  if (pullRequest.isDraft) {
    return {
      status: PullRequestBadgeStatus.Draft,
      label: "Draft",
      className: "border-ink-300 bg-surface text-ink-600",
    };
  }

  if (
    pullRequest.mergeable === "CONFLICTING" ||
    pullRequest.mergeStateStatus === "DIRTY"
  ) {
    return {
      status: PullRequestBadgeStatus.Conflicting,
      label: "Conflicting",
      className: "border-[#F1C9C9] bg-[#FBEAEA] text-danger-600",
    };
  }

  if (pullRequest.mergeable === "MERGEABLE") {
    return {
      status: PullRequestBadgeStatus.CanMerge,
      label: "Can Merge",
      className: "border-[#BFE1CC] bg-[#EAF6EF] text-[#1C6B3A]",
    };
  }

  return {
    status: PullRequestBadgeStatus.Open,
    label: "Open",
    className: "border-ink-300 bg-surface text-ink-600",
  };
}

function PullRequestStatusIcon({ status }: { status: PullRequestBadgeStatus }) {
  switch (status) {
    case PullRequestBadgeStatus.Draft:
      return <LucideGitBranch className="text-neutral-500" />;
    case PullRequestBadgeStatus.Conflicting:
      return <LucideGitPullRequestClosed className="text-yellow-500" />;
    case PullRequestBadgeStatus.CanMerge:
      return <LucideGitPullRequestArrow className="text-green-600" />;
    case PullRequestBadgeStatus.Open:
      return <LucideGitMerge className="text-green-500" />;
    default:
      return null;
  }
}

function ChevronIcon(props: React.ComponentProps<"svg">) {
  return (
    <svg viewBox="0 0 12 12" fill="currentcolor" {...props}>
      <path d="M4.22 2.47a.75.75 0 0 1 1.06 0L8.53 5.72a.75.75 0 0 1 0 1.06L5.28 10.03a.75.75 0 0 1-1.06-1.06L6.97 6.25 4.22 3.53a.75.75 0 0 1 0-1.06Z" />
    </svg>
  );
}

function RepoSidebarItem({
  value,
  nameWithOwner,
  pullRequests,
  isLoading,
  error,
  onSelectPr,
  onOpenChange,
}: RepoSidebarItemProps) {
  const ownerLogin = getOwnerLogin(nameWithOwner);

  return (
    <AccordionItem value={value} onOpenChange={onOpenChange}>
      <AccordionHeader>
        <AccordionTrigger className="group border-0 rounded-none font-normal">
          <ChevronIcon className="size-3.5 shrink-0 transition-[transform,opacity] duration-200 opacity-0 group-hover:opacity-100 [[data-panel-open]>&]:rotate-90 [[data-panel-open]>&]:opacity-100" />
          <img
            alt={`${ownerLogin} avatar`}
            className="size-5 shrink-0 rounded-full border border-ink-300 object-cover"
            loading="lazy"
            src={getOwnerAvatarUrl(nameWithOwner)}
          />
          <span>{nameWithOwner}</span>
        </AccordionTrigger>
      </AccordionHeader>
      <AccordionPanel>
        <div className="overflow-hidden">
          <div className="flex flex-col pl-2 pt-2">
            {isLoading ? (
              <div className="text-sm text-ink-500">Loading PRs...</div>
            ) : null}
            {error ? (
              <div className="text-sm text-danger-600">{error}</div>
            ) : null}
            {!isLoading && !error && pullRequests?.length === 0 ? (
              <div className="text-sm text-ink-500">No open PRs.</div>
            ) : null}
            {!isLoading && !error && pullRequests
              ? pullRequests.map((pullRequest) => {
                  const prKey = `${nameWithOwner}#${pullRequest.number}`;
                  const status = getPullRequestStatus(pullRequest);

                  return (
                    <button
                      className={[
                        "flex w-full flex-col gap-1 rounded-lg bg-canvas px-3 py-2.5 text-left transition hover:bg-canvasDark focus-visible:bg-surface [--repo-row-bg:#F2F1ED] hover:[--repo-row-bg:#F7F7F3] focus-visible:[--repo-row-bg:#F7F7F3] [--truncate-marker-background-color:var(--repo-row-bg)]",
                      ].join(" ")}
                      key={prKey}
                      onClick={() => onSelectPr(nameWithOwner, pullRequest)}
                      type="button"
                    >
                      <p className="text-xs ">{pullRequest.authorLogin}</p>

                      <div className="flex items-center gap-3">
                        <div className="flex min-w-0 flex-1 items-center gap-2">
                          <div className="shrink-0">
                            <PullRequestStatusIcon status={status.status} />
                          </div>
                          <TruncateText className="min-w-0 flex-1 text-sm text-neutral-700">
                            {pullRequest.title}
                          </TruncateText>
                        </div>
                        <p className="shrink-0 whitespace-nowrap text-xs font-mono font-semibold">
                          <span className="text-green-600">
                            +{pullRequest.additions}
                          </span>{" "}
                          <span className="text-red-600">
                            -{pullRequest.deletions}
                          </span>
                        </p>
                      </div>
                    </button>
                  );
                })
              : null}
          </div>
        </div>
      </AccordionPanel>
    </AccordionItem>
  );
}

export { RepoSidebarItem };
export type { RepoSidebarItemProps, PullRequestSummary };
