import { useQuery } from "@tanstack/react-query";
import { IssuesDashboard } from "./issues-dashboard";
import { openIssueBucketsQueryOptions } from "@/queries/github";

function IssuesDashboardScreen() {
  const openIssueBucketsQuery = useQuery(openIssueBucketsQueryOptions());

  return (
    <IssuesDashboard
      buckets={openIssueBucketsQuery.data}
      error={openIssueBucketsQuery.error}
      isLoading={openIssueBucketsQuery.isPending}
    />
  );
}

export { IssuesDashboardScreen };
