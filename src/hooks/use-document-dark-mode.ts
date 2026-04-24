import { useEffect, useState } from "react";

function useDocumentDarkMode() {
  const [isDark, setIsDark] = useState(() => {
    if (typeof document === "undefined") {
      return false;
    }

    return document.documentElement.classList.contains("dark");
  });

  useEffect(() => {
    const root = document.documentElement;

    const syncTheme = () => {
      setIsDark(root.classList.contains("dark"));
    };

    syncTheme();

    const observer = new MutationObserver(syncTheme);
    observer.observe(root, { attributes: true, attributeFilter: ["class"] });

    return () => observer.disconnect();
  }, []);

  return isDark;
}

export { useDocumentDarkMode };
