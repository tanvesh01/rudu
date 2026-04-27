import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { appToastManager } from "../lib/toasts";
import {
  GH_CLI_CHECKING_TOAST_ID,
  GH_CLI_WARNING_TOAST_ID,
  GH_CLI_TOAST_LOCK_VISIBLE,
  getGhCliWarningCopy,
} from "../lib/gh-cli-toasts";
import { ghCliStatusQueryOptions } from "../queries/github";
import { getErrorMessage } from "./useGithubQueries";
import type { GhCliStatusKind } from "../types/github";

export function useGhCliStatusToasts() {
  const ghCliStatusQuery = useQuery({
    ...ghCliStatusQueryOptions(),
  });

  const ghCliStatus = ghCliStatusQuery.data ?? null;
  const isCheckingGhCli =
    ghCliStatusQuery.isPending || ghCliStatusQuery.isFetching;
  const ghCliStatusMessage =
    ghCliStatus?.message ?? (getErrorMessage(ghCliStatusQuery.error) || null);

  const [dismissedWarningStatus, setDismissedWarningStatus] =
    useState<GhCliStatusKind | null>(null);
  const checkingToastVisibleRef = useRef(false);
  const warningToastVisibleRef = useRef(false);
  const warningToastStatusRef = useRef<GhCliStatusKind | null>(null);

  useEffect(() => {
    if (GH_CLI_TOAST_LOCK_VISIBLE) {
      if (isCheckingGhCli) {
        if (!checkingToastVisibleRef.current) {
          appToastManager.close(GH_CLI_CHECKING_TOAST_ID);
          appToastManager.add({
            id: GH_CLI_CHECKING_TOAST_ID,
            title: "Checking gh setup",
            description:
              "Verifying local GitHub CLI availability and auth status.",
            timeout: 0,
          });
          checkingToastVisibleRef.current = true;
        }
        if (warningToastVisibleRef.current) {
          appToastManager.close(GH_CLI_WARNING_TOAST_ID);
          warningToastVisibleRef.current = false;
          warningToastStatusRef.current = null;
        }
        return;
      }

      if (checkingToastVisibleRef.current) {
        appToastManager.close(GH_CLI_CHECKING_TOAST_ID);
        checkingToastVisibleRef.current = false;
      }

      const lockedStatus = ghCliStatus?.status ?? "unknown_error";
      if (
        warningToastVisibleRef.current &&
        warningToastStatusRef.current === lockedStatus
      ) {
        return;
      }

      appToastManager.close(GH_CLI_WARNING_TOAST_ID);
      const copy = getGhCliWarningCopy(lockedStatus, ghCliStatusMessage);
      appToastManager.add({
        id: GH_CLI_WARNING_TOAST_ID,
        title: copy.title,
        description: copy.description,
        timeout: 0,
        priority: "high",
        onRemove: () => {
          warningToastVisibleRef.current = false;
          warningToastStatusRef.current = null;
        },
      });
      warningToastVisibleRef.current = true;
      warningToastStatusRef.current = lockedStatus;
      return;
    }

    if (isCheckingGhCli) {
      if (!checkingToastVisibleRef.current) {
        appToastManager.close(GH_CLI_CHECKING_TOAST_ID);
        appToastManager.add({
          id: GH_CLI_CHECKING_TOAST_ID,
          title: "Checking gh setup",
          description:
            "Verifying local GitHub CLI availability and auth status.",
          timeout: 0,
        });
        checkingToastVisibleRef.current = true;
      }
      if (warningToastVisibleRef.current) {
        appToastManager.close(GH_CLI_WARNING_TOAST_ID);
        warningToastVisibleRef.current = false;
        warningToastStatusRef.current = null;
      }
      return;
    }

    if (checkingToastVisibleRef.current) {
      appToastManager.close(GH_CLI_CHECKING_TOAST_ID);
      checkingToastVisibleRef.current = false;
    }

    const warningStatus =
      !ghCliStatus || ghCliStatus.status === "ready"
        ? null
        : ghCliStatus.status;
    if (!warningStatus) {
      if (warningToastVisibleRef.current) {
        appToastManager.close(GH_CLI_WARNING_TOAST_ID);
        warningToastVisibleRef.current = false;
        warningToastStatusRef.current = null;
      }
      return;
    }

    if (
      !GH_CLI_TOAST_LOCK_VISIBLE &&
      dismissedWarningStatus === warningStatus
    ) {
      if (warningToastVisibleRef.current) {
        appToastManager.close(GH_CLI_WARNING_TOAST_ID);
        warningToastVisibleRef.current = false;
        warningToastStatusRef.current = null;
      }
      return;
    }

    if (
      warningToastVisibleRef.current &&
      warningToastStatusRef.current === warningStatus
    ) {
      return;
    }

    appToastManager.close(GH_CLI_WARNING_TOAST_ID);
    const copy = getGhCliWarningCopy(warningStatus, ghCliStatusMessage);
    appToastManager.add({
      id: GH_CLI_WARNING_TOAST_ID,
      title: copy.title,
      description: copy.description,
      timeout: 0,
      priority: "high",
      onRemove: () => {
        warningToastVisibleRef.current = false;
        warningToastStatusRef.current = null;
        if (!GH_CLI_TOAST_LOCK_VISIBLE) {
          setDismissedWarningStatus(warningStatus);
        }
      },
    });
    warningToastVisibleRef.current = true;
    warningToastStatusRef.current = warningStatus;
  }, [
    dismissedWarningStatus,
    ghCliStatus,
    ghCliStatusMessage,
    isCheckingGhCli,
  ]);
}
