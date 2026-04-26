import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEventHandler,
  type PointerEventHandler,
  type RefObject,
} from "react";

type ResizeOrientation = "horizontal" | "vertical";
type ResizablePanel = "first" | "second";

type UseResizablePanelGroupOptions = {
  id: string;
  orientation: ResizeOrientation;
  controlledPanel?: ResizablePanel;
  defaultSize: number;
  minSize: number;
  maxSize: number;
  step?: number;
};

type ResizableHandleInteractionProps = {
  role: "separator";
  tabIndex: number;
  "aria-orientation": "horizontal" | "vertical";
  "aria-valuemin": number;
  "aria-valuemax": number;
  "aria-valuenow": number;
  "aria-valuetext": string;
  onDoubleClick: () => void;
  onKeyDown: KeyboardEventHandler<HTMLDivElement>;
  onPointerDown: PointerEventHandler<HTMLDivElement>;
};

type UseResizablePanelGroupResult = {
  containerRef: RefObject<HTMLDivElement | null>;
  size: number;
  panelStyle: CSSProperties;
  handleProps: ResizableHandleInteractionProps;
  reset: () => void;
};

const PANEL_LAYOUT_STORAGE_KEY = "rudu.panel-layout.v1";

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readStoredSizes() {
  if (typeof window === "undefined") {
    return {};
  }

  try {
    const rawValue = window.localStorage.getItem(PANEL_LAYOUT_STORAGE_KEY);
    if (!rawValue) {
      return {};
    }

    const parsedValue: unknown = JSON.parse(rawValue);
    if (!isPlainRecord(parsedValue)) {
      return {};
    }

    const sizes: Record<string, number> = {};
    for (const [key, value] of Object.entries(parsedValue)) {
      if (typeof value === "number" && Number.isFinite(value)) {
        sizes[key] = value;
      }
    }

    return sizes;
  } catch {
    return {};
  }
}

function writeStoredSize(id: string, size: number) {
  if (typeof window === "undefined") {
    return;
  }

  try {
    const nextSizes = {
      ...readStoredSizes(),
      [id]: size,
    };
    window.localStorage.setItem(
      PANEL_LAYOUT_STORAGE_KEY,
      JSON.stringify(nextSizes),
    );
  } catch {
    // Storage can be unavailable in restricted contexts; resizing still works.
  }
}

function getInitialSize({
  id,
  defaultSize,
  minSize,
  maxSize,
}: Pick<
  UseResizablePanelGroupOptions,
  "id" | "defaultSize" | "minSize" | "maxSize"
>) {
  const storedSize = readStoredSizes()[id];

  if (
    typeof storedSize === "number" &&
    storedSize >= minSize &&
    storedSize <= maxSize
  ) {
    return storedSize;
  }

  return clamp(defaultSize, minSize, maxSize);
}

function useResizablePanelGroup({
  id,
  orientation,
  controlledPanel = "first",
  defaultSize,
  minSize,
  maxSize,
  step = 2,
}: UseResizablePanelGroupOptions): UseResizablePanelGroupResult {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState(() =>
    getInitialSize({ id, defaultSize, minSize, maxSize }),
  );

  const dragCleanupRef = useRef<(() => void) | null>(null);

  const setClampedSize = useCallback(
    (nextSize: number) => {
      setSize(clamp(nextSize, minSize, maxSize));
    },
    [maxSize, minSize],
  );

  const reset = useCallback(() => {
    setClampedSize(defaultSize);
  }, [defaultSize, setClampedSize]);

  const getSizeFromPointer = useCallback(
    (clientX: number, clientY: number) => {
      const container = containerRef.current;
      if (!container) {
        return size;
      }

      const rect = container.getBoundingClientRect();
      const totalSize =
        orientation === "horizontal" ? rect.width : rect.height;

      if (totalSize <= 0) {
        return size;
      }

      const pointerOffset =
        orientation === "horizontal"
          ? clientX - rect.left
          : clientY - rect.top;
      const panelPixels =
        controlledPanel === "first" ? pointerOffset : totalSize - pointerOffset;

      return (panelPixels / totalSize) * 100;
    },
    [controlledPanel, orientation, size],
  );

  const onPointerDown = useCallback<PointerEventHandler<HTMLDivElement>>(
    (event) => {
      if (event.button !== 0) {
        return;
      }

      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      setClampedSize(getSizeFromPointer(event.clientX, event.clientY));

      const root = document.documentElement;
      const previousCursor = root.style.cursor;
      const previousUserSelect = root.style.userSelect;
      root.style.cursor =
        orientation === "horizontal" ? "col-resize" : "row-resize";
      root.style.userSelect = "none";

      const handlePointerMove = (pointerEvent: PointerEvent) => {
        setClampedSize(
          getSizeFromPointer(pointerEvent.clientX, pointerEvent.clientY),
        );
      };

      const cleanup = () => {
        window.removeEventListener("pointermove", handlePointerMove);
        window.removeEventListener("pointerup", cleanup);
        window.removeEventListener("pointercancel", cleanup);
        root.style.cursor = previousCursor;
        root.style.userSelect = previousUserSelect;
        dragCleanupRef.current = null;
      };

      dragCleanupRef.current?.();
      dragCleanupRef.current = cleanup;

      window.addEventListener("pointermove", handlePointerMove);
      window.addEventListener("pointerup", cleanup);
      window.addEventListener("pointercancel", cleanup);
    },
    [getSizeFromPointer, orientation, setClampedSize],
  );

  const onKeyDown = useCallback<KeyboardEventHandler<HTMLDivElement>>(
    (event) => {
      const direction =
        orientation === "horizontal"
          ? event.key === "ArrowLeft"
            ? -1
            : event.key === "ArrowRight"
              ? 1
              : 0
          : event.key === "ArrowUp"
            ? -1
            : event.key === "ArrowDown"
              ? 1
              : 0;

      if (direction !== 0) {
        event.preventDefault();
        const panelDirection = controlledPanel === "first" ? direction : -direction;
        setClampedSize(size + panelDirection * step);
        return;
      }

      if (event.key === "Home") {
        event.preventDefault();
        setClampedSize(controlledPanel === "first" ? minSize : maxSize);
        return;
      }

      if (event.key === "End") {
        event.preventDefault();
        setClampedSize(controlledPanel === "first" ? maxSize : minSize);
      }
    },
    [
      controlledPanel,
      maxSize,
      minSize,
      orientation,
      setClampedSize,
      size,
      step,
    ],
  );

  useEffect(() => {
    writeStoredSize(id, size);
  }, [id, size]);

  useEffect(() => {
    return () => {
      dragCleanupRef.current?.();
    };
  }, []);

  const panelStyle = useMemo<CSSProperties>(
    () => ({ flexBasis: `${size}%` }),
    [size],
  );

  const separatorOrientation =
    orientation === "horizontal" ? "vertical" : "horizontal";

  const handleProps = useMemo<ResizableHandleInteractionProps>(
    () => ({
      role: "separator",
      tabIndex: 0,
      "aria-orientation": separatorOrientation,
      "aria-valuemin": minSize,
      "aria-valuemax": maxSize,
      "aria-valuenow": Math.round(size),
      "aria-valuetext": `${Math.round(size)} percent`,
      onDoubleClick: reset,
      onKeyDown,
      onPointerDown,
    }),
    [
      maxSize,
      minSize,
      onKeyDown,
      onPointerDown,
      reset,
      separatorOrientation,
      size,
    ],
  );

  return {
    containerRef,
    size,
    panelStyle,
    handleProps,
    reset,
  };
}

export { PANEL_LAYOUT_STORAGE_KEY, useResizablePanelGroup };
export type {
  ResizableHandleInteractionProps,
  ResizeOrientation,
  UseResizablePanelGroupOptions,
};
