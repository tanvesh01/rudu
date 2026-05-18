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
  SelectedPullRequestRef,
  SelectedPullRequestRevision,
  UpdatePullRequestReviewCommentInput,
  ViewerLogin,
} from "../types/github";
import type {
  IssueBucketCounts,
  IssueDashboardData,
  LinearIntegrationStatus,
} from "../types/issues";

type InvokeFn = <T>(command: string, args?: Record<string, unknown>) => Promise<T>;

function createGithubNativeCommands(invokeCommand: InvokeFn) {
  return {
    listSavedRepos() {
      return invokeCommand<RepoSummary[]>("list_saved_repos");
    },
    getGhCliStatus() {
      return invokeCommand<GhCliStatus>("get_gh_cli_status");
    },
    async getViewerLogin(): Promise<ViewerLogin> {
      const login = await invokeCommand<string>("get_viewer_login");
      return { login };
    },
    countIssueBuckets() {
      return invokeCommand<IssueBucketCounts>("count_issue_buckets");
    },
    getIssueDashboard() {
      return invokeCommand<IssueDashboardData>("get_issue_dashboard");
    },
    getLinearIntegrationStatus() {
      return invokeCommand<LinearIntegrationStatus>(
        "get_linear_integration_status",
      );
    },
    saveLinearApiKey(apiKey: string) {
      return invokeCommand<LinearIntegrationStatus>("save_linear_api_key", {
        apiKey,
      });
    },
    deleteLinearApiKey() {
      return invokeCommand<LinearIntegrationStatus>("delete_linear_api_key");
    },
    listInitialRepos(limit: number) {
      return invokeCommand<RepoSummary[]>("list_initial_repos", { limit });
    },
    searchRepos(query: string, limit: number) {
      return invokeCommand<RepoSummary[]>("search_repos", { query, limit });
    },
    listCachedPullRequests(repo: string) {
      return invokeCommand<PullRequestSummary[]>("list_cached_pull_requests", {
        repo,
      });
    },
    listPullRequests(repo: string) {
      return invokeCommand<PullRequestSummary[]>("list_pull_requests", { repo });
    },
    listTrackedPullRequests(repo: string) {
      return invokeCommand<PullRequestSummary[]>("list_tracked_pull_requests", {
        repo,
      });
    },
    refreshTrackedPullRequests(repo: string) {
      return invokeCommand<PullRequestSummary[]>("refresh_tracked_pull_requests", {
        repo,
      });
    },
    saveRepo(repo: RepoSummary) {
      return invokeCommand<RepoSummary>("save_repo", { repo });
    },
    validateRepo(repo: string) {
      return invokeCommand<RepoSummary>("validate_repo", { repo });
    },
    trackPullRequest(repo: string, pullRequest: PullRequestSummary) {
      return invokeCommand<PullRequestSummary>("track_pull_request", {
        repo,
        pullRequest,
      });
    },
    removeTrackedPullRequest(repo: string, number: number) {
      return invokeCommand<void>("remove_tracked_pull_request", {
        repo,
        number,
      });
    },
    getPullRequestDiffBundle(pr: SelectedPullRequestRevision) {
      return invokeCommand<PullRequestDiffBundle>("get_pull_request_diff_bundle", {
        repo: pr.repo,
        number: pr.number,
        headSha: pr.headSha,
      });
    },
    getPullRequestPatch(pr: SelectedPullRequestRevision) {
      return invokeCommand<PrPatch>("get_pull_request_patch", {
        repo: pr.repo,
        number: pr.number,
        headSha: pr.headSha,
      });
    },
    listPullRequestChangedFiles(pr: SelectedPullRequestRevision) {
      return invokeCommand<string[]>("list_pull_request_changed_files", {
        repo: pr.repo,
        number: pr.number,
        headSha: pr.headSha,
      });
    },
    getPullRequestReviewThreads(pr: SelectedPullRequestRef) {
      return invokeCommand<ReviewThread[]>("get_pull_request_review_threads", {
        repo: pr.repo,
        number: pr.number,
      });
    },
    getPullRequestOverview(pr: SelectedPullRequestRef) {
      return invokeCommand<PullRequestOverview>("get_pull_request_overview", {
        repo: pr.repo,
        number: pr.number,
      });
    },
    getPullRequestChecks(pr: SelectedPullRequestRef) {
      return invokeCommand<PullRequestChecks>("get_pull_request_checks", {
        repo: pr.repo,
        number: pr.number,
      });
    },
    getPullRequestSummary(pr: SelectedPullRequestRef) {
      return invokeCommand<PullRequestSummary>("get_pull_request_summary", {
        repo: pr.repo,
        number: pr.number,
      });
    },
    createPullRequestReviewComment(input: CreatePullRequestReviewCommentInput) {
      return invokeCommand<void>("create_pull_request_review_comment", {
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
    },
    replyToPullRequestReviewComment(input: ReplyToPullRequestReviewCommentInput) {
      return invokeCommand<void>("reply_to_pull_request_review_comment", {
        threadId: input.threadId,
        body: input.body,
      });
    },
    updatePullRequestReviewComment(input: UpdatePullRequestReviewCommentInput) {
      return invokeCommand<void>("update_pull_request_review_comment", {
        commentId: input.commentId,
        body: input.body,
      });
    },
  };
}

const githubNativeCommands = createGithubNativeCommands(invoke);

export const {
  countIssueBuckets,
  createPullRequestReviewComment,
  deleteLinearApiKey,
  getGhCliStatus,
  getIssueDashboard,
  getLinearIntegrationStatus,
  getPullRequestChecks,
  getPullRequestDiffBundle,
  getPullRequestOverview,
  getPullRequestPatch,
  getPullRequestReviewThreads,
  getPullRequestSummary,
  getViewerLogin,
  listCachedPullRequests,
  listInitialRepos,
  listPullRequestChangedFiles,
  listPullRequests,
  listSavedRepos,
  listTrackedPullRequests,
  refreshTrackedPullRequests,
  removeTrackedPullRequest,
  replyToPullRequestReviewComment,
  saveRepo,
  searchRepos,
  saveLinearApiKey,
  trackPullRequest,
  updatePullRequestReviewComment,
  validateRepo,
} = githubNativeCommands;

export { createGithubNativeCommands };
export type { InvokeFn };
