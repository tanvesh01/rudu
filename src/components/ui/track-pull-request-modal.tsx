import { ArrowLeftIcon } from "@heroicons/react/20/solid";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "./alert-dialog";
import { getOwnerAvatarUrl, getOwnerLogin } from "../../lib/github-owner";
import type { PullRequestSummary, RepoSummary } from "../../types/github";

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
    <AlertDialog onOpenChange={onOpenChange} open={open}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <div className="flex items-center gap-2">
            {mode === "repo-then-pr" && showPullRequestStep ? (
              <button
                aria-label="Back to repo list"
                className="inline-flex items-center justify-center rounded p-1 text-ink-500 transition hover:bg-canvas hover:text-ink-700"
                onClick={onBack}
                type="button"
              >
                <ArrowLeftIcon className="size-4 shrink-0" />
              </button>
            ) : null}
            <AlertDialogTitle>
              {showRepoStep
                ? "Add a repo"
                : selectedRepo
                  ? `Add a PR to ${selectedRepo.nameWithOwner}`
                  : "Add a PR"}
            </AlertDialogTitle>
          </div>
          <AlertDialogDescription>
            {showRepoStep
              ? "Pick a repo first, then choose one PR to track."
              : "Choose one open PR to add to the sidebar."}
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div className="my-4 flex min-h-0 flex-col gap-2.5">
          {showRepoStep ? (
            <>
              <input
                autoFocus
                className="w-full rounded-xl border border-ink-300 bg-surface px-3 py-2.5 outline-none transition placeholder:text-ink-500 focus:border-zinc-400"
                disabled={isLoadingRepos || isSavingRepo}
                onChange={(event) => onSearchChange(event.currentTarget.value)}
                placeholder="Search repos..."
                value={searchQuery}
              />

              {isLoadingRepos ? (
                <div className="px-0 py-2 text-sm text-ink-500">
                  Loading repos via gh...
                </div>
              ) : null}

              {availableReposError ? (
                <div className="text-sm text-danger-600">
                  {availableReposError instanceof Error
                    ? availableReposError.message
                    : String(availableReposError)}
                </div>
              ) : null}

              {!isLoadingRepos && !availableReposError ? (
                <div className="flex max-h-[340px] flex-col gap-1 overflow-y-auto">
                  {filteredRepos.length === 0 ? (
                    <div className="px-0 py-2 text-sm text-ink-500">
                      No repos to add.
                    </div>
                  ) : (
                    filteredRepos.map((repo) => (
                      <button
                        className="w-full rounded-lg border border-ink-200 bg-surface px-3 py-2.5 text-left transition hover:border-zinc-400 hover:bg-canvas disabled:cursor-default disabled:opacity-60"
                        disabled={isSavingRepo}
                        key={repo.nameWithOwner}
                        onClick={() => onPickRepo(repo)}
                        type="button"
                      >
                        <div className="flex items-start gap-2.5">
                          <img
                            alt={`${getOwnerLogin(repo.nameWithOwner)} avatar`}
                            className="mt-0.5 size-5 shrink-0 rounded-full border border-ink-300 object-cover"
                            loading="lazy"
                            src={getOwnerAvatarUrl(repo.nameWithOwner)}
                          />
                          <div className="min-w-0">
                            <div className="flex items-center gap-2 text-sm font-semibold">
                              <span className="truncate">{repo.nameWithOwner}</span>
                              {repo.isPrivate ? (
                                <span className="rounded bg-[#f0f0f5] px-1.5 py-px text-[11px] font-medium text-ink-500 dark:bg-ink-100/10 dark:text-ink-400">
                                  Private
                                </span>
                              ) : null}
                            </div>
                            {repo.description ? (
                              <div className="mt-1 truncate text-sm text-ink-500">
                                {repo.description}
                              </div>
                            ) : null}
                          </div>
                        </div>
                      </button>
                    ))
                  )}
                </div>
              ) : null}
            </>
          ) : null}

          {showPullRequestStep ? (
            <>
              {isLoadingPullRequests ? (
                <div className="px-0 py-2 text-sm text-ink-500">Loading PRs via gh...</div>
              ) : null}

              {pullRequestsError ? (
                <div className="text-sm text-danger-600">{pullRequestsError}</div>
              ) : null}

              {!isLoadingPullRequests && !pullRequestsError ? (
                <div className="flex max-h-[340px] flex-col gap-1 overflow-y-auto">
                  {pullRequests.length === 0 ? (
                    <div className="px-0 py-2 text-sm text-ink-500">No PRs to add.</div>
                  ) : (
                    pullRequests.map((pullRequest) => {
                      const prKey = `modal-pr-${pullRequest.number}`;
                      return (
                        <button
                          className="w-full rounded-lg border border-ink-200 bg-surface px-3 py-2.5 text-left transition hover:border-zinc-400 hover:bg-canvas disabled:cursor-default disabled:opacity-60"
                          disabled={isTrackingPullRequest}
                          key={prKey}
                          onClick={() => onPickPullRequest(pullRequest)}
                          type="button"
                        >
                          <p className="text-xs text-ink-500">{pullRequest.authorLogin}</p>
                          <p className="truncate text-sm font-medium text-ink-700">
                            {pullRequest.title}
                          </p>
                          <p className="mt-1 whitespace-nowrap text-xs font-mono font-semibold">
                            <span className="text-green-600 dark:text-green-300">
                              +{pullRequest.additions}
                            </span>{" "}
                            <span className="text-red-600 dark:text-red-300">
                              -{pullRequest.deletions}
                            </span>
                          </p>
                        </button>
                      );
                    })
                  )}
                </div>
              ) : null}
            </>
          ) : null}
        </div>

        <AlertDialogFooter>
          <AlertDialogCancel
            disabled={isSavingRepo || isTrackingPullRequest}
            type="button"
          >
            Cancel
          </AlertDialogCancel>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export { TrackPullRequestModal };
export type {
  TrackPullRequestModalMode,
  TrackPullRequestModalProps,
  TrackPullRequestModalStep,
};
