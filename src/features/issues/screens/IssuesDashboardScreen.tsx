import { useQuery } from "@tanstack/react-query";
import { IssuesDashboard } from "../components/IssuesDashboard";
import { useOpenLinkedPullRequest } from "../hooks/useOpenLinkedPullRequest";
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
