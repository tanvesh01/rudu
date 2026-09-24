import { useCallback, useMemo } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { open } from "@tauri-apps/plugin-dialog";
import {
  getLocalCheckoutRouteParams,
  getLocalDiffSourceSearch,
  getSelectedLocalCheckoutFromPathname,
  LOCAL_CHECKOUT_ROUTE,
} from "../lib/local-checkout-route";
import { getErrorMessage } from "../lib/get-error-message";
import { appToastManager } from "../lib/toasts";
import {
  localCheckoutKeys,
  localCheckoutListQueryOptions,
} from "../queries/local-checkouts";
import { addLocalCheckout } from "../queries/local-checkouts-native";
import type { LocalCheckout, LocalDiffSource } from "../types/local-checkouts";

type UseLocalCheckoutWorkflowOptions = {
  pathname: string;
};

function useLocalCheckoutWorkflow({
  pathname,
}: UseLocalCheckoutWorkflowOptions) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const query = useQuery(localCheckoutListQueryOptions());
  const selectedCheckoutId = useMemo(
    () => getSelectedLocalCheckoutFromPathname(pathname),
    [pathname],
  );

  const addCheckoutPath = useCallback(
    async (selectedPath: string, source?: LocalDiffSource) => {
      try {
        const checkout = await addLocalCheckout(selectedPath);
        queryClient.setQueryData<LocalCheckout[]>(
          localCheckoutKeys.list(),
          (current) => [
            ...(current ?? []).filter((item) => item.id !== checkout.id),
            checkout,
          ],
        );
        selectCheckout(checkout, source);
        return checkout;
      } catch (error) {
        appToastManager.add({
          title: "Could not add local checkout",
          description: getErrorMessage(error),
          type: "error",
        });
        return null;
      }
    },
    [queryClient],
  );

  const addCheckout = useCallback(async () => {
    const selectedPath = await open({
      directory: true,
      multiple: false,
      title: "Add local checkout",
    });
    if (typeof selectedPath !== "string") return;

    await addCheckoutPath(selectedPath);
  }, [addCheckoutPath]);

  function selectCheckout(checkout: LocalCheckout, source?: LocalDiffSource) {
    if (!checkout.available) return;
    const params = getLocalCheckoutRouteParams(checkout.id);
    if (!params) return;
    void navigate({
      params,
      search: getLocalDiffSourceSearch(source),
      to: LOCAL_CHECKOUT_ROUTE,
    });
  }

  return {
    addCheckout,
    addCheckoutPath,
    checkouts: query.data ?? [],
    query,
    selectCheckout,
    selectedCheckoutId,
  };
}

export { useLocalCheckoutWorkflow };
