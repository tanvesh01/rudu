import { IssueBucketSection, ISSUE_BUCKETS } from "./issue-bucket-section";
import { IssuesDashboardLoader } from "./issues-dashboard-loader";
import type { IssueBuckets } from "@/types/github";

type IssuesDashboardProps = {
  buckets: IssueBuckets | undefined;
  error: unknown;
  isLoading: boolean;
};

const EMPTY_BUCKETS: IssueBuckets = {
  inProgress: [],
  assigned: [],
  mentioned: [],
  authored: [],
};

function getErrorMessage(error: unknown) {
  if (!error) return "";
  if (error instanceof Error) return error.message;
  return String(error);
}

function IssuesDashboard({ buckets, error, isLoading }: IssuesDashboardProps) {
  const issueBuckets = buckets ?? EMPTY_BUCKETS;

  return (
    <main className="flex h-full min-h-0 flex-col bg-canvas text-ink-900">
      <div className="shrink-0 px-5 py-4">
        <h1 className="text-base font-semibold text-ink-900">Issues</h1>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {error ? (
          <div className="px-5 py-4 text-sm text-danger-600">
            {getErrorMessage(error)}
          </div>
        ) : null}

        {!error && isLoading ? <IssuesDashboardLoader /> : null}

        {!error && !isLoading
          ? ISSUE_BUCKETS.map((bucket) => (
              <IssueBucketSection
                emptyMessage={bucket.emptyMessage}
                Icon={bucket.Icon}
                issues={issueBuckets[bucket.key]}
                key={bucket.key}
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
