import { useCallback, useEffect, useState } from "react";

type Theme = "light" | "dark";
type ThemePreference = Theme | "system";

const THEME_STORAGE_KEY = "theme";

function getSystemTheme(): Theme {
  if (typeof window === "undefined") {
    return "light";
  }

  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

function getStoredPreference(): ThemePreference {
  if (typeof window === "undefined") {
    return "system";
  }

  try {
    const value = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (value === "light" || value === "dark") {
      return value;
    }
  } catch {
    // Ignore storage errors and fall back to the system preference.
  }

  return "system";
}

function useTheme() {
  const [preference, setPreference] = useState<ThemePreference>(() =>
    getStoredPreference(),
  );
  const [systemTheme, setSystemTheme] = useState<Theme>(() => getSystemTheme());

  const theme = preference === "system" ? systemTheme : preference;
  const isDark = theme === "dark";

  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle("dark", isDark);
    root.style.colorScheme = isDark ? "dark" : "light";
  }, [isDark]);

  useEffect(() => {
    try {
      if (preference === "system") {
        window.localStorage.removeItem(THEME_STORAGE_KEY);
      } else {
        window.localStorage.setItem(THEME_STORAGE_KEY, preference);
      }
    } catch {
      // Ignore storage errors.
    }
  }, [preference]);

  useEffect(() => {
    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");

    const handleChange = (event: MediaQueryListEvent) => {
      setSystemTheme(event.matches ? "dark" : "light");
    };

    if (typeof mediaQuery.addEventListener === "function") {
      mediaQuery.addEventListener("change", handleChange);
      return () => mediaQuery.removeEventListener("change", handleChange);
    }

    mediaQuery.addListener(handleChange);
    return () => mediaQuery.removeListener(handleChange);
  }, []);

  const toggleTheme = useCallback(() => {
    setPreference((current) => {
      const currentTheme = current === "system" ? systemTheme : current;
      return currentTheme === "dark" ? "light" : "dark";
    });
  }, [systemTheme]);

  return { theme, isDark, preference, setPreference, toggleTheme };
}

export { useTheme };
export type { Theme, ThemePreference };
