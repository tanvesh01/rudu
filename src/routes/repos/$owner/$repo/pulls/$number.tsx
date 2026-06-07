import { useMemo } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { PullRequestWorkspace } from "@/components/pull-request-workspace/pull-request-workspace";
import {
  getPullRequestPanelSearch,
  getSelectedPullRequestFromRouteParams,
  parsePullRequestPanel,
  validatePullRequestRouteSearch,
  type PullRequestPanel,
} from "@/lib/pull-request-route";
import { trackedPullRequestListQueryOptions } from "@/queries/github";

export const Route = createFileRoute("/repos/$owner/$repo/pulls/$number")({
  component: PullRequestRoute,
  validateSearch: validatePullRequestRouteSearch,
  loader: async ({ context, params }) => {
    const selectedPr = getSelectedPullRequestFromRouteParams(params);
    if (!selectedPr) return;

    try {
      await context.queryClient.ensureQueryData(
        trackedPullRequestListQueryOptions(selectedPr.repo),
      );
    } catch {
      // The workspace query keeps the route usable and renders existing errors.
    }
  },
});

function PullRequestRoute() {
  const navigate = Route.useNavigate();
  const params = Route.useParams();
  const search = Route.useSearch();
  const selectedPr = useMemo(
    () => getSelectedPullRequestFromRouteParams(params),
    [params.owner, params.repo, params.number],
  );
  const rightSidebarTab = parsePullRequestPanel(search.panel);

  function handleRightSidebarTabChange(panel: PullRequestPanel) {
    void navigate({
      search: getPullRequestPanelSearch(panel),
    });
  }

  return (
    <PullRequestWorkspace
      selectedPr={selectedPr}
      rightSidebarTab={rightSidebarTab}
      onRightSidebarTabChange={handleRightSidebarTabChange}
    />
  );
}
