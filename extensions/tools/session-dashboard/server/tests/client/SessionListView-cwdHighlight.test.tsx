// @vitest-environment happy-dom
// tests/client/SessionListView-cwdHighlight.test.tsx
//
// Verify that the last folder name in the cwd path is highlighted on each
// session card so the workspace is easier to scan across the list.

import { describe, expect, it, vi, beforeEach } from "vitest";
import { SessionListView } from "../../src/views/SessionListView";
import { renderWithRouter } from "./helpers/renderWithRouter";
import type { SessionListItem } from "../../src/types";

const listSessionsMock = vi.fn();
const listChildrenMock = vi.fn();

vi.mock("../../src/api", async () => {
  const actual =
    await vi.importActual<typeof import("../../src/api")>("../../src/api");
  return {
    ...actual,
    listSessions: (...args: unknown[]) =>
      listSessionsMock(...args) as Promise<SessionListItem[]>,
    listChildren: (...args: unknown[]) =>
      listChildrenMock(...args) as Promise<string[]>,
  };
});

function makeSession(
  id: string,
  cwd: string,
  extra: Partial<SessionListItem> = {},
): SessionListItem {
  return {
    id,
    cwd,
    name: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    lastActivity: "2026-01-01T00:00:00.000Z",
    messageCount: 3,
    sizeBytes: 1024,
    preview: `preview of ${id}`,
    ...extra,
  };
}

const noopTheme = (): void => undefined;

beforeEach(() => {
  listSessionsMock.mockReset();
  listChildrenMock.mockReset();
  listSessionsMock.mockResolvedValue([]);
  listChildrenMock.mockResolvedValue([]);
});

describe("SessionListView cwd highlight", () => {
  it("highlights the leaf folder for a deep path", async () => {
    listSessionsMock.mockResolvedValueOnce([
      makeSession("a", "/Users/daniel/temp"),
    ]);

    const { container } = renderWithRouter(
      <SessionListView
        onNavigate={() => {}}
        theme="dark"
        onThemeChange={noopTheme}
      />,
    );

    // Wait for the list to render.
    await vi.waitFor(() => {
      expect(container.querySelector(".session-card")).not.toBeNull();
    });

    const last = container.querySelector(".session-card-cwd-last");
    expect(last).not.toBeNull();
    expect(last?.textContent).toBe("temp");

    // The prefix is preserved before the highlighted span.
    const cwd = container.querySelector(".session-card-cwd");
    expect(cwd?.textContent).toContain("…/daniel/");
    expect(cwd?.textContent).toContain("temp");
  });

  it("highlights the only segment of a short path", async () => {
    listSessionsMock.mockResolvedValueOnce([
      makeSession("a", "/tmp"),
    ]);

    const { container } = renderWithRouter(
      <SessionListView
        onNavigate={() => {}}
        theme="dark"
        onThemeChange={noopTheme}
      />,
    );

    await vi.waitFor(() => {
      expect(container.querySelector(".session-card")).not.toBeNull();
    });

    const last = container.querySelector(".session-card-cwd-last");
    expect(last).not.toBeNull();
    expect(last?.textContent).toBe("tmp");
  });

  it("renders the last segment in its own span with a distinct class", async () => {
    listSessionsMock.mockResolvedValueOnce([
      makeSession("a", "/Users/daniel/temp"),
    ]);

    const { container } = renderWithRouter(
      <SessionListView
        onNavigate={() => {}}
        theme="dark"
        onThemeChange={noopTheme}
      />,
    );

    await vi.waitFor(() => {
      expect(container.querySelector(".session-card")).not.toBeNull();
    });

    // There is exactly one .session-card-cwd-last per card, and it's a
    // distinct child of .session-card-cwd (so styling can target it).
    const last = container.querySelectorAll(".session-card-cwd-last");
    expect(last.length).toBe(1);
    const cwd = container.querySelector(".session-card-cwd");
    expect(cwd?.contains(last[0])).toBe(true);
  });
});
