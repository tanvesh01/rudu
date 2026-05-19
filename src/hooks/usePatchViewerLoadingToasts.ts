import { useEffect, useRef } from "react";
import { appToastManager } from "../lib/toasts";

const PATCH_VIEWER_LOADING_TOAST_ID = "patch-viewer-loading";

type PatchViewerLoadingToastManager = {
  add(toast: {
    id: string;
    title: string;
    timeout: number;
    data: {
      placement: "bottom-center";
      variant: "patch-loading";
      hideClose: true;
    };
    onRemove: () => void;
  }): unknown;
  close(id: string): void;
  update(id: string, updates: { title: string }): void;
};

type ActiveToast = {
  generation: symbol;
  owner: symbol;
  status: "open" | "closing";
  title: string;
};

type PendingToast = {
  owner: symbol;
  title: string;
};

type UsePatchViewerLoadingToastsOptions = {
  hasSelection: boolean;
  isPatchLoading: boolean;
  patchError: string;
  isReviewThreadsLoading: boolean;
};

function createPatchViewerLoadingToastController(
  toastManager: PatchViewerLoadingToastManager,
) {
  let activeToast: ActiveToast | null = null;
  let pendingToast: PendingToast | null = null;

  function addToast(owner: symbol, title: string) {
    const generation = Symbol(PATCH_VIEWER_LOADING_TOAST_ID);
    activeToast = {
      generation,
      owner,
      status: "open",
      title,
    };

    toastManager.add({
      id: PATCH_VIEWER_LOADING_TOAST_ID,
      title,
      timeout: 0,
      data: {
        placement: "bottom-center",
        variant: "patch-loading",
        hideClose: true,
      },
      onRemove: () => {
        if (activeToast?.generation === generation) {
          activeToast = null;
        }

        const nextToast = pendingToast;
        pendingToast = null;
        if (nextToast) {
          addToast(nextToast.owner, nextToast.title);
        }
      },
    });
  }

  function show(owner: symbol, title: string) {
    if (!activeToast) {
      addToast(owner, title);
      return;
    }

    if (activeToast.status === "closing") {
      pendingToast = { owner, title };
      return;
    }

    activeToast.owner = owner;
    if (activeToast.title !== title) {
      toastManager.update(PATCH_VIEWER_LOADING_TOAST_ID, { title });
      activeToast.title = title;
    }
  }

  function hide(owner: symbol) {
    if (pendingToast?.owner === owner) {
      pendingToast = null;
    }

    if (
      !activeToast ||
      activeToast.owner !== owner ||
      activeToast.status === "closing"
    ) {
      return;
    }

    activeToast.status = "closing";
    toastManager.close(PATCH_VIEWER_LOADING_TOAST_ID);
  }

  return {
    hide,
    show,
  };
}

function getPatchViewerLoadingToastTitle({
  hasSelection,
  isPatchLoading,
  patchError,
  isReviewThreadsLoading,
}: UsePatchViewerLoadingToastsOptions) {
  if (hasSelection && isPatchLoading && patchError.length === 0) {
    return "Loading patch...";
  }

  if (
    hasSelection &&
    !isPatchLoading &&
    patchError.length === 0 &&
    isReviewThreadsLoading
  ) {
    return "Loading review threads...";
  }

  return null;
}

const patchViewerLoadingToastController =
  createPatchViewerLoadingToastController(appToastManager);

export function usePatchViewerLoadingToasts({
  hasSelection,
  isPatchLoading,
  patchError,
  isReviewThreadsLoading,
}: UsePatchViewerLoadingToastsOptions) {
  const toastOwnerRef = useRef(Symbol(PATCH_VIEWER_LOADING_TOAST_ID));

  useEffect(() => {
    const title = getPatchViewerLoadingToastTitle({
      hasSelection,
      isPatchLoading,
      patchError,
      isReviewThreadsLoading,
    });

    if (!title) {
      patchViewerLoadingToastController.hide(toastOwnerRef.current);
      return;
    }

    patchViewerLoadingToastController.show(toastOwnerRef.current, title);
  }, [hasSelection, isPatchLoading, patchError, isReviewThreadsLoading]);

  useEffect(
    () => () => {
      patchViewerLoadingToastController.hide(toastOwnerRef.current);
    },
    [],
  );
}

export {
  createPatchViewerLoadingToastController,
  getPatchViewerLoadingToastTitle,
};
