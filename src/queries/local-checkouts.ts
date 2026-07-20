import { queryOptions } from "@tanstack/react-query";
import {
  getLocalCheckoutPatch,
  getLocalCheckoutStatus,
  listLocalCheckouts,
} from "./local-checkouts-native";

const LOCAL_DIFF_REFRESH_INTERVAL_MS = 1_000;

const localCheckoutKeys = {
  all: ["local-checkouts"] as const,
  list: () => [...localCheckoutKeys.all, "list"] as const,
  status: (id: string) => [...localCheckoutKeys.all, "status", id] as const,
  patchRoot: (id: string) => [...localCheckoutKeys.all, "patch", id] as const,
  patch: (id: string, revision: string) =>
    [...localCheckoutKeys.patchRoot(id), revision] as const,
};

function localCheckoutListQueryOptions() {
  return queryOptions({
    queryKey: localCheckoutKeys.list(),
    queryFn: listLocalCheckouts,
    refetchInterval: LOCAL_DIFF_REFRESH_INTERVAL_MS,
    refetchIntervalInBackground: true,
  });
}

function localCheckoutStatusQueryOptions(id: string) {
  return queryOptions({
    queryKey: localCheckoutKeys.status(id),
    queryFn: () => getLocalCheckoutStatus(id),
    enabled: Boolean(id),
    refetchInterval: LOCAL_DIFF_REFRESH_INTERVAL_MS,
    refetchIntervalInBackground: true,
  });
}

function localCheckoutPatchQueryOptions(id: string, revision: string) {
  return queryOptions({
    queryKey: localCheckoutKeys.patch(id, revision),
    queryFn: () => getLocalCheckoutPatch(id, revision),
    enabled: Boolean(id && revision),
    staleTime: Infinity,
    refetchInterval: (query) =>
      query.state.status === "error" ? LOCAL_DIFF_REFRESH_INTERVAL_MS : false,
  });
}

export {
  LOCAL_DIFF_REFRESH_INTERVAL_MS,
  localCheckoutKeys,
  localCheckoutListQueryOptions,
  localCheckoutPatchQueryOptions,
  localCheckoutStatusQueryOptions,
};
