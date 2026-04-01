export type PRState = "OPEN" | "CLOSED" | "MERGED";

export interface PRCheck {
  name: string;
  status: "queued" | "in_progress" | "completed";
  conclusion: "success" | "failure" | "neutral" | "cancelled" | "skipped" | null;
}

export interface PRStatus {
  exists: boolean;
  number?: number;
  state?: PRState;
  title?: string;
  mergeable?: boolean;
  hasConflicts?: boolean;
  checks?: PRCheck[];
  baseBranch?: string;
  headBranch?: string;
}

export type GitHubCapability =
  | "gh_available"
  | "gh_missing"
  | "not_authenticated"
  | "not_a_repo"
  | "no_remote"
  | "detached_head";

export interface GitHubCapabilities {
  ghInstalled: boolean;
  ghAuthenticated: boolean;
  isRepo: boolean;
  hasRemote: boolean;
  currentBranch: string | null;
  defaultBranch: string | null;
  repoOwner: string | null;
  repoName: string | null;
}

export type GitHubErrorCode =
  | "GH_MISSING"
  | "AUTH_FAILED"
  | "NOT_REPO"
  | "NO_REMOTE"
  | "DETACHED_HEAD"
  | "NETWORK_ERROR"
  | "PR_NOT_FOUND"
  | "BRANCH_NOT_FOUND"
  | "COMMAND_FAILED";

export interface GitHubError {
  code: GitHubErrorCode;
  message: string;
  recoverable: boolean;
}

export interface CommitPushResult {
  type: "success" | "failure";
  commitHash?: string;
  error?: string;
}

export interface CreatePRResult {
  type: "success" | "failure";
  prNumber?: number;
  prUrl?: string;
  error?: string;
}