import type { GitStatusEntry } from "@pierre/trees";

type RepoSummary = {
  name: string;
  nameWithOwner: string;
  description: string | null;
  isPrivate: boolean | null;
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

type ReviewSessionStatus =
  | "prepared"
  | "indexed"
  | "launched"
  | "stale"
  | "failed";

type ReviewChatRuntimeKind = "codex" | "open_code";

type ReviewSession = {
  id: string;
  repo: string;
  number: number;
  headSha: string;
  status: ReviewSessionStatus;
  workspacePath: string;
  reviewRuntime: ReviewChatRuntimeKind;
  runtimeModelChoice: string | null;
  agentSessionId: string | null;
  agentContextHeadSha: string | null;
  createdAt: number;
  updatedAt: number;
  lastError: string | null;
};

type ReviewChatReadinessStatusKind =
  | "ready"
  | "missing_codex_cli"
  | "codex_not_authenticated"
  | "missing_codex_acp"
  | "missing_open_code_cli"
  | "acp_initialize_failed"
  | "acp_protocol_unsupported"
  | "acp_missing_required_capability"
  | "unknown_error";

type ReviewChatReadinessStatus = {
  status: ReviewChatReadinessStatusKind;
  message: string | null;
};

type ReviewChatAdapterInstallEvent = {
  phase: "checking" | "downloading" | "extracting" | "ready" | "error";
  downloadedBytes: number;
  totalBytes: number | null;
  version: string;
  message: string;
};

type ReviewWorkspaceActivityStatus = "running" | "success" | "error";

type ReviewWorkspaceEvent = {
  kind: "log";
  repo: string;
  number: number;
  headSha: string;
  status: ReviewWorkspaceActivityStatus;
  message: string;
  command: string | null;
};

type ReviewChatAcpPlanEntry = {
  content: string;
  priority: string;
  status: string;
};

type ReviewWalkthroughAction = "review" | "scan" | "skim";

type ReviewWalkthroughScope = "shared" | "local" | "routine";

type ReviewWalkthroughFile = {
  path: string;
  action: ReviewWalkthroughAction;
  scope: ReviewWalkthroughScope;
  reason: string;
  context: string;
};

type ReviewWalkthroughGroup = {
  title: string;
  reason: string;
  files: ReviewWalkthroughFile[];
};

type ReviewWalkthrough = {
  summary: {
    focus: string;
    skim: string;
  };
  groups: ReviewWalkthroughGroup[];
};

type ReviewWalkthroughEvent = {
  kind: "progress";
  sessionId: string;
  phase: "preparing" | "running" | "formatting";
  message: string;
};

type ReviewChatToolEvent = {
  kind: "tool";
  sessionId: string;
  turnId: string;
  toolCallId: string;
  title: string | null;
  status: string | null;
  rawInput: unknown | null;
  rawOutput: unknown | null;
};

type ReviewChatEvent =
  | {
      kind: "message";
      sessionId: string;
      turnId: string;
      text: string;
    }
  | {
      kind: "thought";
      sessionId: string;
      turnId: string;
      text: string;
    }
  | ReviewChatToolEvent
  | {
      kind: "plan";
      sessionId: string;
      turnId: string;
      entries: ReviewChatAcpPlanEntry[];
    }
  | {
      kind: "finished";
      sessionId: string;
      turnId: string;
      stopReason: string | null;
    }
  | {
      kind: "error";
      sessionId: string;
      turnId: string;
      message: string;
    };

type ReviewRevisionCheckpoint = {
  id: string;
  sessionId: string;
  headSha: string;
  previousHeadSha: string;
  messageCount: number;
  createdAt: number;
};

type ReviewChatTranscript = {
  messages: unknown[];
  activeReviewEffortMode: "fast" | "deep";
  pendingReviewEffortMode: "fast" | "deep" | null;
  revisionCheckpoints: ReviewRevisionCheckpoint[];
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
  PullRequestOverview,
  PullRequestSummary,
  ReplyToPullRequestReviewCommentInput,
  RepoDiscoveryResult,
  RepoSummary,
  ReviewChatAdapterInstallEvent,
  ReviewChatAcpPlanEntry,
  ReviewChatEvent,
  ReviewChatReadinessStatus,
  ReviewChatReadinessStatusKind,
  ReviewChatRuntimeKind,
  ReviewChatTranscript,
  ReviewChatToolEvent,
  ReviewWalkthrough,
  ReviewWalkthroughAction,
  ReviewWalkthroughFile,
  ReviewWalkthroughGroup,
  ReviewWalkthroughScope,
  ReviewWalkthroughEvent,
  ReviewRevisionCheckpoint,
  ReviewSession,
  ReviewSessionStatus,
  ReviewWorkspaceActivityStatus,
  ReviewWorkspaceEvent,
  ReviewCommentSide,
  SelectedPullRequestRef,
  SelectedPullRequestRevision,
  UpdatePullRequestReviewCommentInput,
  ViewerLogin,
};
export { PullRequestBadgeStatus };
export type {
  IssueBucketCounts,
  IssueBuckets,
  IssueDashboardData,
  IssueLinkedPullRequest,
  IssueProvider,
  IssueSummary,
  LinearIntegrationStatus,
} from "./issues";
