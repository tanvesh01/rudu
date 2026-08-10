import { useCallback, useSyncExternalStore } from "react";

export type DiffStyle = "unified" | "split";

const STORAGE_KEY = "rudu:diff-style";

let current: DiffStyle =
  (typeof localStorage !== "undefined" &&
    (localStorage.getItem(STORAGE_KEY) as DiffStyle | null)) ||
  "unified";

const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useDiffStyle() {
  const diffStyle = useSyncExternalStore(subscribe, () => current);
  const setDiffStyle = useCallback((style: DiffStyle) => {
    if (style === current) return;
    current = style;
    localStorage.setItem(STORAGE_KEY, style);
    listeners.forEach((listener) => listener());
  }, []);

  return [diffStyle, setDiffStyle] as const;
}
