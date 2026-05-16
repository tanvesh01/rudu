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

type RemoteReviewSessionStatus =
  | "prepared"
  | "indexed"
  | "launched"
  | "stale"
  | "failed";

type GitHubFileContext = {
  provider: "github";
  indexedAt: number;
  fileCount: number;
  expiresAt: number;
};

type RemoteReviewSession = {
  id: string;
  repo: string;
  number: number;
  headSha: string;
  status: RemoteReviewSessionStatus;
  fileContext: GitHubFileContext | null;
  reportPath: string;
  createdAt: number;
  updatedAt: number;
  lastError: string | null;
};

type RemoteReviewReport = {
  sessionId: string;
  path: string;
  body: string;
  updatedAt: number;
};

type RemoteReviewWorkerConfigSource = "env" | "stored" | "missing";

type RemoteReviewWorkerConfigStatus = {
  configured: boolean;
  workerUrl: string | null;
  hasApiToken: boolean;
  source: RemoteReviewWorkerConfigSource;
};

type RemoteReviewWorkerConfigInput = {
  workerUrl: string;
  apiToken: string;
};

type RemoteReviewWorkerConfigPairInput = {
  workerUrl: string;
};

type RemoteReviewWorkerConfigTestInput = {
  workerUrl?: string;
  apiToken?: string;
};

type RemoteReviewAgentToolEvent = {
  kind: "tool";
  sessionId: string;
  toolCallId: string | null;
  title: string | null;
  status: string | null;
};

type RemoteReviewAgentEvent =
  | {
      kind: "message";
      sessionId: string;
      text: string;
    }
  | {
      kind: "thought";
      sessionId: string;
      text: string;
    }
  | RemoteReviewAgentToolEvent
  | {
      kind: "finished";
      sessionId: string;
      stopReason: string | null;
    }
  | {
      kind: "error";
      sessionId: string;
      message: string;
    };

type RemoteReviewAcpPlanEntry = {
  content: string;
  priority: string;
  status: string;
};

type RemoteReviewChatToolEvent = {
  kind: "tool";
  sessionId: string;
  turnId: string;
  toolCallId: string;
  title: string | null;
  status: string | null;
  rawInput: unknown | null;
  rawOutput: unknown | null;
};

type RemoteReviewChatEvent =
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
  | RemoteReviewChatToolEvent
  | {
      kind: "plan";
      sessionId: string;
      turnId: string;
      entries: RemoteReviewAcpPlanEntry[];
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
  GitHubFileContext,
  PrPatch,
  PullRequestCheck,
  PullRequestChecks,
  PullRequestCheckStatus,
  PullRequestDiffBundle,
  PullRequestOverview,
  PullRequestSummary,
  ReplyToPullRequestReviewCommentInput,
  RepoSummary,
  RemoteReviewReport,
  RemoteReviewWorkerConfigInput,
  RemoteReviewWorkerConfigPairInput,
  RemoteReviewWorkerConfigStatus,
  RemoteReviewWorkerConfigSource,
  RemoteReviewWorkerConfigTestInput,
  RemoteReviewAgentEvent,
  RemoteReviewAgentToolEvent,
  RemoteReviewAcpPlanEntry,
  RemoteReviewChatEvent,
  RemoteReviewChatToolEvent,
  RemoteReviewSession,
  RemoteReviewSessionStatus,
  ReviewCommentSide,
  SelectedPullRequestRef,
  SelectedPullRequestRevision,
  UpdatePullRequestReviewCommentInput,
  ViewerLogin,
};
export { PullRequestBadgeStatus };
