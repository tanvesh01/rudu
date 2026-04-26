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

type SelectedPullRequest = {
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

type LlmProviderInfo = {
  id: string;
  name: string;
  adapter: string;
  defaultModel: string;
  defaultBaseUrl: string | null;
  baseUrlRequired: boolean;
};

type LlmSettings = {
  provider: string;
  model: string;
  baseUrl: string | null;
  hasApiKey: boolean;
};

type SaveLlmSettingsInput = {
  provider: string;
  model: string;
  baseUrl: string | null;
};

type ChapterKeyChange = {
  title: string;
  detail: string;
};

type ChapterReviewFocus = {
  title: string;
  detail: string;
  path: string | null;
  severity: string | null;
};

type ChapterPrologue = {
  summary: string;
  keyChanges: ChapterKeyChange[];
  reviewFocus: ChapterReviewFocus[];
};

type PullRequestChapterFile = {
  path: string;
  reason: string;
  additions: number;
  deletions: number;
};

type ChapterReviewStep = {
  title: string;
  detail: string;
  files: string[];
};

type PullRequestChapter = {
  id: string;
  title: string;
  summary: string;
  files: PullRequestChapterFile[];
  reviewSteps: ChapterReviewStep[];
  risks: ChapterReviewFocus[];
  additions: number;
  deletions: number;
};

type PullRequestChapters = {
  repo: string;
  number: number;
  headSha: string;
  provider: string;
  model: string;
  promptVersion: string;
  generatedAt: number;
  prologue: ChapterPrologue;
  chapters: PullRequestChapter[];
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
  ChapterKeyChange,
  ChapterPrologue,
  ChapterReviewFocus,
  ChapterReviewStep,
  CreatePullRequestReviewCommentInput,
  FileStatsEntry,
  GhCliStatus,
  GhCliStatusKind,
  LlmProviderInfo,
  LlmSettings,
  PrPatch,
  PullRequestChapter,
  PullRequestChapterFile,
  PullRequestChapters,
  PullRequestSummary,
  ReplyToPullRequestReviewCommentInput,
  RepoSummary,
  ReviewCommentSide,
  SaveLlmSettingsInput,
  SelectedPullRequest,
  UpdatePullRequestReviewCommentInput,
  ViewerLogin,
};
export { PullRequestBadgeStatus };
