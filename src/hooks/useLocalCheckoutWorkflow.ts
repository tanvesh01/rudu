import { useMemo } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { confirm, open } from "@tauri-apps/plugin-dialog";
import {
  getLocalCheckoutRouteParams,
  getSelectedLocalCheckoutFromPathname,
  LOCAL_CHECKOUT_ROUTE,
} from "../lib/local-checkout-route";
import { getErrorMessage } from "../lib/get-error-message";
import { appToastManager } from "../lib/toasts";
import {
  localCheckoutKeys,
  localCheckoutListQueryOptions,
} from "../queries/local-checkouts";
import {
  addLocalCheckout,
  removeLocalCheckout,
} from "../queries/local-checkouts-native";
import type { LocalCheckout } from "../types/local-checkouts";

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

  async function addCheckout() {
    const selectedPath = await open({
      directory: true,
      multiple: false,
      title: "Add local checkout",
    });
    if (typeof selectedPath !== "string") return;

    try {
      const checkout = await addLocalCheckout(selectedPath);
      queryClient.setQueryData<LocalCheckout[]>(
        localCheckoutKeys.list(),
        (current) => [
          ...(current ?? []).filter((item) => item.id !== checkout.id),
          checkout,
        ],
      );
      selectCheckout(checkout);
    } catch (error) {
      appToastManager.add({
        title: "Could not add local checkout",
        description: getErrorMessage(error),
        type: "error",
      });
    }
  }

  function selectCheckout(checkout: LocalCheckout) {
    if (!checkout.available) return;
    const params = getLocalCheckoutRouteParams(checkout.id);
    if (!params) return;
    void navigate({ params, to: LOCAL_CHECKOUT_ROUTE });
  }

  async function removeCheckout(checkout: LocalCheckout) {
    const approved = await confirm(
      `Remove ${checkout.folderName} from Rudu? Files on disk will not be changed.`,
      { kind: "warning", title: "Remove local checkout" },
    );
    if (!approved) return;

    try {
      await removeLocalCheckout(checkout.id);
      queryClient.setQueryData<LocalCheckout[]>(
        localCheckoutKeys.list(),
        (current) => current?.filter((item) => item.id !== checkout.id) ?? [],
      );
      queryClient.removeQueries({
        queryKey: localCheckoutKeys.status(checkout.id),
      });
      queryClient.removeQueries({
        queryKey: localCheckoutKeys.patchRoot(checkout.id),
      });
      if (selectedCheckoutId === checkout.id) {
        void navigate({ to: "/" });
      }
    } catch (error) {
      appToastManager.add({
        title: "Could not remove local checkout",
        description: getErrorMessage(error),
        type: "error",
      });
    }
  }

  return {
    addCheckout,
    checkouts: query.data ?? [],
    query,
    removeCheckout,
    selectCheckout,
    selectedCheckoutId,
  };
}

export { useLocalCheckoutWorkflow };
