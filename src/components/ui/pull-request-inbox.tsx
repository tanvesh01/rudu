import { EyeIcon } from "@heroicons/react/20/solid";
import { useQuery } from "@tanstack/react-query";
import { useSearch } from "@tanstack/react-router";
import type {
  PullRequestInboxItem,
  PullRequestSummary,
} from "../../types/github";
import { getErrorMessage } from "../../lib/get-error-message";
import { pullRequestListQueryOptions } from "../../queries/github";
import { getPullRequestStatus, PullRequestStatusIcon } from "./pull-request-status";
import { ALL_REPOSITORIES } from "./repository-combobox";

type PullRequestScope = "inbox" | "all";

type InboxGroup = {
  label: string;
  pullRequests: PullRequestInboxItem[];
};

function groupPullRequests(
  pullRequests: PullRequestInboxItem[],
  viewerLogin: string,
): InboxGroup[] {
  const groups: InboxGroup[] = [
    { label: "Needs your review", pullRequests: [] },
    { label: "Drafts", pullRequests: [] },
    { label: "Waiting for author", pullRequests: [] },
    { label: "Waiting for reviewers", pullRequests: [] },
  ];
  const openedByAuthor = new Map<string, PullRequestInboxItem[]>();

  for (const pullRequest of pullRequests) {
    const isAuthor = pullRequest.authorLogin === viewerLogin;
    if (pullRequest.reviewRequested) groups[0].pullRequests.push(pullRequest);
    else if (pullRequest.isDraft) groups[1].pullRequests.push(pullRequest);
    else if (pullRequest.reviewDecision === "CHANGES_REQUESTED")
      groups[2].pullRequests.push(pullRequest);
    else if (isAuthor) groups[3].pullRequests.push(pullRequest);
    else {
      const authorPullRequests = openedByAuthor.get(pullRequest.authorLogin) ?? [];
      authorPullRequests.push(pullRequest);
      openedByAuthor.set(pullRequest.authorLogin, authorPullRequests);
    }
  }

  return [
    groups[0],
    ...Array.from(openedByAuthor, ([author, authorPullRequests]) => ({
      label: `Opened by ${author}`,
      pullRequests: authorPullRequests,
    })),
    groups[3],
    groups[1],
    groups[2],
  ].filter((group) => group.pullRequests.length > 0);
}

function filterPullRequestsByRepo(
  pullRequests: PullRequestInboxItem[],
  repo: string,
) {
  return repo === ALL_REPOSITORIES
    ? pullRequests
    : pullRequests.filter((pullRequest) => pullRequest.repo === repo);
}

function addRepoToPullRequests(
  pullRequests: PullRequestSummary[],
  repo: string,
): PullRequestInboxItem[] {
  return pullRequests.map((pullRequest) => ({
    ...pullRequest,
    repo,
    reviewDecision: null,
    reviewRequested: false,
  }));
}

function PullRequestInbox({
  pullRequests,
  viewerLogin,
  onSelectPr,
}: {
  pullRequests: PullRequestInboxItem[];
  viewerLogin: string;
  onSelectPr: (repo: string, pullRequest: PullRequestSummary) => void;
}) {
  const search = useSearch({ from: "/pulls" });
  const repositories = new Set(
    pullRequests.map((pullRequest) => pullRequest.repo),
  );
  const activeRepo =
    search.repo && repositories.has(search.repo)
      ? search.repo
      : ALL_REPOSITORIES;
  const scope: PullRequestScope = search.scope ?? "inbox";
  const isAllScope = scope === "all" && activeRepo !== ALL_REPOSITORIES;
  const allRepoQuery = useQuery({
    ...pullRequestListQueryOptions(activeRepo),
    enabled: isAllScope,
  });
  const visiblePullRequests = isAllScope
    ? addRepoToPullRequests(allRepoQuery.data ?? [], activeRepo)
    : filterPullRequestsByRepo(pullRequests, activeRepo);

  return (
    <div className="flex flex-col">
      {isAllScope && allRepoQuery.isPending ? (
        <p className="px-4 py-3 text-sm text-ink-500">
          Loading pull requests…
        </p>
      ) : isAllScope && allRepoQuery.error ? (
        <p className="px-4 py-3 text-sm text-danger-600">
          {getErrorMessage(allRepoQuery.error)}
        </p>
      ) : (
        groupPullRequests(visiblePullRequests, viewerLogin).map((group) => (
          <section key={group.label}>
          <div className="flex items-center gap-2 border-b border-ink-300 px-4 py-3 text-xs font-medium text-ink-500">
            <EyeIcon className="size-4" />
            {group.label}
          </div>
          {group.pullRequests.map((pullRequest) => {
            const status = getPullRequestStatus(pullRequest);
            return (
              <button
                className="flex w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-canvasDark focus-visible:bg-surface"
                key={`${pullRequest.repo}#${pullRequest.number}`}
                onClick={() => onSelectPr(pullRequest.repo, pullRequest)}
                type="button"
              >
                <PullRequestStatusIcon status={status.status} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm text-ink-700">
                    {pullRequest.title}{" "}
                    <span className="text-ink-500">#{pullRequest.number}</span>
                  </p>
                  <p className="mt-0.5 truncate text-xs text-ink-500">
                    {pullRequest.authorLogin} · {pullRequest.repo}
                  </p>
                </div>
                <p className="shrink-0 font-mono text-xs font-semibold">
                  <span className="text-green-600 dark:text-green-300">
                    +{pullRequest.additions}
                  </span>{" "}
                  <span className="text-red-600 dark:text-red-300">
                    -{pullRequest.deletions}
                  </span>
                </p>
              </button>
            );
          })}
          </section>
        ))
      )}
    </div>
  );
}

export {
  addRepoToPullRequests,
  filterPullRequestsByRepo,
  groupPullRequests,
  PullRequestInbox,
};
