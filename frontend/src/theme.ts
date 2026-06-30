import { useEffect, useState } from "react";

/**
 * Theme handling. The initial class is applied pre-paint by the inline script
 * in index.html (no flash); this hook keeps React in sync and persists the
 * user's explicit choice. Defaults to the OS preference until the user picks.
 */
const STORAGE_KEY = "billsplit-theme";

export type Theme = "light" | "dark";

function currentDomTheme(): Theme {
  if (typeof document === "undefined") return "light";
  return document.documentElement.classList.contains("dark") ? "dark" : "light";
}

function applyTheme(theme: Theme) {
  const root = document.documentElement;
  root.classList.toggle("dark", theme === "dark");
  // Keep the iOS/Android chrome tint in step with a manual override.
  const meta = document.querySelector('meta[name="theme-color"]:not([media])')
    ?? document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", theme === "dark" ? "#0b0f14" : "#f6f8fa");
}

export function useTheme() {
  const [theme, setTheme] = useState<Theme>(currentDomTheme);

  // If the user has NOT made an explicit choice, follow the OS as it changes.
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = (e: MediaQueryListEvent) => {
      if (localStorage.getItem(STORAGE_KEY)) return; // user override wins
      const next: Theme = e.matches ? "dark" : "light";
      applyTheme(next);
      setTheme(next);
    };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  function toggle() {
    const next: Theme = theme === "dark" ? "light" : "dark";
    applyTheme(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* ignore quota / privacy-mode errors */
    }
    setTheme(next);
  }

  return { theme, toggle };
}
