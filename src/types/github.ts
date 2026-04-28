import type { GitStatusEntry } from "@pierre/trees";

type RepoSummary = {
  name: string;
  nameWithOwner: string;
  description: string | null;
  isPrivate: boolean | null;
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
  PullRequestDiffBundle,
  PullRequestSummary,
  ReplyToPullRequestReviewCommentInput,
  RepoSummary,
  ReviewCommentSide,
  SelectedPullRequestRef,
  SelectedPullRequestRevision,
  UpdatePullRequestReviewCommentInput,
  ViewerLogin,
};
export { PullRequestBadgeStatus };
