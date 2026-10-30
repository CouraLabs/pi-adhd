// @vitest-environment happy-dom
// tests/client/SettingsPanel-theme.test.tsx
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, fireEvent } from "@testing-library/react";
import { SettingsPanel } from "../../src/components/SettingsPanel";
import type { Theme } from "../../src/lib/useTheme";
import { installLocalStorageShim } from "./helpers/setupLocalStorage";

beforeEach(() => {
  installLocalStorageShim();
  delete document.documentElement.dataset.theme;
});

afterEach(() => {
  cleanup();
  delete document.documentElement.dataset.theme;
});

function props(theme: Theme, onThemeChange: (next: Theme) => void, fontSize = 14.5, onFontSizeChange = vi.fn()) {
  return {
    streamingEnabled: false,
    onStreamingChange: vi.fn(),
    autoScrollEnabled: false,
    onAutoScrollChange: vi.fn(),
    theme,
    onThemeChange,
    fontSize,
    onFontSizeChange,
  };
}

function openPopover(getByLabelText: ReturnType<typeof render>["getByLabelText"]) {
  fireEvent.click(getByLabelText("settings"));
}

describe("SettingsPanel — theme toggle", () => {
  it("renders the segmented control with two buttons labeled Dark and Light", () => {
    const onThemeChange = vi.fn();
    const { getByLabelText } = render(<SettingsPanel {...props("dark", onThemeChange)} />);
    openPopover(getByLabelText);

    const group = document.querySelector('[role="group"][aria-label="theme"]');
    expect(group).not.toBeNull();
    const buttons = group!.querySelectorAll("button");
    expect(buttons).toHaveLength(2);
    expect(buttons[0].textContent).toBe("Dark");
    expect(buttons[1].textContent).toBe("Light");
  });

  it("the button matching the theme prop has aria-pressed=true and class is-active", () => {
    const onThemeChange = vi.fn();

    {
      const { getByLabelText } = render(<SettingsPanel {...props("dark", onThemeChange)} />);
      openPopover(getByLabelText);

      const group = document.querySelector('[role="group"][aria-label="theme"]')!;
      const [dark, light] = Array.from(group.querySelectorAll("button"));

      expect(dark.getAttribute("aria-pressed")).toBe("true");
      expect(dark.className).toContain("is-active");
      expect(light.getAttribute("aria-pressed")).toBe("false");
      expect(light.className).not.toContain("is-active");
    }

    cleanup();

    {
      const { getByLabelText } = render(<SettingsPanel {...props("light", onThemeChange)} />);
      openPopover(getByLabelText);

      const group = document.querySelector('[role="group"][aria-label="theme"]')!;
      const [dark, light] = Array.from(group.querySelectorAll("button"));

      expect(light.getAttribute("aria-pressed")).toBe("true");
      expect(light.className).toContain("is-active");
      expect(dark.getAttribute("aria-pressed")).toBe("false");
      expect(dark.className).not.toContain("is-active");
    }
  });

  it("clicking the inactive button calls onThemeChange with the new value", () => {
    const onThemeChange = vi.fn();
    const { getByLabelText } = render(<SettingsPanel {...props("dark", onThemeChange)} />);
    openPopover(getByLabelText);

    const group = document.querySelector('[role="group"][aria-label="theme"]')!;
    const [, light] = Array.from(group.querySelectorAll("button"));
    fireEvent.click(light);

    expect(onThemeChange).toHaveBeenCalledWith("light");
    expect(onThemeChange).toHaveBeenCalledTimes(1);
  });

  it("clicking the active button is wired through onThemeChange", () => {
    const onThemeChange = vi.fn();
    const { getByLabelText } = render(<SettingsPanel {...props("light", onThemeChange)} />);
    openPopover(getByLabelText);

    const group = document.querySelector('[role="group"][aria-label="theme"]')!;
    const [, light] = Array.from(group.querySelectorAll("button"));
    fireEvent.click(light);

    // We don't impose a specific behavior here — the parent decides what
    // "click the active button" means. We only assert that the hook
    // surface (`onThemeChange`) is wired, and not double-fired.
    expect(onThemeChange).toHaveBeenCalledTimes(1);
    expect(onThemeChange).toHaveBeenCalledWith("light");
  });
});
