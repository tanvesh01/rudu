import * as React from "react";
import { PlusIcon } from "@heroicons/react/20/solid";
import { ArchiveBoxXMarkIcon } from "@heroicons/react/24/outline";
import {
  AccordionItem,
  AccordionHeader,
  AccordionTrigger,
  AccordionPanel,
} from "./accordion";
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
  error: string | undefined;
  selectedPrKey: string | null;
  onSelectPr: (repo: string, pr: PullRequestSummary) => void;
  onAddPr: (repo: string) => void;
  onRemovePr: (repo: string, pr: PullRequestSummary) => void;
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
  if (pullRequest.state === "MERGED") {
    return {
      status: PullRequestBadgeStatus.Merged,
      label: "Merged",
      className:
        "border-[#BFE1CC] bg-[#EAF6EF] text-[#1C6B3A] dark:border-green-900/30 dark:bg-green-950/40 dark:text-green-300",
    };
  }

  if (pullRequest.state !== "OPEN") {
    return {
      status: PullRequestBadgeStatus.Closed,
      label: "Closed",
      className: "border-ink-300 bg-surface text-ink-600",
    };
  }

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
      className:
        "border-[#F1C9C9] bg-[#FBEAEA] text-danger-600 dark:border-red-900/30 dark:bg-red-950/40 dark:text-red-300",
    };
  }

  if (pullRequest.mergeable === "MERGEABLE") {
    return {
      status: PullRequestBadgeStatus.CanMerge,
      label: "Can Merge",
      className:
        "border-[#BFE1CC] bg-[#EAF6EF] text-[#1C6B3A] dark:border-green-900/30 dark:bg-green-950/40 dark:text-green-300",
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
    case PullRequestBadgeStatus.Merged:
      return <LucideGitMerge className="text-green-600 dark:text-green-300" />;
    case PullRequestBadgeStatus.Closed:
      return <LucideGitPullRequestClosed className="text-ink-500" />;
    case PullRequestBadgeStatus.Draft:
      return <LucideGitBranch className="text-ink-500" />;
    case PullRequestBadgeStatus.Conflicting:
      return (
        <LucideGitPullRequestClosed className="text-yellow-500 dark:text-yellow-300" />
      );
    case PullRequestBadgeStatus.CanMerge:
      return (
        <LucideGitPullRequestArrow className="text-green-600 dark:text-green-300" />
      );
    case PullRequestBadgeStatus.Open:
      return <LucideGitMerge className="text-green-500 dark:text-green-300" />;
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
  error,
  selectedPrKey,
  onSelectPr,
  onAddPr,
  onRemovePr,
  onOpenChange,
}: RepoSidebarItemProps) {
  const ownerLogin = getOwnerLogin(nameWithOwner);
  const hasPullRequests = Boolean(pullRequests && pullRequests.length > 0);

  return (
    <AccordionItem value={value} onOpenChange={onOpenChange}>
      <AccordionHeader>
        <AccordionTrigger className="group border-0 font-normal">
          <div className="relative size-5 shrink-0">
            <img
              alt={`${ownerLogin} avatar`}
              className="absolute inset-0 size-5 rounded-full object-cover transition-opacity duration-200 group-hover:opacity-0"
              loading="lazy"
              src={getOwnerAvatarUrl(nameWithOwner)}
            />
            <ChevronIcon className="absolute left-1/2 top-1/2 size-3.5 -translate-x-1/2 -translate-y-1/2 opacity-0 transition-[transform,opacity] duration-200 group-hover:opacity-100 group-data-[panel-open]:rotate-90" />
          </div>
          <span className="min-w-0 flex-1 truncate">{nameWithOwner}</span>
          <button
            aria-label={`Add PR to ${nameWithOwner}`}
            className="inline-flex items-center justify-center rounded p-1 text-ink-500 opacity-0 transition-[opacity,color,background-color] duration-200 group-hover:opacity-100 hover:bg-canvasDark hover:text-ink-700"
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              onAddPr(nameWithOwner);
            }}
            type="button"
          >
            <PlusIcon className="size-4 shrink-0" />
          </button>
        </AccordionTrigger>
      </AccordionHeader>
      <AccordionPanel>
        <div className="overflow-hidden">
          <div className="flex flex-col">
            {error && !hasPullRequests ? (
              <div className="text-sm text-danger-600">{error}</div>
            ) : null}
            {!error && pullRequests?.length === 0 ? (
              <div className="px-3 py-2.5 text-sm text-ink-500">
                No tracked PRs yet.{" "}
                <button
                  className="font-medium text-ink-700 underline-offset-2 hover:underline"
                  onClick={() => onAddPr(nameWithOwner)}
                  type="button"
                >
                  Add a PR
                </button>
              </div>
            ) : null}
            {pullRequests
              ? pullRequests.map((pullRequest) => {
                  const prKey = `${nameWithOwner}#${pullRequest.number}`;
                  const status = getPullRequestStatus(pullRequest);
                  const isSelected =
                    selectedPrKey ===
                    `${nameWithOwner}#${pullRequest.number}@${pullRequest.headSha}`;

                  return (
                    <div className="group relative" key={prKey}>
                      <button
                        className={[
                          "group relative flex w-full flex-col gap-1 bg-canvas px-3 pl-6 py-2.5 text-left transition hover:bg-canvasDark focus-visible:bg-surface",
                          isSelected ? "bg-canvasDark" : "",
                        ].join(" ")}
                        onClick={() => onSelectPr(nameWithOwner, pullRequest)}
                        type="button"
                      >
                        <p className="text-xs ">{pullRequest.authorLogin}</p>

                        <div className="flex items-center gap-3">
                          <div className="flex min-w-0 flex-1 items-center gap-2">
                            <div className="shrink-0">
                              <PullRequestStatusIcon status={status.status} />
                            </div>
                            <p className="min-w-0 flex-1 truncate text-sm text-ink-700">
                              {pullRequest.title}
                            </p>
                          </div>
                          <p className="shrink-0 whitespace-nowrap text-xs font-mono font-semibold transition-opacity group-hover:opacity-0 group-focus-within:opacity-0">
                            <span className="text-green-600 dark:text-green-300">
                              +{pullRequest.additions}
                            </span>{" "}
                            <span className="text-red-600 dark:text-red-300">
                              -{pullRequest.deletions}
                            </span>
                          </p>
                        </div>
                      </button>
                      <button
                        aria-label={`Remove PR #${pullRequest.number}`}
                        className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-ink-500 opacity-0 transition hover:bg-surface hover:text-ink-700 group-hover:opacity-100"
                        onClick={() => onRemovePr(nameWithOwner, pullRequest)}
                        type="button"
                      >
                        <ArchiveBoxXMarkIcon className="size-4 shrink-0" />
                      </button>
                    </div>
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
