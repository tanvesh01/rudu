import { useEffect, useState } from "react";
import {
  type Query,
  type QueryKey,
  useIsFetching,
  useQueryClient,
} from "@tanstack/react-query";
import { isGithubRefreshMeta } from "../queries/github";
import type { GithubRefreshMeta } from "../queries/github";

type GithubRefreshStatus = GithubRefreshMeta & {
  queryHash: string;
  queryKey: QueryKey;
  updatedAt: number;
};

function isActiveGithubRefresh(query: Query) {
  return query.state.fetchStatus === "fetching" && isGithubRefreshMeta(query.meta);
}

function getActiveGithubRefreshes(queryClient: ReturnType<typeof useQueryClient>) {
  return queryClient
    .getQueryCache()
    .findAll({ predicate: isActiveGithubRefresh })
    .map((query) => {
      const meta = query.meta as GithubRefreshMeta;
      return {
        ...meta,
        queryHash: query.queryHash,
        queryKey: query.queryKey,
        updatedAt: Math.max(query.state.dataUpdatedAt, query.state.errorUpdatedAt),
      } satisfies GithubRefreshStatus;
    });
}

export function useGithubRefreshStatus() {
  const queryClient = useQueryClient();
  const refreshCount = useIsFetching({
    predicate: (query) => isGithubRefreshMeta(query.meta),
  });
  const [activeRefreshes, setActiveRefreshes] = useState(() =>
    getActiveGithubRefreshes(queryClient),
  );

  useEffect(() => {
    setActiveRefreshes(getActiveGithubRefreshes(queryClient));

    return queryClient.getQueryCache().subscribe(() => {
      setActiveRefreshes(getActiveGithubRefreshes(queryClient));
    });
  }, [queryClient]);

  return {
    activeRefreshes,
    isRefreshing: refreshCount > 0,
    refreshCount,
  };
}

export type { GithubRefreshStatus };
