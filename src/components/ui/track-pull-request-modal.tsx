import { useEffect, useState } from "react";
import { ArrowLeftIcon } from "@heroicons/react/20/solid";
import { CommandMenu } from "./command-menu";
import { getOwnerAvatarUrl, getOwnerLogin } from "../../lib/github-owner";
import {
  PullRequestBadgeStatus,
  type PullRequestSummary,
  type RepoSummary,
} from "../../types/github";
import LucideGitBranch from "../../assets/icons/LucideGitBranch";
import LucideGitPullRequestClosed from "../../assets/icons/LucideGitPullRequestClosed";
import LucideGitMerge from "../../assets/icons/LucideGitMerge";
import LucideGitPullRequestArrow from "../../assets/icons/LucideGitPullRequestArrow";

type TrackPullRequestModalMode = "repo-then-pr" | "pr-only";
type TrackPullRequestModalStep = "repo" | "pull-request";

type TrackPullRequestModalProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: TrackPullRequestModalMode;
  step: TrackPullRequestModalStep;
  selectedRepo: RepoSummary | null;
  searchQuery: string;
  onSearchChange: (value: string) => void;
  isLoadingRepos: boolean;
  availableReposError: unknown;
  filteredRepos: RepoSummary[];
  isSavingRepo: boolean;
  onPickRepo: (repo: RepoSummary) => void;
  pullRequests: PullRequestSummary[];
  isLoadingPullRequests: boolean;
  pullRequestsError: string;
  isTrackingPullRequest: boolean;
  onPickPullRequest: (pullRequest: PullRequestSummary) => void;
  onBack: () => void;
};

type RepoSelectionStepProps = {
  searchQuery: string;
  onSearchChange: (value: string) => void;
  isLoadingRepos: boolean;
  availableReposError: unknown;
  filteredRepos: RepoSummary[];
  isSavingRepo: boolean;
  onPickRepo: (repo: RepoSummary) => void;
};

function RepoSelectionStep({
  searchQuery,
  onSearchChange,
  isLoadingRepos,
  availableReposError,
  filteredRepos,
  isSavingRepo,
  onPickRepo,
}: RepoSelectionStepProps) {
  return (
    <>
      <div className="flex min-h-0 flex-col">
        <CommandMenu.Input
          autoFocus
          disabled={isLoadingRepos || isSavingRepo}
          onValueChange={onSearchChange}
          placeholder="Search Repositories by title"
          value={searchQuery}
        />

        <p className="px-4 py-2 font-sans text-xs text-neutral-500">
          Repositories
        </p>

        <CommandMenu.List className="pt-0" label="Repositories">
          {isLoadingRepos ? (
            <CommandMenu.Loading>
              Loading repos via gh...
            </CommandMenu.Loading>
          ) : null}

          {availableReposError ? (
            <div className="px-2 py-3 text-sm text-danger-600">
              {availableReposError instanceof Error
                ? availableReposError.message
                : String(availableReposError)}
            </div>
          ) : null}

          {!isLoadingRepos &&
          !availableReposError &&
          filteredRepos.length === 0 ? (
            <div className="px-2 py-3 text-sm text-ink-500">
              No repos to add.
            </div>
          ) : null}

          {!isLoadingRepos && !availableReposError
            ? filteredRepos.map((repo) => (
                <CommandMenu.Item
                  disabled={isSavingRepo}
                  key={repo.nameWithOwner}
                  keywords={[
                    repo.description ?? "",
                    getOwnerLogin(repo.nameWithOwner),
                  ]}
                  onSelect={() => onPickRepo(repo)}
                  value={`repo:${repo.nameWithOwner}`}
                >
                  <div className="flex items-center gap-2.5">
                    <img
                      alt={`${getOwnerLogin(repo.nameWithOwner)} avatar`}
                      className="mt-0.5 size-7 shrink-0 rounded-full object-cover"
                      loading="lazy"
                      src={getOwnerAvatarUrl(repo.nameWithOwner)}
                    />
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 text-sm">
                        <span className="truncate">{repo.nameWithOwner}</span>
                      </div>
                      {repo.description ? (
                        <div className="mt-1 truncate text-xs text-neutral-500">
                          {repo.description}
                        </div>
                      ) : null}
                    </div>
                  </div>
                </CommandMenu.Item>
              ))
            : null}
        </CommandMenu.List>
      </div>
    </>
  );
}

type PullRequestSelectionStepProps = {
  mode: TrackPullRequestModalMode;
  selectedRepo: RepoSummary | null;
  pullRequests: PullRequestSummary[];
  isLoadingPullRequests: boolean;
  pullRequestsError: string;
  isTrackingPullRequest: boolean;
  onPickPullRequest: (pullRequest: PullRequestSummary) => void;
  onBack: () => void;
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

function PullRequestSelectionStep({
  mode,
  selectedRepo,
  pullRequests,
  isLoadingPullRequests,
  pullRequestsError,
  isTrackingPullRequest,
  onPickPullRequest,
  onBack,
}: PullRequestSelectionStepProps) {
  const [pullRequestSearchQuery, setPullRequestSearchQuery] = useState("");

  useEffect(() => {
    setPullRequestSearchQuery("");
  }, [selectedRepo?.nameWithOwner]);

  return (
    <>
      <div className="flex min-h-0 flex-col">
        <div className="flex items-center gap-2 border-b border-neutral-200 px-4 py-3 dark:border-neutral-700">
          {mode === "repo-then-pr" ? (
            <button
              aria-label="Back to repo list"
              className="inline-flex items-center justify-center rounded p-1 text-ink-500 transition hover:bg-canvas hover:text-ink-700"
              onClick={onBack}
              type="button"
            >
              <ArrowLeftIcon className="size-4 shrink-0" />
            </button>
          ) : null}
          <p className="min-w-0 truncate font-sans text-xs text-neutral-500">
            {selectedRepo
              ? `Pull Requests in ${selectedRepo.nameWithOwner}`
              : "Pull Requests"}
          </p>
        </div>

        <CommandMenu.Input
          autoFocus={mode === "pr-only"}
          disabled={isLoadingPullRequests || isTrackingPullRequest}
          onValueChange={setPullRequestSearchQuery}
          placeholder="Search pull requests by title, author, or number"
          value={pullRequestSearchQuery}
        />

        <CommandMenu.List label="Pull requests">
          {isLoadingPullRequests ? (
            <CommandMenu.Loading>Loading...</CommandMenu.Loading>
          ) : null}

          {pullRequestsError ? (
            <div className="px-2 py-3 text-sm text-danger-600">
              {pullRequestsError}
            </div>
          ) : null}

          {!isLoadingPullRequests && !pullRequestsError ? (
            <>
              <CommandMenu.Empty>
                No PRs to add.
              </CommandMenu.Empty>
              {pullRequests.map((pullRequest) => {
                const prKey = `modal-pr-${pullRequest.number}`;
                const status = getPullRequestStatus(pullRequest);
                return (
                  <CommandMenu.Item
                    disabled={isTrackingPullRequest}
                    key={prKey}
                    keywords={[
                      pullRequest.authorLogin,
                      String(pullRequest.number),
                      status.label,
                    ]}
                    onSelect={() => onPickPullRequest(pullRequest)}
                    value={`pr:${pullRequest.number}:${pullRequest.title}`}
                  >
                    <p className="text-xs text-neutral-500">
                      {pullRequest.authorLogin}
                    </p>
                    <div className="flex items-center gap-3">
                      <div className="flex min-w-0 flex-1 items-center gap-2">
                        <div className="shrink-0">
                          <PullRequestStatusIcon status={status.status} />
                        </div>
                        <p className="min-w-0 flex-1 truncate text-sm text-ink-700">
                          {pullRequest.title}
                        </p>
                      </div>
                      <p className="shrink-0 whitespace-nowrap text-xs font-mono font-semibold text-ink-500">
                        #{pullRequest.number}{" "}
                        <span className="text-green-600 dark:text-green-300">
                          +{pullRequest.additions}
                        </span>{" "}
                        <span className="text-red-600 dark:text-red-300">
                          -{pullRequest.deletions}
                        </span>
                      </p>
                    </div>
                  </CommandMenu.Item>
                );
              })}
            </>
          ) : null}
        </CommandMenu.List>
      </div>
    </>
  );
}

function TrackPullRequestModal({
  open,
  onOpenChange,
  mode,
  step,
  selectedRepo,
  searchQuery,
  onSearchChange,
  isLoadingRepos,
  availableReposError,
  filteredRepos,
  isSavingRepo,
  onPickRepo,
  pullRequests,
  isLoadingPullRequests,
  pullRequestsError,
  isTrackingPullRequest,
  onPickPullRequest,
  onBack,
}: TrackPullRequestModalProps) {
  const showRepoStep = step === "repo";
  const showPullRequestStep = step === "pull-request";

  return (
    <CommandMenu.Dialog
      label="Track pull request"
      loop
      onOpenChange={onOpenChange}
      open={open}
      shouldFilter={showPullRequestStep}
    >
      {showRepoStep ? (
        <RepoSelectionStep
          availableReposError={availableReposError}
          filteredRepos={filteredRepos}
          isLoadingRepos={isLoadingRepos}
          isSavingRepo={isSavingRepo}
          onPickRepo={onPickRepo}
          onSearchChange={onSearchChange}
          searchQuery={searchQuery}
        />
      ) : null}

      {showPullRequestStep ? (
        <PullRequestSelectionStep
          isLoadingPullRequests={isLoadingPullRequests}
          isTrackingPullRequest={isTrackingPullRequest}
          mode={mode}
          onBack={onBack}
          onPickPullRequest={onPickPullRequest}
          pullRequests={pullRequests}
          pullRequestsError={pullRequestsError}
          selectedRepo={selectedRepo}
        />
      ) : null}
    </CommandMenu.Dialog>
  );
}

export { TrackPullRequestModal };
export type {
  TrackPullRequestModalMode,
  TrackPullRequestModalProps,
  TrackPullRequestModalStep,
};
