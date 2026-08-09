import { keepPreviousData, queryOptions } from "@tanstack/react-query";
import {
  getLocalCheckoutPatch,
  getLocalCheckoutStatus,
  listLocalCheckouts,
  listReviewNotes,
} from "./local-checkouts-native";
import type { LocalDiffSource } from "../types/local-checkouts";

const LOCAL_DIFF_REFRESH_INTERVAL_MS = 1_000;

const localCheckoutKeys = {
  all: ["local-checkouts"] as const,
  list: () => [...localCheckoutKeys.all, "list"] as const,
  status: (id: string, source?: LocalDiffSource) =>
    [...localCheckoutKeys.all, "status", id, source ?? "working-tree"] as const,
  patchRoot: (id: string, source?: LocalDiffSource) =>
    [...localCheckoutKeys.all, "patch", id, source ?? "working-tree"] as const,
  patch: (id: string, revision: string, source?: LocalDiffSource) =>
    [...localCheckoutKeys.patchRoot(id, source), revision] as const,
  reviewNotes: (id: string) =>
    [...localCheckoutKeys.all, "review-notes", id] as const,
};

function localCheckoutListQueryOptions() {
  return queryOptions({
    queryKey: localCheckoutKeys.list(),
    queryFn: listLocalCheckouts,
    refetchInterval: LOCAL_DIFF_REFRESH_INTERVAL_MS,
    refetchIntervalInBackground: true,
  });
}

function localCheckoutStatusQueryOptions(id: string, source?: LocalDiffSource) {
  return queryOptions({
    queryKey: localCheckoutKeys.status(id, source),
    queryFn: () => getLocalCheckoutStatus(id, source),
    enabled: Boolean(id),
    refetchInterval: LOCAL_DIFF_REFRESH_INTERVAL_MS,
    refetchIntervalInBackground: true,
  });
}

function localCheckoutPatchQueryOptions(
  id: string,
  revision: string,
  source?: LocalDiffSource,
) {
  return queryOptions({
    queryKey: localCheckoutKeys.patch(id, revision, source),
    queryFn: () => getLocalCheckoutPatch(id, revision, source),
    enabled: Boolean(id && revision),
    staleTime: Infinity,
    // Keep the previous revision's patch rendered while the new revision
    // fetches so a background poll never blanks the diff into a loading screen.
    placeholderData: keepPreviousData,
    refetchInterval: (query) =>
      query.state.status === "error" ? LOCAL_DIFF_REFRESH_INTERVAL_MS : false,
  });
}

function localCheckoutReviewNotesQueryOptions(id: string, enabled = true) {
  return queryOptions({
    queryKey: localCheckoutKeys.reviewNotes(id),
    queryFn: () => listReviewNotes(id),
    enabled: Boolean(id && enabled),
    // ponytail: poll instead of a notes-changed event listener; the interval
    // matches the diff refresh so agent-written notes appear just as fast.
    refetchInterval: LOCAL_DIFF_REFRESH_INTERVAL_MS,
    refetchIntervalInBackground: true,
  });
}

export {
  LOCAL_DIFF_REFRESH_INTERVAL_MS,
  localCheckoutKeys,
  localCheckoutListQueryOptions,
  localCheckoutPatchQueryOptions,
  localCheckoutReviewNotesQueryOptions,
  localCheckoutStatusQueryOptions,
};
