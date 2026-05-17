import { createFileRoute } from "@tanstack/react-router";
import { IssuesDashboardScreen } from "@/features/issues";
import { issueDashboardQueryOptions } from "@/queries/github";

export const Route = createFileRoute("/issues")({
  component: IssuesDashboardScreen,
  loader: ({ context }) => {
    void context.queryClient
      .prefetchQuery(issueDashboardQueryOptions())
      .catch(() => undefined);
  },
});
