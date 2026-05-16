import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getErrorMessage } from "./useGithubQueries";
import { canPrepareRemoteReviewSession } from "../lib/remote-review";
import {
  remoteReviewKeys,
  remoteReviewSessionQueryOptions,
  remoteReviewWorkerConfigQueryOptions,
} from "../queries/remote-review";
import {
  clearRemoteReviewWorkerConfig,
  pairRemoteReviewWorkerConfig,
  saveRemoteReviewWorkerConfig,
  testRemoteReviewWorkerConfig,
} from "../queries/remote-review-native";
import type {
  RemoteReviewSession,
  RemoteReviewWorkerConfigInput,
  RemoteReviewWorkerConfigPairInput,
  RemoteReviewWorkerConfigStatus,
  RemoteReviewWorkerConfigTestInput,
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
  const workerConfigQuery = useQuery(remoteReviewWorkerConfigQueryOptions());
  const workerConfig =
    (workerConfigQuery.data as RemoteReviewWorkerConfigStatus | undefined) ??
    null;
  const isWorkerConfigured = canPrepareRemoteReviewSession(workerConfig);
  const sessionQuery = useQuery({
    ...remoteReviewSessionQueryOptions(
      selectedRevision ?? IDLE_PULL_REQUEST_REVISION,
    ),
    enabled: selectedRevision !== null && isWorkerConfigured,
  });
  const session = (sessionQuery.data as RemoteReviewSession | undefined) ?? null;

  const saveWorkerConfigMutation = useMutation({
    mutationFn: async (input: RemoteReviewWorkerConfigInput) => {
      await saveRemoteReviewWorkerConfig(input);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: remoteReviewWorkerConfigQueryOptions().queryKey,
      });
      await queryClient.invalidateQueries({
        queryKey: remoteReviewSessionQueryOptions(
          selectedRevision ?? IDLE_PULL_REQUEST_REVISION,
        ).queryKey,
      });
    },
  });

  const testWorkerConfigMutation = useMutation({
    mutationFn: testRemoteReviewWorkerConfig,
  });

  const pairWorkerConfigMutation = useMutation({
    mutationFn: async (input: RemoteReviewWorkerConfigPairInput) => {
      await pairRemoteReviewWorkerConfig(input);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: remoteReviewWorkerConfigQueryOptions().queryKey,
      });
      await queryClient.invalidateQueries({
        queryKey: remoteReviewSessionQueryOptions(
          selectedRevision ?? IDLE_PULL_REQUEST_REVISION,
        ).queryKey,
      });
    },
  });

  const clearWorkerConfigMutation = useMutation({
    mutationFn: clearRemoteReviewWorkerConfig,
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: remoteReviewWorkerConfigQueryOptions().queryKey,
      });
      await queryClient.invalidateQueries({ queryKey: remoteReviewKeys.all });
    },
  });

  return {
    data: {
      session,
      workerConfig,
    },
    status: {
      error:
        getErrorMessage(sessionQuery.error) ||
        getErrorMessage(testWorkerConfigMutation.error) ||
        getErrorMessage(saveWorkerConfigMutation.error) ||
        getErrorMessage(pairWorkerConfigMutation.error) ||
        getErrorMessage(clearWorkerConfigMutation.error),
      isClearingWorkerConfig: clearWorkerConfigMutation.isPending,
      isLoadingWorkerConfig: workerConfigQuery.isPending,
      isLoadingSession:
        selectedRevision !== null &&
        isWorkerConfigured &&
        (sessionQuery.isPending ||
          (sessionQuery.isFetching && !sessionQuery.data)),
      isPairingWorkerConfig: pairWorkerConfigMutation.isPending,
      isSavingWorkerConfig: saveWorkerConfigMutation.isPending,
      isTestingWorkerConfig: testWorkerConfigMutation.isPending,
      workerConfigError:
        getErrorMessage(workerConfigQuery.error) ||
        getErrorMessage(testWorkerConfigMutation.error) ||
        getErrorMessage(saveWorkerConfigMutation.error) ||
        getErrorMessage(pairWorkerConfigMutation.error) ||
        getErrorMessage(clearWorkerConfigMutation.error),
    },
    actions: {
      clearWorkerConfig: clearWorkerConfigMutation.mutateAsync,
      pairWorkerConfig: pairWorkerConfigMutation.mutateAsync,
      saveWorkerConfig: saveWorkerConfigMutation.mutateAsync,
      testWorkerConfig: (input: RemoteReviewWorkerConfigTestInput = {}) =>
        testWorkerConfigMutation.mutateAsync(input),
    },
  };
}

export { useRemoteReviewSession };
export type UseRemoteReviewSessionResult = ReturnType<typeof useRemoteReviewSession>;
