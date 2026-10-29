// src/components/SettingsPanel.tsx
import { useEffect, useRef, useState } from "react";
import type { Theme } from "../lib/useTheme";
import { MIN_FONT_SIZE, MAX_FONT_SIZE, FONT_SIZE_STEP } from "../lib/useFontSize";

export interface SettingsPanelProps {
  streamingEnabled: boolean;
  onStreamingChange: (next: boolean) => void;
  autoScrollEnabled: boolean;
  onAutoScrollChange: (next: boolean) => void;
  theme: Theme;
  onThemeChange: (next: Theme) => void;
  fontSize: number;
  onFontSizeChange: (next: number) => void;
}

export function SettingsPanel({
  streamingEnabled,
  onStreamingChange,
  autoScrollEnabled,
  onAutoScrollChange,
  theme,
  onThemeChange,
  fontSize,
  onFontSizeChange,
}: SettingsPanelProps): JSX.Element {
  const [open, setOpen] = useState(false);
  const popoverRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent): void => {
      const target = e.target as Node | null;
      if (popoverRef.current && target && !popoverRef.current.contains(target)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onDocClick);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
    };
  }, [open]);

  return (
    <div className="settings-panel" ref={popoverRef}>
      {open ? (
        <div className="settings-popover" role="dialog" aria-label="settings">
          <label className="settings-row">
            <input
              type="checkbox"
              checked={streamingEnabled}
              onChange={(e) => onStreamingChange(e.target.checked)}
            />
            <span>Auto update</span>
          </label>
          <label className="settings-row">
            <input
              type="checkbox"
              checked={autoScrollEnabled}
              onChange={(e) => onAutoScrollChange(e.target.checked)}
            />
            <span>Auto scroll</span>
          </label>
          <div className="settings-row">
            <span>Font size</span>
            <div className="settings-segmented" role="group" aria-label="font size">
              <button
                type="button"
                className="settings-segmented-button"
                onClick={() => onFontSizeChange(fontSize - FONT_SIZE_STEP)}
                disabled={fontSize <= MIN_FONT_SIZE}
                aria-label="decrease font size"
              >
                −
              </button>
              <span className="settings-font-size-value" aria-live="polite">
                {fontSize}
              </span>
              <button
                type="button"
                className="settings-segmented-button"
                onClick={() => onFontSizeChange(fontSize + FONT_SIZE_STEP)}
                disabled={fontSize >= MAX_FONT_SIZE}
                aria-label="increase font size"
              >
                +
              </button>
            </div>
          </div>
          <div className="settings-row">
            <span>Theme</span>
            <div className="settings-segmented" role="group" aria-label="theme">
              <button
                type="button"
                aria-pressed={theme === "dark"}
                className={`settings-segmented-button ${theme === "dark" ? "is-active" : ""}`}
                onClick={() => onThemeChange("dark")}
              >
                Dark
              </button>
              <button
                type="button"
                aria-pressed={theme === "light"}
                className={`settings-segmented-button ${theme === "light" ? "is-active" : ""}`}
                onClick={() => onThemeChange("light")}
              >
                Light
              </button>
            </div>
          </div>
        </div>
      ) : null}
      <button
        className="settings-button"
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="settings"
        aria-expanded={open}
        title="Settings"
      >
        ⚙
      </button>
    </div>
  );
}
