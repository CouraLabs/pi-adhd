// src/lib/useTheme.ts
import { useCallback, useState } from "react";

export type Theme = "dark" | "light";

const KEY = "session-dashboard:theme";

/**
 * Read the persisted theme from localStorage. Returns `null` for missing,
 * malformed, or unreadable values. Never throws.
 */
export function readStoredTheme(): Theme | null {
  try {
    const v = localStorage.getItem(KEY);
    return v === "dark" || v === "light" ? v : null;
  } catch {
    return null;
  }
}

/**
 * Resolve the OS-level `prefers-color-scheme: light` preference. Defaults
 * to `"dark"` when `window`/`matchMedia` are unavailable.
 */
export function systemTheme(): Theme {
  if (typeof window === "undefined") return "dark";
  if (!window.matchMedia) return "dark";
  return window.matchMedia("(prefers-color-scheme: light)").matches
    ? "light"
    : "dark";
}

/**
 * Apply a theme: set `data-theme` on the document root (so the CSS
 * variables flip) and persist to localStorage. The localStorage write is
 * wrapped in `try/catch` because it can throw in private modes.
 */
export function applyTheme(theme: Theme): void {
  if (typeof document !== "undefined") {
    document.documentElement.dataset.theme = theme;
  }
  try {
    localStorage.setItem(KEY, theme);
  } catch {
    // localStorage can throw in private modes / when disabled — ignore.
  }
}

export interface UseThemeResult {
  theme: Theme;
  setTheme: (next: Theme) => void;
}

/**
 * Track the active theme in React state. Initial state is resolved in
 * this order:
 *   1. `localStorage` (the no-FOUC script may have populated this).
 *   2. `document.documentElement.dataset.theme` (set by the no-FOUC script).
 *   3. The system preference via `prefers-color-scheme`.
 *   4. Falls back to `"dark"` when nothing is available (e.g. SSR).
 *
 * The setter calls `applyTheme`, which keeps the DOM and localStorage in
 * sync.
 */
export function useTheme(): UseThemeResult {
  const [theme, setThemeState] = useState<Theme>(() => {
    if (typeof document === "undefined") return "dark";
    const stored = readStoredTheme();
    if (stored) return stored;
    const ds = document.documentElement.dataset.theme;
    if (ds === "dark" || ds === "light") return ds;
    return systemTheme();
  });

  const setTheme = useCallback((next: Theme): void => {
    applyTheme(next);
    setThemeState(next);
  }, []);

  return { theme, setTheme };
}
