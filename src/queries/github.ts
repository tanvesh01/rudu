import { queryOptions } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import type { ReviewThread } from "../lib/review-threads";
import type {
  CreatePullRequestReviewCommentInput,
  PrPatch,
  PullRequestSummary,
  ReplyToPullRequestReviewCommentInput,
  RepoSummary,
  SelectedPullRequest,
  UpdatePullRequestReviewCommentInput,
  ViewerLogin,
} from "../types/github";

const INITIAL_REPO_LIMIT = 5;
const SEARCH_REPO_LIMIT = 20;

const githubKeys = {
  all: ["github"] as const,
  repos: () => [...githubKeys.all, "repos"] as const,
  savedRepos: () => [...githubKeys.repos(), "saved"] as const,
  initialRepos: () => [...githubKeys.repos(), "initial"] as const,
  searchRepos: (query: string) => [...githubKeys.repos(), "search", query] as const,
  viewerLogin: () => [...githubKeys.repos(), "viewer-login"] as const,
  pullRequests: () => [...githubKeys.all, "pull-requests"] as const,
  pullRequestList: (repo: string) => [...githubKeys.pullRequests(), "list", repo] as const,
  pullRequestCachedList: (repo: string) =>
    [...githubKeys.pullRequests(), "list", repo, "cached"] as const,
  pullRequestPatch: (pr: SelectedPullRequest) =>
    [...githubKeys.pullRequests(), "patch", pr.repo, pr.number, pr.headSha] as const,
  pullRequestFiles: (pr: SelectedPullRequest) =>
    [...githubKeys.pullRequests(), "files", pr.repo, pr.number, pr.headSha] as const,
  pullRequestReviewThreads: (pr: SelectedPullRequest) =>
    [...githubKeys.pullRequests(), "review-threads", pr.repo, pr.number, pr.headSha] as const,
  pullRequestPatchIdle: () => [...githubKeys.pullRequests(), "patch", "idle"] as const,
  pullRequestFilesIdle: () => [...githubKeys.pullRequests(), "files", "idle"] as const,
  pullRequestReviewThreadsIdle: () =>
    [...githubKeys.pullRequests(), "review-threads", "idle"] as const,
};

function savedReposQueryOptions() {
  return queryOptions({
    queryKey: githubKeys.savedRepos(),
    queryFn: () => invoke<RepoSummary[]>("list_saved_repos"),
    staleTime: Infinity,
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
    staleTime: 5 * 60 * 1000,
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

function pullRequestPatchQueryOptions(pr: SelectedPullRequest) {
  return queryOptions({
    queryKey: githubKeys.pullRequestPatch(pr),
    queryFn: () =>
      invoke<PrPatch>("get_pull_request_patch", {
        repo: pr.repo,
        number: pr.number,
        headSha: pr.headSha,
      }),
  });
}

function pullRequestFilesQueryOptions(pr: SelectedPullRequest) {
  return queryOptions({
    queryKey: githubKeys.pullRequestFiles(pr),
    queryFn: () =>
      invoke<string[]>("list_pull_request_changed_files", {
        repo: pr.repo,
        number: pr.number,
        headSha: pr.headSha,
      }),
  });
}

function pullRequestReviewThreadsQueryOptions(pr: SelectedPullRequest) {
  return queryOptions({
    queryKey: githubKeys.pullRequestReviewThreads(pr),
    queryFn: () =>
      invoke<ReviewThread[]>("get_pull_request_review_threads", {
        repo: pr.repo,
        number: pr.number,
      }),
  });
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
  githubKeys,
  initialReposQueryOptions,
  pullRequestCachedListQueryOptions,
  pullRequestFilesQueryOptions,
  pullRequestListQueryOptions,
  pullRequestPatchQueryOptions,
  pullRequestReviewThreadsQueryOptions,
  replyToPullRequestReviewComment,
  savedReposQueryOptions,
  searchReposQueryOptions,
  updatePullRequestReviewComment,
  viewerLoginQueryOptions,
};
