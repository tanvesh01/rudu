import type { GitStatusEntry } from "@pierre/trees";

type RepoSummary = {
  name: string;
  nameWithOwner: string;
  description: string | null;
  isPrivate: boolean | null;
  languages: RepoLanguage[];
  stargazerCount: number | null;
  forkCount: number | null;
  issueCount: number | null;
  pullRequestCount: number | null;
  contributorCount: number | null;
};

type RepoLanguage = {
  name: string;
  size: number | null;
};

type RepoDiscoveryResult = {
  repos: RepoSummary[];
  warning: string | null;
};

type PullRequestSummary = {
  number: number;
  title: string;
  state: string;
  isDraft: boolean;
  mergeStateStatus: string;
  mergeable: string;
  additions: number;
  deletions: number;
  authorLogin: string;
  updatedAt: string;
  url: string;
  headSha: string;
  baseSha: string | null;
};

type PullRequestInboxItem = PullRequestSummary & {
  repo: string;
  reviewDecision: string | null;
  reviewRequested: boolean;
};

type PullRequestInbox = {
  viewerLogin: string;
  pullRequests: PullRequestInboxItem[];
};

enum PullRequestBadgeStatus {
  Merged = "merged",
  Closed = "closed",
  Draft = "draft",
  Conflicting = "conflicting",
  CanMerge = "can_merge",
  Open = "open",
}

type SelectedPullRequestRef = {
  repo: string;
  number: number;
};

type SelectedPullRequestRevision = {
  repo: string;
  number: number;
  headSha: string;
};

type PrPatch = {
  repo: string;
  number: number;
  headSha: string;
  patch: string;
};

type PullRequestDiffBundle = {
  repo: string;
  number: number;
  headSha: string;
  patch: string;
  changedFiles: string[];
};

type PullRequestOverview = {
  repo: string;
  number: number;
  title: string;
  body: string;
  state: string;
  isDraft: boolean;
  url: string;
  updatedAt: string;
  authorLogin: string;
  authorAvatarUrl: string | null;
};

type PullRequestCheckStatus =
  | "pass"
  | "fail"
  | "pending"
  | "skipped"
  | "cancelled"
  | "neutral"
  | "unknown";

type PullRequestCheck = {
  order: number;
  title: string;
  status: PullRequestCheckStatus;
  logoUrl: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string | null;
  isTerminal: boolean;
};

type PullRequestChecks = {
  repo: string;
  number: number;
  status: PullRequestCheckStatus;
  checks: PullRequestCheck[];
};

type ViewerLogin = {
  login: string;
};

type GhCliStatusKind =
  | "ready"
  | "missing_cli"
  | "not_authenticated"
  | "unknown_error";

type GhCliStatus = {
  status: GhCliStatusKind;
  message: string | null;
};

type ReviewCommentSide = "LEFT" | "RIGHT";

type CreatePullRequestReviewCommentInput = {
  repo: string;
  number: number;
  body: string;
  path: string;
  line: number | null;
  side: ReviewCommentSide | null;
  startLine: number | null;
  startSide: ReviewCommentSide | null;
  subjectType: "file" | "line";
};

type ReplyToPullRequestReviewCommentInput = {
  threadId: string;
  body: string;
};

type UpdatePullRequestReviewCommentInput = {
  commentId: string;
  body: string;
};

type FileStatsEntry = {
  additions: number;
  deletions: number;
  status: GitStatusEntry["status"];
};

export type {
  CreatePullRequestReviewCommentInput,
  FileStatsEntry,
  GhCliStatus,
  GhCliStatusKind,
  PrPatch,
  PullRequestCheck,
  PullRequestChecks,
  PullRequestCheckStatus,
  PullRequestDiffBundle,
  PullRequestInbox,
  PullRequestInboxItem,
  PullRequestOverview,
  PullRequestSummary,
  ReplyToPullRequestReviewCommentInput,
  RepoDiscoveryResult,
  RepoLanguage,
  RepoSummary,
  ReviewCommentSide,
  SelectedPullRequestRef,
  SelectedPullRequestRevision,
  UpdatePullRequestReviewCommentInput,
  ViewerLogin,
};
export { PullRequestBadgeStatus };
