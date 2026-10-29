// @vitest-environment happy-dom
// tests/client/useTheme.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook, act, cleanup } from "@testing-library/react";
import {
  applyTheme,
  readStoredTheme,
  systemTheme,
  useTheme,
} from "../../src/lib/useTheme";
import {
  installLocalStorageShim,
  type LocalStorageShim,
} from "./helpers/setupLocalStorage";

const KEY = "session-dashboard:theme";

function setMatchMediaLight(matches: boolean): void {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: (query: string) => ({
      matches,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }),
  });
}

function clearShim(shim: LocalStorageShim): void {
  shim.clear();
}

let shim: LocalStorageShim;

beforeEach(() => {
  // Start each test from a clean slate: empty localStorage, no data-theme
  // attribute, matchMedia defaulting to "no light preference".
  shim = installLocalStorageShim();
  delete document.documentElement.dataset.theme;
  setMatchMediaLight(false);
});

afterEach(() => {
  cleanup();
  clearShim(shim);
  delete document.documentElement.dataset.theme;
});

describe("readStoredTheme", () => {
  it("returns null when localStorage is empty", () => {
    expect(readStoredTheme()).toBeNull();
  });

  it("returns the stored value when valid", () => {
    shim.setItem(KEY, "light");
    expect(readStoredTheme()).toBe("light");

    shim.setItem(KEY, "dark");
    expect(readStoredTheme()).toBe("dark");
  });

  it("returns null for garbage / non-valid values", () => {
    for (const garbage of ["", "auto", "Light", " DARK ", "true", "null"]) {
      shim.setItem(KEY, garbage);
      expect(readStoredTheme()).toBeNull();
    }
  });

  it("returns null when localStorage throws", () => {
    const getItemSpy = vi.spyOn(shim, "getItem").mockImplementation(() => {
      throw new Error("SecurityError: storage disabled");
    });
    try {
      expect(readStoredTheme()).toBeNull();
    } finally {
      getItemSpy.mockRestore();
    }
  });
});

describe("systemTheme", () => {
  it("returns 'light' when matchMedia matches light", () => {
    setMatchMediaLight(true);
    expect(systemTheme()).toBe("light");
  });

  it("returns 'dark' when matchMedia does not match light", () => {
    setMatchMediaLight(false);
    expect(systemTheme()).toBe("dark");
  });
});

describe("applyTheme", () => {
  it("writes data-theme on <html> and the localStorage key", () => {
    applyTheme("light");
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(shim.getItem(KEY)).toBe("light");

    applyTheme("dark");
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(shim.getItem(KEY)).toBe("dark");
  });

  it("swallows localStorage errors silently", () => {
    const setItemSpy = vi.spyOn(shim, "setItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    try {
      // No throw.
      expect(() => applyTheme("light")).not.toThrow();
    } finally {
      setItemSpy.mockRestore();
    }
    // DOM is still updated — only the localStorage write failed.
    expect(document.documentElement.dataset.theme).toBe("light");
  });
});

describe("useTheme", () => {
  it("returns initial theme from document.documentElement.dataset.theme when set", () => {
    // The no-FOUC inline script would have written this before React mounts.
    document.documentElement.dataset.theme = "light";
    // System says dark — the dataset value should win since it's already
    // on the page.
    setMatchMediaLight(false);
    const { result } = renderHook(() => useTheme());
    expect(result.current.theme).toBe("light");
  });

  it("returns initial theme from systemTheme when dataset is unset", () => {
    expect(document.documentElement.dataset.theme).toBeUndefined();
    setMatchMediaLight(true);
    const { result } = renderHook(() => useTheme());
    expect(result.current.theme).toBe("light");
  });

  it("returns dark when neither dataset nor matchMedia indicate light", () => {
    setMatchMediaLight(false);
    const { result } = renderHook(() => useTheme());
    expect(result.current.theme).toBe("dark");
  });

  it("setTheme(new) updates state, dataset, and localStorage", () => {
    const { result } = renderHook(() => useTheme());
    expect(result.current.theme).toBe("dark");

    act(() => {
      result.current.setTheme("light");
    });

    expect(result.current.theme).toBe("light");
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(shim.getItem(KEY)).toBe("light");

    act(() => {
      result.current.setTheme("dark");
    });

    expect(result.current.theme).toBe("dark");
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(shim.getItem(KEY)).toBe("dark");
  });

  it("honors a stored value when present (no FOUC script ran)", () => {
    shim.setItem(KEY, "light");
    setMatchMediaLight(false);
    const { result } = renderHook(() => useTheme());
    expect(result.current.theme).toBe("light");
  });
});
