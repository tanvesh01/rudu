import { useCallback, useSyncExternalStore } from "react";

export type SidebarSizes = {
  left: number;
  right: number;
};

const STORAGE_KEY = "rudu:sidebar-sizes";
const DEFAULT_SIZES: SidebarSizes = { left: 320, right: 320 };
const MIN_SIZE = 180;
const MAX_SIZE = 560;

function clamp(size: number) {
  return Math.min(MAX_SIZE, Math.max(MIN_SIZE, Math.round(size)));
}

function parseSidebarSizes(raw: string | null): SidebarSizes {
  if (!raw) return DEFAULT_SIZES;
  try {
    const value = JSON.parse(raw) as Partial<SidebarSizes>;
    if (typeof value.left === "number" && typeof value.right === "number") {
      return { left: clamp(value.left), right: clamp(value.right) };
    }
  } catch {
    // keep defaults
  }
  return DEFAULT_SIZES;
}

let current: SidebarSizes =
  typeof localStorage === "undefined"
    ? DEFAULT_SIZES
    : parseSidebarSizes(localStorage.getItem(STORAGE_KEY));

const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function writeSizes(next: SidebarSizes) {
  if (next.left === current.left && next.right === current.right) return;
  current = next;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  listeners.forEach((listener) => listener());
}

function useSidebarSizes() {
  const sizes = useSyncExternalStore(subscribe, () => current);
  const setSizes = useCallback((next: Partial<SidebarSizes>) => {
    writeSizes({
      left: next.left === undefined ? current.left : clamp(next.left),
      right: next.right === undefined ? current.right : clamp(next.right),
    });
  }, []);

  return [sizes, setSizes] as const;
}

export { parseSidebarSizes, useSidebarSizes };
