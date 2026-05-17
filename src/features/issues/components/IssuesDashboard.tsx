import { IssueBucketSection, ISSUE_BUCKETS } from "./IssueBucketSection";
import { IssuesDashboardLoader } from "./IssuesDashboardLoader";
import { LinearIntegrationDialog } from "./LinearIntegrationDialog";
import { getErrorMessage } from "@/lib/get-error-message";
import type {
  IssueDashboardData,
  IssueLinkedPullRequest,
  LinearIntegrationStatus,
} from "@/types/issues";

type IssuesDashboardProps = {
  dashboard: IssueDashboardData | undefined;
  error: unknown;
  isLoading: boolean;
  onOpenLinkedPullRequest: (pullRequest: IssueLinkedPullRequest) => void;
};

const EMPTY_DASHBOARD: IssueDashboardData = {
  linearIntegration: {
    configured: false,
    connected: false,
    displayName: null,
    error: null,
  },
  buckets: {
    inProgress: [],
    assigned: [],
    subscribed: [],
    created: [],
  },
};

const EMPTY_LINEAR_STATUS: LinearIntegrationStatus = {
  configured: false,
  connected: false,
  displayName: null,
  error: null,
};

function getLinearStatus(dashboard: IssueDashboardData | undefined) {
  return dashboard?.linearIntegration ?? EMPTY_LINEAR_STATUS;
}

const EMPTY_BUCKETS = EMPTY_DASHBOARD.buckets;

function IssuesDashboard({
  dashboard,
  error,
  isLoading,
  onOpenLinkedPullRequest,
}: IssuesDashboardProps) {
  const issueBuckets = dashboard?.buckets ?? EMPTY_BUCKETS;
  const linearStatus = getLinearStatus(dashboard);

  return (
    <main className="flex h-full min-h-0 flex-col bg-canvas text-ink-900">
      <div className="shrink-0 gap-4 px-5 py-4">
        <h1 className="text-sm font-medium text-ink-700 mb-2">Issues</h1>
        <LinearIntegrationDialog status={linearStatus} />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-5">
        {error ? (
          <div className="py-4 text-sm text-danger-600">
            {getErrorMessage(error)}
          </div>
        ) : null}

        {!error && isLoading ? <IssuesDashboardLoader /> : null}

        {!error && !isLoading
          ? ISSUE_BUCKETS.map((bucket) => (
              <IssueBucketSection
                emptyMessage={bucket.emptyMessage}
                headerClassName={bucket.headerClassName}
                Icon={bucket.Icon}
                iconClassName={bucket.iconClassName}
                issues={issueBuckets[bucket.key]}
                key={bucket.key}
                onOpenLinkedPullRequest={onOpenLinkedPullRequest}
                title={bucket.title}
              />
            ))
          : null}
      </div>
    </main>
  );
}

export { IssuesDashboard };
export type { IssuesDashboardProps };
