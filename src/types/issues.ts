type IssueProvider = "github" | "linear";

type IssueLinkedPullRequest = {
  number: number;
  title: string;
  repo: string;
  url: string;
};

type IssueSummary = {
  id: string;
  provider: IssueProvider;
  number: number | null;
  key: string | null;
  title: string;
  state: string;
  repo: string | null;
  teamName: string | null;
  authorLogin: string | null;
  authorAvatarUrl: string | null;
  assigneeName: string | null;
  commentCount: number;
  createdAt: string;
  updatedAt: string;
  url: string;
  linkedPullRequests: IssueLinkedPullRequest[];
};

type IssueBuckets = {
  inProgress: IssueSummary[];
  assigned: IssueSummary[];
  subscribed: IssueSummary[];
  created: IssueSummary[];
};

type IssueBucketCounts = {
  inProgress: number;
  assigned: number;
  subscribed: number;
  created: number;
  total: number;
};

type LinearIntegrationStatus = {
  configured: boolean;
  connected: boolean;
  displayName: string | null;
  error: string | null;
};

type IssueDashboardData = {
  buckets: IssueBuckets;
  linearIntegration: LinearIntegrationStatus;
};

export type {
  IssueBucketCounts,
  IssueBuckets,
  IssueDashboardData,
  IssueLinkedPullRequest,
  IssueProvider,
  IssueSummary,
  LinearIntegrationStatus,
};
