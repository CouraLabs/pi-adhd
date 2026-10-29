// @vitest-environment happy-dom
// tests/client/SessionListView-parentChildren.test.tsx
//
// Parent↔child relationship affordances on session list cards (step 8):
//   - a parent-bearing card renders an "↑ parent" link that navigates via
//     onNavigate without also triggering the card's own onClick
//   - child counts load lazily via listChildren and render as a badge only
//     when > 0 (0/unknown/failed => no badge)

import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, waitFor } from "@testing-library/react";
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
  extra: Partial<SessionListItem> = {},
): SessionListItem {
  return {
    id,
    cwd: `/tmp/${id}`,
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

describe("SessionListView parent/children affordances", () => {
  it("renders a parent link exposing the parent id in the aria-label", async () => {
    listSessionsMock.mockResolvedValueOnce([
      makeSession("child-1", { parentSession: "parent-1" }),
    ]);
    const onNavigate = vi.fn();
    const { container } = renderWithRouter(
      <SessionListView
        onNavigate={onNavigate}
        theme="dark"
        onThemeChange={noopTheme}
      />,
    );
    await waitFor(() => {
      expect(
        container.querySelector(".session-card-parent-link"),
      ).not.toBeNull();
    });
    const link = container.querySelector<HTMLButtonElement>(
      ".session-card-parent-link",
    );
    expect(link?.getAttribute("aria-label")).toBe(
      "Open parent session parent-1",
    );
    expect(link?.textContent).toContain("↑ parent");
  });

  it("clicking the parent link navigates to the parent, not the card's own id", async () => {
    listSessionsMock.mockResolvedValueOnce([
      makeSession("child-1", { parentSession: "parent-1" }),
    ]);
    const onNavigate = vi.fn();
    const { container } = renderWithRouter(
      <SessionListView
        onNavigate={onNavigate}
        theme="dark"
        onThemeChange={noopTheme}
      />,
    );
    await waitFor(() => {
      expect(
        container.querySelector(".session-card-parent-link"),
      ).not.toBeNull();
    });
    const link = container.querySelector<HTMLButtonElement>(
      ".session-card-parent-link",
    )!;
    fireEvent.click(link);
    expect(onNavigate).toHaveBeenCalledTimes(1);
    expect(onNavigate).toHaveBeenCalledWith("parent-1");
    expect(onNavigate).not.toHaveBeenCalledWith("child-1");
  });

  it("keyboard keydown on the parent link does not trigger the card's own navigation; the click still navigates to the parent", async () => {
    listSessionsMock.mockResolvedValueOnce([
      makeSession("child-1", { parentSession: "parent-1" }),
    ]);
    const onNavigate = vi.fn();
    const { container } = renderWithRouter(
      <SessionListView
        onNavigate={onNavigate}
        theme="dark"
        onThemeChange={noopTheme}
      />,
    );
    await waitFor(() => {
      expect(
        container.querySelector(".session-card-parent-link"),
      ).not.toBeNull();
    });
    const link = container.querySelector<HTMLButtonElement>(
      ".session-card-parent-link",
    )!;
    link.focus();
    // Enter on the focused button must not bubble to the card's key handler.
    fireEvent.keyDown(link, { key: "Enter" });
    expect(onNavigate).not.toHaveBeenCalled();
    // Native buttons emit a click on Enter/Space — that click is what
    // navigates, and it must only go to the parent.
    fireEvent.click(link);
    expect(onNavigate).toHaveBeenCalledTimes(1);
    expect(onNavigate).toHaveBeenCalledWith("parent-1");
  });

  it("renders a children badge with the count once listChildren resolves", async () => {
    listSessionsMock.mockResolvedValueOnce([
      makeSession("parent-1", { parentSession: "grand-1" }),
    ]);
    listChildrenMock.mockResolvedValueOnce(["c1", "c2", "c3"]);
    const onNavigate = vi.fn();
    const { container } = renderWithRouter(
      <SessionListView
        onNavigate={onNavigate}
        theme="dark"
        onThemeChange={noopTheme}
      />,
    );
    await waitFor(() => {
      expect(
        container.querySelector(".session-card-children-badge"),
      ).not.toBeNull();
    });
    const badge = container.querySelector(".session-card-children-badge");
    expect(badge?.textContent).toContain("3");
  });

  it("shows no parent link or children badge for a session with neither, and no badge when a parent has zero children", async () => {
    listSessionsMock.mockResolvedValueOnce([
      makeSession("solo-1"),
      makeSession("parent-1", { parentSession: "grand-1" }),
    ]);
    listChildrenMock.mockResolvedValueOnce([]);
    const onNavigate = vi.fn();
    const { container } = renderWithRouter(
      <SessionListView
        onNavigate={onNavigate}
        theme="dark"
        onThemeChange={noopTheme}
      />,
    );
    await waitFor(() => {
      expect(container.querySelectorAll(".session-card").length).toBe(2);
    });
    // Only the parent-bearing session is queried for children.
    await waitFor(() => {
      expect(listChildrenMock).toHaveBeenCalledTimes(1);
      expect(listChildrenMock).toHaveBeenCalledWith("parent-1");
    });
    expect(
      container.querySelectorAll(".session-card-children-badge").length,
    ).toBe(0);
    const solo = Array.from(container.querySelectorAll(".session-card")).find(
      (el) => el.textContent?.includes("/tmp/solo-1"),
    );
    expect(solo?.querySelector(".session-card-parent-link")).toBeNull();
    expect(solo?.querySelector(".session-card-children-badge")).toBeNull();
    const parent = Array.from(container.querySelectorAll(".session-card")).find(
      (el) => el.textContent?.includes("/tmp/parent-1"),
    );
    // The parent-bearing card still shows its parent link even though it has
    // zero children of its own.
    expect(parent?.querySelector(".session-card-parent-link")).not.toBeNull();
    expect(parent?.querySelector(".session-card-children-badge")).toBeNull();
  });

  it("ignores failed listChildren calls and still renders the parent link", async () => {
    listSessionsMock.mockResolvedValueOnce([
      makeSession("child-1", { parentSession: "parent-1" }),
    ]);
    listChildrenMock.mockRejectedValueOnce(new Error("boom"));
    const onNavigate = vi.fn();
    const { container } = renderWithRouter(
      <SessionListView
        onNavigate={onNavigate}
        theme="dark"
        onThemeChange={noopTheme}
      />,
    );
    await waitFor(() => {
      expect(listChildrenMock).toHaveBeenCalledTimes(1);
    });
    // The view stays interactive; the parent link remains the affordance and
    // no badge appears (count unknown).
    expect(container.querySelector(".session-card-parent-link")).not.toBeNull();
    expect(
      container.querySelectorAll(".session-card-children-badge").length,
    ).toBe(0);
    fireEvent.click(
      container.querySelector<HTMLButtonElement>(
        ".session-card-parent-link",
      )!,
    );
    expect(onNavigate).toHaveBeenCalledWith("parent-1");
  });
});