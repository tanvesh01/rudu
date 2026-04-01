import { useState, useEffect, useCallback, useRef } from "react";
import type { PRStatus, GitHubCapabilities } from "../services/github/types.js";
import {
  checkPrForBranch,
  createPr,
  commitAndPush,
  getGitHubCapabilities,
  hasUncommittedChanges,
  isGitHubError,
} from "../services/github/GitHubService.js";

const DEBOUNCE_MS = 2000;
const CACHE_TTL_MS = 60000;

interface CachedPRStatus {
  status: PRStatus;
  fetchedAt: number;
}

interface GitHubStoreState {
  prStatuses: Map<string, CachedPRStatus>;
  capabilities: Map<string, GitHubCapabilities>;
  pendingActions: Map<string, "committing" | "pushing" | "creating_pr" | null>;
  isLoading: Map<string, boolean>;
  errors: Map<string, string>;
}

const initialState: GitHubStoreState = {
  prStatuses: new Map(),
  capabilities: new Map(),
  pendingActions: new Map(),
  isLoading: new Map(),
  errors: new Map(),
};

export function useGitHubStore() {
  const [store, setStore] = useState<GitHubStoreState>(initialState);
  const debounceTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const clearDebounce = useCallback((worktreeId: string) => {
    const timer = debounceTimers.current.get(worktreeId);
    if (timer) {
      clearTimeout(timer);
      debounceTimers.current.delete(worktreeId);
    }
  }, []);

  const getCachedPRStatus = useCallback(
    (worktreeId: string): PRStatus | null => {
      const cached = store.prStatuses.get(worktreeId);
      if (!cached) return null;
      if (Date.now() - cached.fetchedAt > CACHE_TTL_MS) return null;
      return cached.status;
    },
    [store.prStatuses],
  );

  const refreshPrStatus = useCallback(
    async (worktreeId: string, worktreePath: string) => {
      clearDebounce(worktreeId);

      const existingTimer = debounceTimers.current.get(worktreeId);
      if (existingTimer) {
        clearTimeout(existingTimer);
      }

      const timer = setTimeout(async () => {
        setStore((prev) => {
          const newLoading = new Map(prev.isLoading);
          newLoading.set(worktreeId, true);
          return { ...prev, isLoading: newLoading };
        });

        try {
          const prStatus = await checkPrForBranch(worktreePath);

          if (isGitHubError(prStatus)) {
            setStore((prev) => {
              const newStatuses = new Map(prev.prStatuses);
              newStatuses.delete(worktreeId);
              const newErrors = new Map(prev.errors);
              newErrors.set(worktreeId, prStatus.message);
              const newLoading = new Map(prev.isLoading);
              newLoading.set(worktreeId, false);
              return {
                ...prev,
                prStatuses: newStatuses,
                errors: newErrors,
                isLoading: newLoading,
              };
            });
            return;
          }

          setStore((prev) => {
            const newStatuses = new Map(prev.prStatuses);
            newStatuses.set(worktreeId, { status: prStatus, fetchedAt: Date.now() });
            const newErrors = new Map(prev.errors);
            newErrors.delete(worktreeId);
            const newLoading = new Map(prev.isLoading);
            newLoading.set(worktreeId, false);
            return {
              ...prev,
              prStatuses: newStatuses,
              errors: newErrors,
              isLoading: newLoading,
            };
          });
        } catch (error) {
          setStore((prev) => {
            const newErrors = new Map(prev.errors);
            newErrors.set(worktreeId, error instanceof Error ? error.message : "Unknown error");
            const newLoading = new Map(prev.isLoading);
            newLoading.set(worktreeId, false);
            return { ...prev, errors: newErrors, isLoading: newLoading };
          });
        }

        debounceTimers.current.delete(worktreeId);
      }, DEBOUNCE_MS);

      debounceTimers.current.set(worktreeId, timer);
    },
    [clearDebounce],
  );

  const getCapabilities = useCallback(
    async (worktreeId: string, worktreePath: string): Promise<GitHubCapabilities> => {
      const cached = store.capabilities.get(worktreeId);
      if (cached) return cached;

      const caps = await getGitHubCapabilities(worktreePath);

      setStore((prev) => {
        const newCaps = new Map(prev.capabilities);
        newCaps.set(worktreeId, caps);
        return { ...prev, capabilities: newCaps };
      });

      return caps;
    },
    [store.capabilities],
  );

  const commitAndPushAction = useCallback(
    async (worktreeId: string, worktreePath: string, message: string) => {
      setStore((prev) => {
        const newPending = new Map(prev.pendingActions);
        newPending.set(worktreeId, "committing");
        return { ...prev, pendingActions: newPending };
      });

      const result = await commitAndPush(worktreePath, message);

      setStore((prev) => {
        const newPending = new Map(prev.pendingActions);
        const newErrors = new Map(prev.errors);
        if (result.type === "failure") {
          newErrors.set(worktreeId, result.error || "Commit failed");
        } else {
          newPending.set(worktreeId, null);
          newErrors.delete(worktreeId);
        }
        return { ...prev, pendingActions: newPending, errors: newErrors };
      });

      if (result.type === "success") {
        await refreshPrStatus(worktreeId, worktreePath);
      }

      return result;
    },
    [refreshPrStatus],
  );

  const createPrAction = useCallback(
    async (worktreeId: string, worktreePath: string, title: string, body: string = "") => {
      setStore((prev) => {
        const newPending = new Map(prev.pendingActions);
        newPending.set(worktreeId, "creating_pr");
        return { ...prev, pendingActions: newPending };
      });

      const result = await createPr(worktreePath, title, body);

      setStore((prev) => {
        const newPending = new Map(prev.pendingActions);
        const newErrors = new Map(prev.errors);
        if (result.type === "failure") {
          newErrors.set(worktreeId, result.error || "PR creation failed");
        } else {
          newPending.set(worktreeId, null);
          newErrors.delete(worktreeId);
        }
        return { ...prev, pendingActions: newPending, errors: newErrors };
      });

      if (result.type === "success") {
        await refreshPrStatus(worktreeId, worktreePath);
      }

      return result;
    },
    [refreshPrStatus],
  );

  const checkUncommittedChanges = useCallback(
    async (worktreePath: string): Promise<boolean> => {
      return hasUncommittedChanges(worktreePath);
    },
    [],
  );

  const clearError = useCallback((worktreeId: string) => {
    setStore((prev) => {
      const newErrors = new Map(prev.errors);
      newErrors.delete(worktreeId);
      return { ...prev, errors: newErrors };
    });
  }, []);

  useEffect(() => {
    return () => {
      debounceTimers.current.forEach((timer) => clearTimeout(timer));
    };
  }, []);

  return {
    store,
    getCachedPRStatus,
    refreshPrStatus,
    getCapabilities,
    commitAndPushAction,
    createPrAction,
    checkUncommittedChanges,
    clearError,
  };
}