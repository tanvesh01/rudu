import { queryOptions } from "@tanstack/react-query";
import {
  createPullRequestReviewComment,
  countOpenIssueRoles,
  getGhCliStatus,
  getPullRequestChecks,
  getPullRequestDiffBundle,
  getPullRequestOverview,
  getPullRequestPatch,
  getPullRequestReviewThreads,
  getPullRequestSummary,
  getViewerLogin,
  listCachedPullRequests,
  listInitialRepos,
  listOpenIssueBuckets,
  listPullRequestChangedFiles,
  listPullRequests,
  listSavedRepos,
  listTrackedPullRequests,
  refreshTrackedPullRequests,
  replyToPullRequestReviewComment,
  searchRepos,
  updatePullRequestReviewComment,
} from "./github-native";
import type {
  PullRequestSummary,
  SelectedPullRequestRef,
  SelectedPullRequestRevision,
} from "../types/github";

const INITIAL_REPO_LIMIT = 20;
const SEARCH_REPO_LIMIT = 20;
const ISSUE_STALE_TIME_MS = 60 * 1000;

type GithubRefreshKind =
  | "tracked-prs"
  | "selected-pr-summary"
  | "diff-bundle"
  | "review-threads";

type GithubRefreshMeta = {
  isGithubRefresh: true;
  refreshKind: GithubRefreshKind;
  refreshLabel: string;
  repo: string;
  number?: number;
  headSha?: string;
};

function createRefreshMeta(meta: Omit<GithubRefreshMeta, "isGithubRefresh">) {
  return {
    ...meta,
    isGithubRefresh: true,
  } satisfies GithubRefreshMeta;
}

const githubKeys = {
  all: ["github"] as const,
  repos: () => [...githubKeys.all, "repos"] as const,
  ghCliStatus: () => [...githubKeys.all, "gh-cli-status"] as const,
  savedRepos: () => [...githubKeys.repos(), "saved"] as const,
  initialRepos: () => [...githubKeys.repos(), "initial"] as const,
  searchRepos: (query: string) => [...githubKeys.repos(), "search", query] as const,
  viewerLogin: () => [...githubKeys.repos(), "viewer-login"] as const,
  issues: () => [...githubKeys.all, "issues"] as const,
  openIssueBuckets: () => [...githubKeys.issues(), "open-buckets"] as const,
  openIssueRoleCounts: () => [...githubKeys.issues(), "open-role-counts"] as const,
  pullRequests: () => [...githubKeys.all, "pull-requests"] as const,
  pullRequestList: (repo: string) => [...githubKeys.pullRequests(), "list", repo] as const,
  pullRequestCachedList: (repo: string) =>
    [...githubKeys.pullRequests(), "list", repo, "cached"] as const,
  trackedPullRequests: () => [...githubKeys.pullRequests(), "tracked"] as const,
  trackedPullRequestList: (repo: string) =>
    [...githubKeys.trackedPullRequests(), "list", repo] as const,
  refreshes: () => [...githubKeys.all, "refreshes"] as const,
  trackedPullRequestRefresh: (repo: string) =>
    [...githubKeys.refreshes(), "tracked-prs", repo] as const,
  selectedPullRequestSummaryRefresh: (pr: SelectedPullRequestRef) =>
    [...githubKeys.refreshes(), "selected-pr-summary", pr.repo, pr.number] as const,
  pullRequestDiffBundle: (pr: SelectedPullRequestRevision) =>
    ["pull-request", pr.repo, pr.number, pr.headSha, "diff"] as const,
  pullRequestReviewThreads: (pr: SelectedPullRequestRevision) =>
    ["pull-request", pr.repo, pr.number, pr.headSha, "review-threads"] as const,
  pullRequestOverview: (pr: SelectedPullRequestRef) =>
    ["pull-request", pr.repo, pr.number, "overview"] as const,
  pullRequestChecks: (pr: SelectedPullRequestRevision) =>
    ["pull-request", pr.repo, pr.number, pr.headSha, "checks"] as const,
  pullRequestDiffBundleIdle: () => ["pull-request", "idle", "diff"] as const,
  pullRequestReviewThreadsIdle: () =>
    ["pull-request", "idle", "review-threads"] as const,
};

function savedReposQueryOptions() {
  return queryOptions({
    queryKey: githubKeys.savedRepos(),
    queryFn: listSavedRepos,
    staleTime: Infinity,
  });
}

function ghCliStatusQueryOptions() {
  return queryOptions({
    queryKey: githubKeys.ghCliStatus(),
    queryFn: getGhCliStatus,
    staleTime: 0,
  });
}

function viewerLoginQueryOptions() {
  return queryOptions({
    queryKey: githubKeys.viewerLogin(),
    queryFn: getViewerLogin,
    staleTime: 60 * 60 * 1000,
  });
}

function openIssueRoleCountsQueryOptions() {
  return queryOptions({
    queryKey: githubKeys.openIssueRoleCounts(),
    queryFn: countOpenIssueRoles,
    refetchOnWindowFocus: true,
    staleTime: ISSUE_STALE_TIME_MS,
  });
}

function openIssueBucketsQueryOptions() {
  return queryOptions({
    queryKey: githubKeys.openIssueBuckets(),
    queryFn: listOpenIssueBuckets,
    refetchOnWindowFocus: true,
    staleTime: ISSUE_STALE_TIME_MS,
  });
}

function initialReposQueryOptions() {
  return queryOptions({
    queryKey: githubKeys.initialRepos(),
    queryFn: () => listInitialRepos(INITIAL_REPO_LIMIT),
    gcTime: 0,
    refetchOnMount: "always",
    staleTime: 0,
  });
}

function searchReposQueryOptions(query: string) {
  return queryOptions({
    queryKey: githubKeys.searchRepos(query),
    queryFn: () => searchRepos(query, SEARCH_REPO_LIMIT),
    staleTime: 5 * 60 * 1000,
  });
}

function pullRequestCachedListQueryOptions(repo: string) {
  return queryOptions({
    queryKey: githubKeys.pullRequestCachedList(repo),
    queryFn: () => listCachedPullRequests(repo),
    staleTime: 0,
  });
}

function pullRequestListQueryOptions(repo: string) {
  return queryOptions({
    queryKey: githubKeys.pullRequestList(repo),
    queryFn: () => listPullRequests(repo),
    staleTime: 0,
  });
}

function trackedPullRequestListQueryOptions(repo: string) {
  return queryOptions({
    queryKey: githubKeys.trackedPullRequestList(repo),
    queryFn: () => listTrackedPullRequests(repo),
    staleTime: Infinity,
  });
}

function trackedPullRequestRefreshQueryOptions(repo: string) {
  return queryOptions({
    queryKey: githubKeys.trackedPullRequestRefresh(repo),
    queryFn: () => refreshTrackedPullRequests(repo),
    meta: createRefreshMeta({
      refreshKind: "tracked-prs",
      refreshLabel: `Refreshing tracked PRs for ${repo}`,
      repo,
    }),
  });
}

function pullRequestDiffBundleQueryOptions(pr: SelectedPullRequestRevision) {
  return queryOptions({
    queryKey: githubKeys.pullRequestDiffBundle(pr),
    queryFn: () => getPullRequestDiffBundle(pr),
    meta: createRefreshMeta({
      refreshKind: "diff-bundle",
      refreshLabel: `Refreshing diff for ${pr.repo}#${pr.number}`,
      repo: pr.repo,
      number: pr.number,
      headSha: pr.headSha,
    }),
  });
}

function pullRequestPatchQueryOptions(pr: {
  repo: string;
  number: number;
  headSha: string;
}) {
  return queryOptions({
    queryKey: ["pull-request-compat", pr.repo, pr.number, pr.headSha, "patch"] as const,
    queryFn: () => getPullRequestPatch(pr),
  });
}

function pullRequestFilesQueryOptions(pr: {
  repo: string;
  number: number;
  headSha: string;
}) {
  return queryOptions({
    queryKey: ["pull-request-compat", pr.repo, pr.number, pr.headSha, "files"] as const,
    queryFn: () => listPullRequestChangedFiles(pr),
  });
}

function pullRequestReviewThreadsQueryOptions(pr: SelectedPullRequestRevision) {
  return queryOptions({
    queryKey: githubKeys.pullRequestReviewThreads(pr),
    queryFn: () => getPullRequestReviewThreads(pr),
    meta: createRefreshMeta({
      refreshKind: "review-threads",
      refreshLabel: `Refreshing review threads for ${pr.repo}#${pr.number}`,
      repo: pr.repo,
      number: pr.number,
      headSha: pr.headSha,
    }),
  });
}

function pullRequestOverviewQueryOptions(pr: SelectedPullRequestRef) {
  return queryOptions({
    queryKey: githubKeys.pullRequestOverview(pr),
    queryFn: () => getPullRequestOverview(pr),
  });
}

function pullRequestChecksQueryOptions(pr: SelectedPullRequestRevision) {
  return queryOptions({
    queryKey: githubKeys.pullRequestChecks(pr),
    queryFn: () => getPullRequestChecks(pr),
  });
}

const refreshPullRequestSummary = getPullRequestSummary;

function pullRequestSummaryRefreshQueryOptions(pr: SelectedPullRequestRef) {
  return queryOptions({
    queryKey: githubKeys.selectedPullRequestSummaryRefresh(pr),
    queryFn: () => refreshPullRequestSummary(pr),
    meta: createRefreshMeta({
      refreshKind: "selected-pr-summary",
      refreshLabel: `Refreshing PR summary for ${pr.repo}#${pr.number}`,
      repo: pr.repo,
      number: pr.number,
    }),
  });
}

function isGithubRefreshMeta(meta: unknown): meta is GithubRefreshMeta {
  return Boolean(
    meta &&
      typeof meta === "object" &&
      "isGithubRefresh" in meta &&
      meta.isGithubRefresh === true,
  );
}

function upsertTrackedPullRequest(
  current: PullRequestSummary[] | undefined,
  pullRequest: PullRequestSummary,
) {
  const list = current ?? [];
  let didReplace = false;
  const next = list.map((item) => {
    if (item.number !== pullRequest.number) {
      return item;
    }

    didReplace = true;
    return pullRequest;
  });

  return didReplace ? next : [pullRequest, ...list];
}

export {
  createPullRequestReviewComment,
  ghCliStatusQueryOptions,
  githubKeys,
  initialReposQueryOptions,
  openIssueBucketsQueryOptions,
  openIssueRoleCountsQueryOptions,
  pullRequestCachedListQueryOptions,
  pullRequestDiffBundleQueryOptions,
  pullRequestFilesQueryOptions,
  pullRequestListQueryOptions,
  pullRequestPatchQueryOptions,
  pullRequestSummaryRefreshQueryOptions,
  pullRequestOverviewQueryOptions,
  pullRequestChecksQueryOptions,
  pullRequestReviewThreadsQueryOptions,
  trackedPullRequestListQueryOptions,
  trackedPullRequestRefreshQueryOptions,
  replyToPullRequestReviewComment,
  refreshPullRequestSummary,
  isGithubRefreshMeta,
  savedReposQueryOptions,
  searchReposQueryOptions,
  updatePullRequestReviewComment,
  upsertTrackedPullRequest,
  viewerLoginQueryOptions,
};
export type { GithubRefreshMeta };
