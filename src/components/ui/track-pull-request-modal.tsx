import { useEffect, useState } from "react";
import { ArrowLeftIcon } from "@heroicons/react/20/solid";
import { CommandMenu } from "./command-menu";
import { DotmSquare15 } from "./dotm-square-15";
import { getOwnerAvatarUrl, getOwnerLogin } from "../../lib/github-owner";
import { type PullRequestSummary, type RepoSummary } from "../../types/github";
import {
  getPullRequestStatus,
  PullRequestStatusIcon,
} from "./pull-request-status";

type TrackPullRequestModalMode = "repo-then-pr" | "pr-only";
type TrackPullRequestModalStep = "repo" | "pull-request";

type TrackPullRequestModalProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: TrackPullRequestModalMode;
  step: TrackPullRequestModalStep;
  selectedRepo: RepoSummary | null;
  onSearchChange: (value: string) => void;
  isLoadingRepos: boolean;
  availableReposError: unknown;
  filteredRepos: RepoSummary[];
  isSubmittingRepo: boolean;
  manualRepoError: string | null;
  onPickRepo: (repo: RepoSummary) => void;
  onSubmitManualRepo: (repoNameWithOwner: string) => void;
  pullRequests: PullRequestSummary[];
  isLoadingPullRequests: boolean;
  pullRequestsError: string;
  isTrackingPullRequest: boolean;
  onPickPullRequest: (pullRequest: PullRequestSummary) => void;
  onBack: () => void;
};

type RepoSelectionStepProps = {
  open: boolean;
  onSearchChange: (value: string) => void;
  isLoadingRepos: boolean;
  availableReposError: unknown;
  filteredRepos: RepoSummary[];
  isSubmittingRepo: boolean;
  manualRepoError: string | null;
  onPickRepo: (repo: RepoSummary) => void;
  onSubmitManualRepo: (repoNameWithOwner: string) => void;
};

function RepoSelectionStep({
  open,
  onSearchChange,
  isLoadingRepos,
  availableReposError,
  filteredRepos,
  isSubmittingRepo,
  manualRepoError,
  onPickRepo,
  onSubmitManualRepo,
}: RepoSelectionStepProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [manualRepoQuery, setManualRepoQuery] = useState("");

  useEffect(() => {
    if (!open) {
      setSearchQuery("");
      setManualRepoQuery("");
    }
  }, [open]);

  return (
    <>
      <div className="flex h-full min-h-0 flex-col">
        <div className="relative">
          <CommandMenu.Input
            autoFocus
            disabled={isSubmittingRepo}
            onValueChange={(value) => {
              setSearchQuery(value);
              onSearchChange(value);
            }}
            placeholder="Search Repositories by title"
            value={searchQuery}
          />
        </div>

        <div className="border-b border-neutral-200 px-4 py-3 dark:border-neutral-700">
          <p className="mb-2 font-sans text-[11px] uppercase tracking-[0.08em] text-neutral-500">
            Open PR link
          </p>
          <div className="flex items-center gap-2">
            <input
              className="h-9 min-w-0 flex-1 rounded-md border border-neutral-300 bg-surface px-3 text-sm text-ink-900 outline-none transition placeholder:text-neutral-400 focus:border-neutral-500 dark:border-neutral-700"
              disabled={isSubmittingRepo}
              onChange={(event) => setManualRepoQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key !== "Enter") return;
                event.preventDefault();
                onSubmitManualRepo(manualRepoQuery);
              }}
              placeholder="github.com/owner/repo/pull/123"
              value={manualRepoQuery}
            />
            <button
              className="inline-flex h-9 shrink-0 items-center justify-center rounded-md border border-neutral-300 bg-canvas px-3 text-sm font-medium text-ink-700 transition hover:bg-canvasDark disabled:cursor-not-allowed disabled:opacity-60 dark:border-neutral-700"
              disabled={isSubmittingRepo}
              onClick={() => onSubmitManualRepo(manualRepoQuery)}
              type="button"
            >
              Open PR
            </button>
          </div>
          {manualRepoError ? (
            <p className="mt-2 text-sm text-danger-600">{manualRepoError}</p>
          ) : (
            <p className="mt-2 text-xs text-neutral-500">
              Paste any GitHub pull request URL to track it directly.
            </p>
          )}
        </div>

        <p className="px-4 py-2 font-sans text-xs text-neutral-500">
          Repositories
        </p>

        <CommandMenu.List className="pt-0" label="Repositories">
          {isLoadingRepos ? (
            <CommandMenu.Loading>
              <span className="flex w-full items-center justify-center gap-2 py-6">
                <DotmSquare15 dotSize={2.4} size={18} />
                <span>Searching repositories....</span>
              </span>
            </CommandMenu.Loading>
          ) : null}

          {!isLoadingRepos && availableReposError ? (
            <div className="px-2 py-3 text-sm text-danger-600">
              {availableReposError instanceof Error
                ? availableReposError.message
                : String(availableReposError)}
            </div>
          ) : null}

          {!isLoadingRepos && !availableReposError && filteredRepos.length === 0 ? (
            <div className="px-2 py-3 text-sm text-ink-500">
              No repos to add.
            </div>
          ) : null}

          {!isLoadingRepos && !availableReposError
            ? filteredRepos.map((repo) => (
                <CommandMenu.Item
                  disabled={isSubmittingRepo}
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
                        <div className="mt-1 truncate text-xs text-neutral-400">
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
      <div className="flex h-full min-h-0 flex-col">
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

        <div className="relative">
          <CommandMenu.Input
            autoFocus={mode === "pr-only"}
            disabled={isTrackingPullRequest}
            onValueChange={setPullRequestSearchQuery}
            placeholder="Search pull requests by title, author, or number"
            value={pullRequestSearchQuery}
          />
        </div>

        <CommandMenu.List label="Pull requests">
          {isLoadingPullRequests ? (
            <CommandMenu.Loading>
              <span className="flex w-full items-center justify-center gap-2 py-6">
                <DotmSquare15 dotSize={2.4} size={18} />
                <span>Searching pull requests....</span>
              </span>
            </CommandMenu.Loading>
          ) : null}

          {!isLoadingPullRequests && pullRequestsError ? (
            <div className="px-2 py-3 text-sm text-danger-600">
              {pullRequestsError}
            </div>
          ) : null}

          {!isLoadingPullRequests && !pullRequestsError ? (
            <>
              <CommandMenu.Empty>No PRs to add.</CommandMenu.Empty>
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
                    <p className="text-xs text-neutral-300">
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
  onSearchChange,
  isLoadingRepos,
  availableReposError,
  filteredRepos,
  isSubmittingRepo,
  manualRepoError,
  onPickRepo,
  onSubmitManualRepo,
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
      contentClassName="min-h-[420px]"
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
          isSubmittingRepo={isSubmittingRepo}
          manualRepoError={manualRepoError}
          onPickRepo={onPickRepo}
          onSearchChange={onSearchChange}
          onSubmitManualRepo={onSubmitManualRepo}
          open={open}
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
