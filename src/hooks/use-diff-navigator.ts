import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { normalizePath } from "../lib/review-threads";

type UseDiffNavigatorArgs = {
  prKey: string | null;
  isDiffReady: boolean;
  hasDiffError: boolean;
};

type UseDiffNavigatorResult = {
  tree: {
    selectedFilePath: string | null;
    onSelectFile(path: string): void;
  };
  diff: {
    selectedFilePath: string | null;
    registerDiffNode(path: string, node: HTMLDivElement | null): void;
  };
  actions: {
    notifyDiffContentChanged(): void;
  };
};

type ScrollableDiffNode = Pick<HTMLDivElement, "scrollIntoView">;

type DiffNavigatorControllerState = {
  selectedFilePath: string | null;
  pendingScrollPath: string | null;
};

type DiffNavigatorController = {
  setPrKey(prKey: string | null): void;
  setReadiness(isDiffReady: boolean, hasDiffError: boolean): void;
  onSelectFile(path: string): void;
  registerDiffNode(path: string, node: ScrollableDiffNode | null): void;
  notifyDiffContentChanged(): void;
  getState(): DiffNavigatorControllerState;
};

type CreateDiffNavigatorControllerArgs = {
  prKey: string | null;
  isDiffReady: boolean;
  hasDiffError: boolean;
  onSelectedFilePathChange(path: string | null): void;
};

function createDiffNavigatorController({
  prKey: initialPrKey,
  isDiffReady: initialIsDiffReady,
  hasDiffError: initialHasDiffError,
  onSelectedFilePathChange,
}: CreateDiffNavigatorControllerArgs): DiffNavigatorController {
  const diffNodeMap = new Map<string, ScrollableDiffNode>();
  let prKey = initialPrKey;
  let isDiffReady = initialIsDiffReady;
  let hasDiffError = initialHasDiffError;
  let selectedFilePath: string | null = null;
  let pendingScrollPath: string | null = null;

  function setSelectedFilePath(next: string | null) {
    if (selectedFilePath === next) return;
    selectedFilePath = next;
    onSelectedFilePathChange(next);
  }

  function canScroll() {
    return isDiffReady && !hasDiffError;
  }

  function findMatchingNode(path: string) {
    const directMatch = diffNodeMap.get(path);
    if (directMatch) return directMatch;

    const normalizedTargetPath = normalizePath(path);
    for (const [nodePath, node] of diffNodeMap) {
      if (normalizePath(nodePath) === normalizedTargetPath) {
        return node;
      }
    }

    return null;
  }

  function hasMatchingNode(path: string) {
    return findMatchingNode(path) !== null;
  }

  function tryScroll(path: string) {
    if (!canScroll()) {
      return false;
    }

    const node = findMatchingNode(path);
    if (!node) {
      return false;
    }

    node.scrollIntoView({
      behavior: "auto",
      block: "start",
      inline: "nearest",
    });
    return true;
  }

  function flushPendingScroll() {
    if (!pendingScrollPath) return false;

    if (tryScroll(pendingScrollPath)) {
      pendingScrollPath = null;
      return true;
    }

    return false;
  }

  return {
    setPrKey(nextPrKey) {
      if (nextPrKey === prKey) return;

      prKey = nextPrKey;
      setSelectedFilePath(null);
      pendingScrollPath = null;
      diffNodeMap.clear();
    },

    setReadiness(nextIsDiffReady, nextHasDiffError) {
      isDiffReady = nextIsDiffReady;
      hasDiffError = nextHasDiffError;
      flushPendingScroll();
    },

    onSelectFile(path) {
      setSelectedFilePath(path);
      pendingScrollPath = path;
      flushPendingScroll();
    },

    registerDiffNode(path, node) {
      if (node) {
        diffNodeMap.set(path, node);
      } else {
        diffNodeMap.delete(path);
      }

      flushPendingScroll();
    },

    notifyDiffContentChanged() {
      if (!selectedFilePath) return;

      if (diffNodeMap.size > 0 && !hasMatchingNode(selectedFilePath)) {
        pendingScrollPath = null;
        setSelectedFilePath(null);
        return;
      }

      pendingScrollPath = selectedFilePath;
      flushPendingScroll();
    },

    getState() {
      return {
        selectedFilePath,
        pendingScrollPath,
      };
    },
  };
}

function scheduleNextFrame(callback: () => void) {
  if (
    typeof window !== "undefined" &&
    typeof window.requestAnimationFrame === "function"
  ) {
    const frameId = window.requestAnimationFrame(callback);
    return () => window.cancelAnimationFrame(frameId);
  }

  const timeoutId = setTimeout(callback, 0);
  return () => clearTimeout(timeoutId);
}

function useDiffNavigator({
  prKey,
  isDiffReady,
  hasDiffError,
}: UseDiffNavigatorArgs): UseDiffNavigatorResult {
  const [selectedFilePath, setSelectedFilePath] = useState<string | null>(null);
  const cancelNotifyRef = useRef<(() => void) | null>(null);

  const controllerRef = useRef<DiffNavigatorController | null>(null);
  if (!controllerRef.current) {
    controllerRef.current = createDiffNavigatorController({
      prKey,
      isDiffReady,
      hasDiffError,
      onSelectedFilePathChange: setSelectedFilePath,
    });
  }

  useEffect(() => {
    return () => {
      if (!cancelNotifyRef.current) return;
      cancelNotifyRef.current();
      cancelNotifyRef.current = null;
    };
  }, []);

  useEffect(() => {
    const controller = controllerRef.current;
    if (!controller) return;
    controller.setPrKey(prKey);
    controller.setReadiness(isDiffReady, hasDiffError);
  }, [prKey, isDiffReady, hasDiffError]);

  const onSelectFile = useCallback((path: string) => {
    controllerRef.current?.onSelectFile(path);
  }, []);

  const registerDiffNode = useCallback(
    (path: string, node: HTMLDivElement | null) => {
      controllerRef.current?.registerDiffNode(path, node);
    },
    [],
  );

  const notifyDiffContentChanged = useCallback(() => {
    if (cancelNotifyRef.current) {
      cancelNotifyRef.current();
      cancelNotifyRef.current = null;
    }

    cancelNotifyRef.current = scheduleNextFrame(() => {
      controllerRef.current?.notifyDiffContentChanged();
      cancelNotifyRef.current = null;
    });
  }, []);

  const tree = useMemo(
    () => ({
      selectedFilePath,
      onSelectFile,
    }),
    [onSelectFile, selectedFilePath],
  );

  const diff = useMemo(
    () => ({
      selectedFilePath,
      registerDiffNode,
    }),
    [registerDiffNode, selectedFilePath],
  );

  const actions = useMemo(
    () => ({
      notifyDiffContentChanged,
    }),
    [notifyDiffContentChanged],
  );

  return { tree, diff, actions };
}

export {
  createDiffNavigatorController,
  useDiffNavigator,
};
export type {
  DiffNavigatorController,
  DiffNavigatorControllerState,
  UseDiffNavigatorArgs,
  UseDiffNavigatorResult,
};
