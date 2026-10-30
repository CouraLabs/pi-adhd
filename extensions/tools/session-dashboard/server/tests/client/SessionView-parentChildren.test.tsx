// @vitest-environment happy-dom
// tests/client/SessionView-parentChildren.test.tsx
//
// Parent↔child affordances on the session detail view (step 9):
//   - the "← Parent" button near the title when the session has a parent
//     (resolved from an `agent-xpto-parent` branch marker first, falling back
//     to `detail.header.parentSession`)
//   - the "Spawned subagent sessions" section listing child session ids,
//     loaded async via listChildren (404 → no children; other errors → a
//     muted non-blocking line)

import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, waitFor } from "@testing-library/react";
import { SessionView } from "../../src/views/SessionView";
import { renderWithRouter } from "./helpers/renderWithRouter";
import { ApiError } from "../../src/api";
import type { SessionDetail, SessionEntry } from "../../src/types";

// ---- Fixtures ----

function userEntry(id: string, text: string): SessionEntry {
  return {
    type: "message",
    id,
    parentId: null,
    timestamp: "2026-01-01T00:00:00.000Z",
    message: {
      role: "user",
      content: [{ type: "text", text }],
      timestamp: 0,
    },
  };
}

function parentMarkerEntry(parentSessionId: string): SessionEntry {
  return {
    type: "custom",
    id: "marker-1",
    parentId: null,
    timestamp: "2026-01-01T00:00:00.000Z",
    customType: "agent-xpto-parent",
    data: {
      parentSessionId,
      parentSessionFile: "parent-session.jsonl",
      runId: "run-1",
      targetAgentId: "subagent-1",
      timestamp: "2026-01-01T00:00:00.000Z",
    },
  };
}

interface BuildDetailOpts {
  /** Emit an agent-xpto-parent branch marker with this parent id. */
  parentMarker?: string;
  /** Set detail.header.parentSession (the older header mechanism). */
  headerParent?: string;
}

/**
 * Build a SessionDetail in the wire (leaf-first) format. A real child
 * session writes the parent marker near the file start, so in leaf-first
 * order the marker lives at the END of the branch (oldest side).
 */
function buildDetail(opts: BuildDetailOpts = {}): SessionDetail {
  const oldestFirst: SessionEntry[] = [];
  if (opts.parentMarker) oldestFirst.push(parentMarkerEntry(opts.parentMarker));
  oldestFirst.push(userEntry("u1", "hello"));
  const branch = oldestFirst.slice().reverse();
  return {
    header: {
      id: "child-1",
      version: 3,
      timestamp: "2026-01-01T00:00:00.000Z",
      cwd: "/tmp/child",
      ...(opts.headerParent ? { parentSession: opts.headerParent } : {}),
    },
    branch,
    totalEntries: branch.length,
  };
}

// ---- Mocks ----

const getSessionMock = vi.fn();
const listChildrenMock = vi.fn();

vi.mock("../../src/api", async () => {
  const actual =
    await vi.importActual<typeof import("../../src/api")>("../../src/api");
  return {
    ...actual,
    getSession: (...args: unknown[]): Promise<SessionDetail> =>
      getSessionMock(...args) as Promise<SessionDetail>,
    listChildren: (...args: unknown[]): Promise<string[]> =>
      listChildrenMock(...args) as Promise<string[]>,
    streamUrl: () => "/api/sessions/x/stream",
  };
});

// Captured handlers from useEventSource so tests can simulate SSE entries
// (e.g. a parent marker streaming in after the initial fetch).
type EventHandler = (data: unknown) => void;
const entryHandlers: EventHandler[] = [];

vi.mock("../../src/lib/useEventSource", () => {
  return {
    useEventSource: () => ({
      on: (event: string, handler: EventHandler): void => {
        if (event === "entry") entryHandlers.push(handler);
      },
      close: () => undefined,
    }),
  };
});

const noop = (): void => undefined;
const noopTheme = (): void => undefined;

function renderView(sessionId: string, onNavigate: (id: string) => void) {
  return renderWithRouter(
    <SessionView
      sessionId={sessionId}
      onBack={noop}
      onNavigate={onNavigate}
      theme="dark"
      onThemeChange={noopTheme}
    />,
  );
}

beforeEach(() => {
  entryHandlers.length = 0;
  getSessionMock.mockReset();
  listChildrenMock.mockReset();
  getSessionMock.mockResolvedValue(buildDetail());
  listChildrenMock.mockResolvedValue([]);
});

// ---- Tests ----

describe("SessionView parent link", () => {
  it("renders a ← Parent button when the branch contains an agent-xpto-parent marker", async () => {
    getSessionMock.mockReset();
    getSessionMock.mockResolvedValueOnce(
      buildDetail({ parentMarker: "parent-123" }),
    );
    const onNavigate = vi.fn();
    const { container } = renderView("child-1", onNavigate);
    await waitFor(() => {
      expect(container.querySelector(".session-parent-link")).not.toBeNull();
    });
    const link = container.querySelector<HTMLButtonElement>(
      ".session-parent-link",
    );
    expect(link?.textContent).toContain("← Parent");
    expect(link?.getAttribute("aria-label")).toBe(
      "Open parent session parent-123",
    );
  });

  it("does NOT render ← Parent when there is no marker and header.parentSession is unset", async () => {
    getSessionMock.mockReset();
    getSessionMock.mockResolvedValueOnce(buildDetail());
    const onNavigate = vi.fn();
    const { container } = renderView("child-1", onNavigate);
    await waitFor(() => {
      expect(container.querySelector(".session-title")).not.toBeNull();
    });
    expect(container.querySelector(".session-parent-link")).toBeNull();
  });

  it("falls back to header.parentSession when no branch marker exists", async () => {
    getSessionMock.mockReset();
    getSessionMock.mockResolvedValueOnce(
      buildDetail({ headerParent: "header-parent-1" }),
    );
    const onNavigate = vi.fn();
    const { container } = renderView("child-1", onNavigate);
    await waitFor(() => {
      expect(container.querySelector(".session-parent-link")).not.toBeNull();
    });
    const link = container.querySelector<HTMLButtonElement>(
      ".session-parent-link",
    );
    expect(link?.getAttribute("aria-label")).toBe(
      "Open parent session header-parent-1",
    );
  });

  it("prefers the branch marker over the header fallback", async () => {
    getSessionMock.mockReset();
    getSessionMock.mockResolvedValueOnce(
      buildDetail({ parentMarker: "marker-parent", headerParent: "header-parent" }),
    );
    const onNavigate = vi.fn();
    const { container } = renderView("child-1", onNavigate);
    await waitFor(() => {
      expect(container.querySelector(".session-parent-link")).not.toBeNull();
    });
    const link = container.querySelector<HTMLButtonElement>(
      ".session-parent-link",
    );
    expect(link?.getAttribute("aria-label")).toBe(
      "Open parent session marker-parent",
    );
  });

  it("clicking ← Parent calls onNavigate with the parent id", async () => {
    getSessionMock.mockReset();
    getSessionMock.mockResolvedValueOnce(
      buildDetail({ parentMarker: "parent-123" }),
    );
    const onNavigate = vi.fn();
    const { container } = renderView("child-1", onNavigate);
    await waitFor(() => {
      expect(container.querySelector(".session-parent-link")).not.toBeNull();
    });
    fireEvent.click(
      container.querySelector<HTMLButtonElement>(".session-parent-link")!,
    );
    expect(onNavigate).toHaveBeenCalledTimes(1);
    expect(onNavigate).toHaveBeenCalledWith("parent-123");
  });

  it("recomputes the parent when a marker streams in after the initial fetch (SSE prepend)", async () => {
    getSessionMock.mockReset();
    getSessionMock.mockResolvedValueOnce(buildDetail());
    const onNavigate = vi.fn();
    const { container } = renderView("child-1", onNavigate);
    await waitFor(() => {
      expect(container.querySelector(".session-title")).not.toBeNull();
    });
    expect(container.querySelector(".session-parent-link")).toBeNull();

    // Simulate an SSE entry: the parent marker prepends to branch state.
    // The server wraps each entry in a `{ entry, stats }` envelope.
    for (const h of entryHandlers) h({ entry: parentMarkerEntry("late-parent") });

    await waitFor(() => {
      expect(container.querySelector(".session-parent-link")).not.toBeNull();
    });
    const link = container.querySelector<HTMLButtonElement>(
      ".session-parent-link",
    );
    expect(link?.getAttribute("aria-label")).toBe(
      "Open parent session late-parent",
    );
  });
});

describe("SessionView children section", () => {
  it("renders the children section with one button per child", async () => {
    listChildrenMock.mockResolvedValueOnce([
      "child-session-aaa",
      "child-session-bbb",
    ]);
    const onNavigate = vi.fn();
    const { container } = renderView("parent-1", onNavigate);
    await waitFor(() => {
      expect(container.querySelectorAll(".session-children-item").length).toBe(
        2,
      );
    });
    expect(container.textContent).toContain("Spawned subagent sessions");
    const items = Array.from(
      container.querySelectorAll(".session-children-item"),
    );
    expect(items[0]?.textContent).toContain(
      "child-session-aaa".slice(0, 8),
    );
    expect(items[1]?.textContent).toContain(
      "child-session-bbb".slice(0, 8),
    );
  });

  it("hides the children section when there are 0 children", async () => {
    listChildrenMock.mockResolvedValueOnce([]);
    const onNavigate = vi.fn();
    const { container } = renderView("solo-1", onNavigate);
    await waitFor(() => {
      expect(listChildrenMock).toHaveBeenCalled();
    });
    expect(container.querySelector(".session-children-section")).toBeNull();
    expect(container.querySelector(".session-children-item")).toBeNull();
    expect(container.textContent).not.toContain("Spawned subagent sessions");
  });

  it("treats a 404 from listChildren as no children (no error line)", async () => {
    listChildrenMock.mockRejectedValueOnce(new ApiError("Not found", 404));
    const onNavigate = vi.fn();
    const { container } = renderView("unknown-1", onNavigate);
    await waitFor(() => {
      expect(listChildrenMock).toHaveBeenCalledTimes(1);
    });
    expect(container.querySelector(".session-children-section")).toBeNull();
    expect(container.querySelector(".session-children-error")).toBeNull();
    expect(container.textContent).not.toContain("Could not load children");
  });

  it("renders a muted error line when listChildren fails for other reasons", async () => {
    listChildrenMock.mockRejectedValueOnce(new Error("boom"));
    const onNavigate = vi.fn();
    const { container } = renderView("parent-1", onNavigate);
    await waitFor(() => {
      expect(container.querySelector(".session-children-error")).not.toBeNull();
    });
    expect(container.textContent).toContain("Could not load children");
    // The rest of the view stays interactive.
    expect(container.querySelector(".session-scroll")).not.toBeNull();
  });

  it("clicking a child button calls onNavigate with the child id", async () => {
    listChildrenMock.mockResolvedValueOnce(["child-session-ccc"]);
    const onNavigate = vi.fn();
    const { container } = renderView("parent-1", onNavigate);
    await waitFor(() => {
      expect(container.querySelector(".session-children-item")).not.toBeNull();
    });
    fireEvent.click(
      container.querySelector<HTMLButtonElement>(".session-children-item")!,
    );
    expect(onNavigate).toHaveBeenCalledTimes(1);
    expect(onNavigate).toHaveBeenCalledWith("child-session-ccc");
  });
});