import { invoke } from "@tauri-apps/api/core";
import type { ReviewThread } from "../lib/review-threads";
import type {
  CreatePullRequestReviewCommentInput,
  GhCliStatus,
  PrPatch,
  PullRequestChecks,
  PullRequestDiffBundle,
  PullRequestInbox,
  PullRequestOverview,
  PullRequestSummary,
  RepoDiscoveryResult,
  ReplyToPullRequestReviewCommentInput,
  RepoSummary,
  SelectedPullRequestRef,
  SelectedPullRequestRevision,
  UpdatePullRequestReviewCommentInput,
  ViewerLogin,
} from "../types/github";
type InvokeFn = <T>(command: string, args?: Record<string, unknown>) => Promise<T>;

function createGithubNativeCommands(invokeCommand: InvokeFn) {
  return {
    listSavedRepos() {
      return invokeCommand<RepoSummary[]>("list_saved_repos");
    },
    getPullRequestInbox() {
      return invokeCommand<PullRequestInbox>("get_pull_request_inbox");
    },
    getGhCliStatus() {
      return invokeCommand<GhCliStatus>("get_gh_cli_status");
    },
    async getViewerLogin(): Promise<ViewerLogin> {
      const login = await invokeCommand<string>("get_viewer_login");
      return { login };
    },
    listInitialRepos(limit: number) {
      return invokeCommand<RepoDiscoveryResult>("list_initial_repos", { limit });
    },
    searchRepos(query: string, limit: number) {
      return invokeCommand<RepoDiscoveryResult>("search_repos", { query, limit });
    },
    listPullRequests(repo: string) {
      return invokeCommand<PullRequestSummary[]>("list_pull_requests", { repo });
    },
    listTrackedPullRequests(repo: string) {
      return invokeCommand<PullRequestSummary[]>("list_tracked_pull_requests", {
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
  createPullRequestReviewComment,
  getGhCliStatus,
  getPullRequestChecks,
  getPullRequestDiffBundle,
  getPullRequestInbox,
  getPullRequestOverview,
  getPullRequestPatch,
  getPullRequestReviewThreads,
  getPullRequestSummary,
  getViewerLogin,
  listInitialRepos,
  listPullRequestChangedFiles,
  listPullRequests,
  listSavedRepos,
  listTrackedPullRequests,
  replyToPullRequestReviewComment,
  saveRepo,
  searchRepos,
  trackPullRequest,
  updatePullRequestReviewComment,
  validateRepo,
} = githubNativeCommands;

export { createGithubNativeCommands };
export type { InvokeFn };
