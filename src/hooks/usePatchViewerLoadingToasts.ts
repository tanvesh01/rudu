import { useEffect, useRef } from "react";
import { appToastManager } from "../lib/toasts";

const PATCH_VIEWER_LOADING_TOAST_ID = "patch-viewer-loading";

type UsePatchViewerLoadingToastsOptions = {
  hasSelection: boolean;
  isPatchLoading: boolean;
  patchError: string;
  isReviewThreadsLoading: boolean;
};

export function usePatchViewerLoadingToasts({
  hasSelection,
  isPatchLoading,
  patchError,
  isReviewThreadsLoading,
}: UsePatchViewerLoadingToastsOptions) {
  const isToastVisibleRef = useRef(false);
  const activeTitleRef = useRef<string | null>(null);

  useEffect(() => {
    const title =
      hasSelection && isPatchLoading && patchError.length === 0
        ? "Loading patch..."
        : hasSelection &&
            !isPatchLoading &&
            patchError.length === 0 &&
            isReviewThreadsLoading
          ? "Loading review threads..."
          : null;

    if (!title) {
      if (isToastVisibleRef.current) {
        appToastManager.close(PATCH_VIEWER_LOADING_TOAST_ID);
        isToastVisibleRef.current = false;
        activeTitleRef.current = null;
      }
      return;
    }

    if (!isToastVisibleRef.current) {
      appToastManager.add({
        id: PATCH_VIEWER_LOADING_TOAST_ID,
        title,
        timeout: 0,
        data: {
          placement: "bottom-center",
          variant: "patch-loading",
          hideClose: true,
        },
        onRemove: () => {
          isToastVisibleRef.current = false;
          activeTitleRef.current = null;
        },
      });
      isToastVisibleRef.current = true;
      activeTitleRef.current = title;
      return;
    }

    if (activeTitleRef.current !== title) {
      appToastManager.update(PATCH_VIEWER_LOADING_TOAST_ID, {
        title,
      });
      activeTitleRef.current = title;
    }
  }, [hasSelection, isPatchLoading, patchError, isReviewThreadsLoading]);
}
