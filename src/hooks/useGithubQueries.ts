import { useQuery } from "@tanstack/react-query";
import {
  initialReposQueryOptions,
  savedReposQueryOptions,
  searchReposQueryOptions,
} from "../queries/github";
import { getErrorMessage } from "../lib/get-error-message";

function useSavedRepos() {
  const query = useQuery(savedReposQueryOptions());
  return {
    ...query,
    repos: query.data ?? [],
  };
}

function useRepoPickerRepos(debouncedQuery: string, enabled: boolean) {
  const trimmedQuery = debouncedQuery.trim();

  const {
    data: initialRepoDiscovery,
    error: initialError,
    isFetching: isInitialFetching,
    isPending: isInitialPending,
  } = useQuery({
    ...initialReposQueryOptions(),
    enabled: enabled && trimmedQuery.length === 0,
  });

  const {
    data: searchRepoDiscovery,
    error: searchError,
    isFetching: isSearchFetching,
    isPending: isSearchLoading,
  } = useQuery({
    ...searchReposQueryOptions(debouncedQuery),
    enabled: enabled && trimmedQuery.length > 0,
  });

  const activeDiscovery =
    trimmedQuery.length > 0 ? searchRepoDiscovery : initialRepoDiscovery;
  const availableRepos = activeDiscovery?.repos ?? [];
  const availableReposError = trimmedQuery.length > 0 ? searchError : initialError;
  const availableReposWarning = activeDiscovery?.warning ?? null;
  const isLoadingRepos =
    trimmedQuery.length > 0
      ? isSearchLoading || isSearchFetching
      : isInitialPending || isInitialFetching;

  return {
    availableRepos,
    availableReposError,
    availableReposWarning,
    isLoadingRepos,
  };
}

export {
  getErrorMessage,
  useRepoPickerRepos,
  useSavedRepos,
};
