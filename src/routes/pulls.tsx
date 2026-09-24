import { createFileRoute } from "@tanstack/react-router";
import { PullRequestListScreen } from "../components/app-shell/pull-request-list-screen";
import { validatePullRequestListRouteSearch } from "../lib/pull-request-list-route";

export const Route = createFileRoute("/pulls")({
  component: PullRequestListScreen,
  validateSearch: validatePullRequestListRouteSearch,
});
