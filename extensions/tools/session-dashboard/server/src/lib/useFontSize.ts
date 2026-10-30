// src/lib/useFontSize.ts
import { useCallback, useState } from "react";

export const MIN_FONT_SIZE = 11;
export const MAX_FONT_SIZE = 20;
export const DEFAULT_FONT_SIZE = 14.5;
export const FONT_SIZE_STEP = 0.5;

const KEY = "session-dashboard.fontSize";

export interface UseFontSizeResult {
  fontSize: number;
  setFontSize: (next: number) => void;
}

/**
 * Clamp a font size to the [MIN_FONT_SIZE, MAX_FONT_SIZE] range.
 * Non-finite values fall back to DEFAULT_FONT_SIZE.
 */
export function clampFontSize(n: number): number {
  if (!Number.isFinite(n)) return DEFAULT_FONT_SIZE;
  return Math.min(MAX_FONT_SIZE, Math.max(MIN_FONT_SIZE, n));
}

/**
 * Read the persisted font size from localStorage. Returns `null` for
 * missing, malformed, or unreadable values. Never throws.
 */
export function readStoredFontSize(): number | null {
  try {
    const v = localStorage.getItem(KEY);
    if (v === null) return null;
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

/**
 * Apply a font size: set `--font-size` on the document root (so the whole
 * dashboard scales) and persist to localStorage. The localStorage write
 * is wrapped in `try/catch` because it can throw in private modes.
 */
export function applyFontSize(size: number): void {
  if (typeof document !== "undefined") {
    document.documentElement.style.setProperty("--font-size", `${size}px`);
  }
  try {
    localStorage.setItem(KEY, String(size));
  } catch {
    // localStorage can throw in private modes / when disabled — ignore.
  }
}

/**
 * Track the base font size in React state. Initial state is the clamped
 * localStorage value when present, otherwise DEFAULT_FONT_SIZE. The
 * setter clamps, calls `applyFontSize` (DOM + localStorage), and updates
 * state so the SettingsPanel label re-renders.
 */
export function useFontSize(): UseFontSizeResult {
  const [fontSize, setFontSizeState] = useState<number>(() => {
    const stored =
      typeof window !== "undefined" ? readStoredFontSize() : null;
    return stored !== null ? clampFontSize(stored) : DEFAULT_FONT_SIZE;
  });

  const setFontSize = useCallback((next: number): void => {
    const clamped = clampFontSize(next);
    applyFontSize(clamped);
    setFontSizeState(clamped);
  }, []);

  return { fontSize, setFontSize };
}
