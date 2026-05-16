import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo, useRef, useState } from "react";
import { getErrorMessage } from "./useGithubQueries";
import { remoteReviewSessionQueryOptions } from "../queries/remote-review";
import { refreshReviewSession } from "../queries/remote-review-native";
import type {
  RemoteReviewSession,
  RemoteReviewWorkspaceEvent,
  SelectedPullRequestRevision,
} from "../types/github";

const IDLE_PULL_REQUEST_REVISION: SelectedPullRequestRevision = {
  repo: "__idle__",
  number: 0,
  headSha: "__idle__",
};

type ReviewWorkspaceActivityEntry = RemoteReviewWorkspaceEvent & {
  id: string;
  createdAt: number;
};

type ReviewWorkspaceActivityState = {
  key: string;
  entries: ReviewWorkspaceActivityEntry[];
};

function useRemoteReviewSession(
  selectedRevision: SelectedPullRequestRevision | null,
) {
  const queryClient = useQueryClient();
  const [workspaceActivity, setWorkspaceActivity] =
    useState<ReviewWorkspaceActivityState>({
      key: "__idle__",
      entries: [],
    });
  const activitySequence = useRef(0);
  const selectedWorkspaceKey = useMemo(
    () =>
      selectedRevision
        ? `${selectedRevision.repo}#${selectedRevision.number}`
        : "__idle__",
    [selectedRevision],
  );
  const recordWorkspaceActivity = useCallback(
    (event: RemoteReviewWorkspaceEvent) => {
      if (
        !selectedRevision ||
        event.repo !== selectedRevision.repo ||
        event.number !== selectedRevision.number
      ) {
        return;
      }

      activitySequence.current += 1;
      const activityKey = `${event.repo}#${event.number}`;
      setWorkspaceActivity((current) => {
        const currentEntries =
          current.key === activityKey ? current.entries : [];
        return {
          key: activityKey,
          entries: [
            ...currentEntries,
            {
              ...event,
              id: `${event.repo}#${event.number}-${activitySequence.current}`,
              createdAt: Date.now(),
            },
          ].slice(-16),
        };
      });
    },
    [selectedRevision],
  );
  const sessionQuery = useQuery({
    ...remoteReviewSessionQueryOptions(
      selectedRevision ?? IDLE_PULL_REQUEST_REVISION,
      {
        onWorkspaceEvent: recordWorkspaceActivity,
      },
    ),
    enabled: selectedRevision !== null,
  });
  const session =
    (sessionQuery.data as RemoteReviewSession | undefined) ?? null;

  const selectedWorkspaceActivity =
    workspaceActivity.key === selectedWorkspaceKey
      ? workspaceActivity.entries
      : [];

  return {
    data: {
      session,
      workspaceActivity: selectedWorkspaceActivity,
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
          throw new Error(
            "Prepare the review session before refreshing the PR.",
          );
        }

        const refreshedSession = await refreshReviewSession(
          session.id,
          headSha,
          recordWorkspaceActivity,
        );
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
export type UseRemoteReviewSessionResult = ReturnType<
  typeof useRemoteReviewSession
>;
