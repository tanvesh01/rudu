import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getErrorMessage } from "./useGithubQueries";
import { remoteReviewSessionQueryOptions } from "../queries/remote-review";
import { refreshReviewSession } from "../queries/remote-review-native";
import type {
  RemoteReviewSession,
  SelectedPullRequestRevision,
} from "../types/github";

const IDLE_PULL_REQUEST_REVISION: SelectedPullRequestRevision = {
  repo: "__idle__",
  number: 0,
  headSha: "__idle__",
};

function useRemoteReviewSession(
  selectedRevision: SelectedPullRequestRevision | null,
) {
  const queryClient = useQueryClient();
  const sessionQuery = useQuery({
    ...remoteReviewSessionQueryOptions(
      selectedRevision ?? IDLE_PULL_REQUEST_REVISION,
    ),
    enabled: selectedRevision !== null,
  });
  const session = (sessionQuery.data as RemoteReviewSession | undefined) ?? null;

  return {
    data: {
      session,
    },
    status: {
      error: getErrorMessage(sessionQuery.error),
      isLoadingSession:
        selectedRevision !== null &&
        (sessionQuery.isPending ||
          (sessionQuery.isFetching && !sessionQuery.data)),
    },
    actions: {
      refreshRevisionContext: async (headSha: string) => {
        if (!session) {
          throw new Error("Prepare the review session before refreshing the PR.");
        }

        const refreshedSession = await refreshReviewSession(session.id, headSha);
        if (selectedRevision) {
          queryClient.setQueryData(
            remoteReviewSessionQueryOptions(selectedRevision).queryKey,
            refreshedSession,
          );
        }
        queryClient.setQueryData(
          remoteReviewSessionQueryOptions({
            repo: refreshedSession.repo,
            number: refreshedSession.number,
            headSha: refreshedSession.headSha,
          }).queryKey,
          refreshedSession,
        );
        return refreshedSession;
      },
    },
  };
}

export { useRemoteReviewSession };
export type UseRemoteReviewSessionResult = ReturnType<typeof useRemoteReviewSession>;
