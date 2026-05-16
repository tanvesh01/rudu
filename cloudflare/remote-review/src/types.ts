export type RemoteReviewSessionStatus =
  | "prepared"
  | "indexed"
  | "launched"
  | "stale"
  | "failed";

export type GitHubFileContext = {
  provider: "github";
  indexedAt: number;
  fileCount: number;
  expiresAt: number;
};

export type RemoteReviewSession = {
  id: string;
  repo: string;
  number: number;
  headSha: string;
  status: RemoteReviewSessionStatus;
  fileContext: GitHubFileContext | null;
  createdAt: number;
  updatedAt: number;
  lastError: string | null;
};

export type CachedDirectoryEntry = {
  name: string;
  path: string;
  kind: "dir" | "file";
  size: number | null;
};

export type CachedFileEntry = {
  path: string;
  sha: string;
  size: number;
};

export type PrepareSessionInput = {
  repo?: unknown;
  number?: unknown;
  headSha?: unknown;
  githubToken?: unknown;
};

export type ValidatedPrepareSessionInput = {
  repo: string;
  number: number;
  headSha: string;
  githubToken: string;
};

export type StatusUpdateInput = {
  status?: unknown;
  lastError?: unknown;
};

export type ValidatedStatusUpdateInput = {
  status: RemoteReviewSessionStatus;
  lastError: string | null;
};

export type WorkerAuthMode = "env" | "paired" | "unpaired";

export type WorkerSetupStatus = {
  ok: true;
  service: "rudu-remote-review";
  claimed: boolean;
  authMode: WorkerAuthMode;
};

export type WorkerPairingConfig = {
  tokenHash: string;
  claimedAt: number;
};

export type ClaimWorkerInput = {
  apiToken?: unknown;
};

export type VerifyWorkerInput = {
  apiToken?: unknown;
};

export type SessionObjectEnv = Record<string, never>;
export type ConfigObjectEnv = Record<string, never>;

export type RuntimeEnv = {
  REMOTE_REVIEW_CONFIG: DurableObjectNamespace;
  REMOTE_REVIEW_SESSIONS: DurableObjectNamespace;
  RUDU_REMOTE_REVIEW_API_TOKEN?: string;
};

export type GitHubCommitResponse = {
  commit?: {
    tree?: {
      sha?: string;
    };
  };
};

export type GitHubTreeResponse = {
  truncated?: boolean;
  tree?: Array<{
    path?: string;
    type?: string;
    sha?: string;
    size?: number;
  }>;
};

export type GitHubBlobResponse = {
  content?: string;
  encoding?: string;
  size?: number;
};
