import { queryOptions } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import type { ReviewThread } from "../lib/review-threads";
import type {
  CreatePullRequestReviewCommentInput,
  GhCliStatus,
  PrPatch,
  PullRequestChecks,
  PullRequestDiffBundle,
  PullRequestOverview,
  PullRequestSummary,
  ReplyToPullRequestReviewCommentInput,
  RepoSummary,
  SelectedPullRequestRevision,
  UpdatePullRequestReviewCommentInput,
  ViewerLogin,
} from "../types/github";

const INITIAL_REPO_LIMIT = 20;
const SEARCH_REPO_LIMIT = 20;

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
    queryFn: () => invoke<RepoSummary[]>("list_saved_repos"),
    staleTime: Infinity,
  });
}

function ghCliStatusQueryOptions() {
  return queryOptions({
    queryKey: githubKeys.ghCliStatus(),
    queryFn: () => invoke<GhCliStatus>("get_gh_cli_status"),
    staleTime: 0,
  });
}

function viewerLoginQueryOptions() {
  return queryOptions({
    queryKey: githubKeys.viewerLogin(),
    queryFn: async () => {
      const login = await invoke<string>("get_viewer_login");
      return { login } satisfies ViewerLogin;
    },
    staleTime: 60 * 60 * 1000,
  });
}

function initialReposQueryOptions() {
  return queryOptions({
    queryKey: githubKeys.initialRepos(),
    queryFn: () =>
      invoke<RepoSummary[]>("list_initial_repos", { limit: INITIAL_REPO_LIMIT }),
    gcTime: 0,
    refetchOnMount: "always",
    staleTime: 0,
  });
}

function searchReposQueryOptions(query: string) {
  return queryOptions({
    queryKey: githubKeys.searchRepos(query),
    queryFn: () =>
      invoke<RepoSummary[]>("search_repos", { query, limit: SEARCH_REPO_LIMIT }),
    staleTime: 5 * 60 * 1000,
  });
}

function pullRequestCachedListQueryOptions(repo: string) {
  return queryOptions({
    queryKey: githubKeys.pullRequestCachedList(repo),
    queryFn: () => invoke<PullRequestSummary[]>("list_cached_pull_requests", { repo }),
    staleTime: 0,
  });
}

function pullRequestListQueryOptions(repo: string) {
  return queryOptions({
    queryKey: githubKeys.pullRequestList(repo),
    queryFn: () => invoke<PullRequestSummary[]>("list_pull_requests", { repo }),
    staleTime: 0,
  });
}

function trackedPullRequestListQueryOptions(repo: string) {
  return queryOptions({
    queryKey: githubKeys.trackedPullRequestList(repo),
    queryFn: () => invoke<PullRequestSummary[]>("list_tracked_pull_requests", { repo }),
    staleTime: Infinity,
  });
}

function trackedPullRequestRefreshQueryOptions(repo: string) {
  return queryOptions({
    queryKey: githubKeys.trackedPullRequestRefresh(repo),
    queryFn: () => invoke<PullRequestSummary[]>("refresh_tracked_pull_requests", { repo }),
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
    queryFn: () =>
      invoke<PullRequestDiffBundle>("get_pull_request_diff_bundle", {
        repo: pr.repo,
        number: pr.number,
        headSha: pr.headSha,
      }),
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
    queryFn: () =>
      invoke<PrPatch>("get_pull_request_patch", {
        repo: pr.repo,
        number: pr.number,
        headSha: pr.headSha,
      }),
  });
}

function pullRequestFilesQueryOptions(pr: {
  repo: string;
  number: number;
  headSha: string;
}) {
  return queryOptions({
    queryKey: ["pull-request-compat", pr.repo, pr.number, pr.headSha, "files"] as const,
    queryFn: () =>
      invoke<string[]>("list_pull_request_changed_files", {
        repo: pr.repo,
        number: pr.number,
        headSha: pr.headSha,
      }),
  });
}

function pullRequestReviewThreadsQueryOptions(pr: SelectedPullRequestRevision) {
  return queryOptions({
    queryKey: githubKeys.pullRequestReviewThreads(pr),
    queryFn: () =>
      invoke<ReviewThread[]>("get_pull_request_review_threads", {
        repo: pr.repo,
        number: pr.number,
      }),
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
    queryFn: () =>
      invoke<PullRequestOverview>("get_pull_request_overview", {
        repo: pr.repo,
        number: pr.number,
      }),
  });
}

function pullRequestChecksQueryOptions(pr: SelectedPullRequestRevision) {
  return queryOptions({
    queryKey: githubKeys.pullRequestChecks(pr),
    queryFn: () =>
      invoke<PullRequestChecks>("get_pull_request_checks", {
        repo: pr.repo,
        number: pr.number,
      }),
  });
}

async function refreshPullRequestSummary(pr: SelectedPullRequestRef) {
  return invoke<PullRequestSummary>("get_pull_request_summary", {
    repo: pr.repo,
    number: pr.number,
  });
}

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

async function createPullRequestReviewComment(
  input: CreatePullRequestReviewCommentInput,
) {
  await invoke("create_pull_request_review_comment", {
    repo: input.repo,
    number: input.number,
    body: input.body,
    path: input.path,
    line: input.line,
    side: input.side,
    startLine: input.startLine,
    startSide: input.startSide,
    subjectType: input.subjectType,
  });
}

async function replyToPullRequestReviewComment(
  input: ReplyToPullRequestReviewCommentInput,
) {
  await invoke("reply_to_pull_request_review_comment", {
    threadId: input.threadId,
    body: input.body,
  });
}

async function updatePullRequestReviewComment(
  input: UpdatePullRequestReviewCommentInput,
) {
  await invoke("update_pull_request_review_comment", {
    commentId: input.commentId,
    body: input.body,
  });
}

export {
  createPullRequestReviewComment,
  ghCliStatusQueryOptions,
  githubKeys,
  initialReposQueryOptions,
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
