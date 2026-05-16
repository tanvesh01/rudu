import { createFileRoute } from "@tanstack/react-router";
import { IssuesDashboardScreen } from "@/components/issues-dashboard";
import { openIssueBucketsQueryOptions } from "@/queries/github";

export const Route = createFileRoute("/issues")({
  component: IssuesDashboardScreen,
  loader: ({ context }) => {
    void context.queryClient
      .prefetchQuery(openIssueBucketsQueryOptions())
      .catch(() => undefined);
  },
});
