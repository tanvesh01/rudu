import { useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AppSectionNavigation } from "./app-section-navigation";
import { useAppShellContext } from "./app-shell-context";
import { getErrorMessage } from "../../hooks/useGithubQueries";
import {
  getPullRequestRouteParams,
  PULL_REQUEST_ROUTE,
} from "../../lib/pull-request-route";
import type { PullRequestSummary } from "../../types/github";
import { githubKeys, pullRequestInboxQueryOptions } from "../../queries/github";
import { trackPullRequest } from "../../queries/github-native";
import { AppResizablePanes } from "../ui/app-resizable-panes";
import { PullRequestInbox } from "../ui/pull-request-inbox";
import { RepoSidebar } from "../ui/repo-sidebar";

function PullRequestListScreen() {
  const { isLeftSidebarOpen } = useAppShellContext();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const inboxQuery = useQuery(pullRequestInboxQueryOptions());

  async function selectPullRequest(repo: string, pullRequest: PullRequestSummary) {
    await trackPullRequest(repo, pullRequest);
    queryClient.setQueryData<PullRequestSummary[]>(
      githubKeys.trackedPullRequestList(repo),
      (current = []) => [
        pullRequest,
        ...current.filter((item) => item.number !== pullRequest.number),
      ],
    );
    const params = getPullRequestRouteParams(repo, pullRequest.number);
    if (!params) return;
    void navigate({ params, to: PULL_REQUEST_ROUTE });
  }

  return (
    <main className="h-full min-h-0 min-w-0 bg-surface">
      <AppResizablePanes
        center={
          <RepoSidebar>
            {inboxQuery.isPending ? (
              <p className="px-4 py-3 text-sm text-ink-500">Loading pull requests…</p>
            ) : inboxQuery.error ? (
              <p className="px-4 py-3 text-sm text-danger-600">
                {getErrorMessage(inboxQuery.error)}
              </p>
            ) : inboxQuery.data.pullRequests.length === 0 ? (
              <p className="px-4 py-3 text-sm text-ink-500">
                No open pull requests related to you.
              </p>
            ) : (
              <PullRequestInbox
                pullRequests={inboxQuery.data.pullRequests}
                viewerLogin={inboxQuery.data.viewerLogin}
                onSelectPr={(repo, pullRequest) =>
                  void selectPullRequest(repo, pullRequest)
                }
              />
            )}
          </RepoSidebar>
        }
        left={<AppSectionNavigation />}
        leftOpen={isLeftSidebarOpen}
      />
    </main>
  );
}

export { PullRequestListScreen };
