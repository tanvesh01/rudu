import { createFileRoute } from "@tanstack/react-router";
import { PullRequestWorkspace } from "../components/pull-request-workspace/pull-request-workspace";

export const Route = createFileRoute("/")({
  component: IndexRoute,
});

function IndexRoute() {
  return <PullRequestWorkspace selectedPr={null} />;
}
