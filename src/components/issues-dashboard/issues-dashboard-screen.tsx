import { useQuery } from "@tanstack/react-query";
import { IssuesDashboard } from "./issues-dashboard";
import { useOpenLinkedPullRequest } from "./use-open-linked-pull-request";
import { issueDashboardQueryOptions } from "@/queries/github";

function IssuesDashboardScreen() {
  const issueDashboardQuery = useQuery(issueDashboardQueryOptions());
  const openLinkedPullRequest = useOpenLinkedPullRequest();

  return (
    <IssuesDashboard
      dashboard={issueDashboardQuery.data}
      error={issueDashboardQuery.error}
      isLoading={issueDashboardQuery.isPending}
      onOpenLinkedPullRequest={openLinkedPullRequest}
    />
  );
}

export { IssuesDashboardScreen };
