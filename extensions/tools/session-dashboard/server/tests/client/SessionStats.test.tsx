// @vitest-environment happy-dom
// tests/client/SessionStats.test.tsx
//
// Tests for the session-stats strip in SessionView (detail route only):
//   1. All 11 chips render from a fully-populated `detail.stats`.
//   2. The strip never renders in SessionListView (list route).
//   3. An SSE `entry` envelope (`{ entry, stats }`) updates the chips live.

import { describe, expect, it, vi, beforeEach } from "vitest";
import { waitFor } from "@testing-library/react";
import { SessionView } from "../../src/views/SessionView";
import { SessionListView } from "../../src/views/SessionListView";
import { renderWithRouter } from "./helpers/renderWithRouter";
import type {
  SessionDetail,
  SessionEntry,
  SessionListItem,
  SessionStats,
} from "../../src/types";

// ---- Fixtures ----

function fullStats(): SessionStats {
  return {
    latestContextTokens: 150,
    totalInputTokens: 12345,
    totalOutputTokens: 1200,
    turns: 12,
    toolCalls: 38,
    agentCalls: 5,
    compactions: 2,
    lastTimestamp: "2026-01-01T00:02:13.133Z",
    firstTimestamp: "2026-01-01T00:00:00.000Z",
    latestModel: { model: "MiniMax-M3", turns: 12 },
    cacheHitPercent: 45,
  };
}

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

function assistantEntry(id: string, text: string): SessionEntry {
  return {
    type: "message",
    id,
    parentId: null,
    timestamp: "2026-01-01T00:02:13.133Z",
    message: {
      role: "assistant",
      content: [{ type: "text", text }],
      timestamp: 0,
    },
  };
}

function buildDetail(overrides: Partial<SessionStats> = {}): SessionDetail {
  return {
    header: {
      id: "session-stats",
      version: 3,
      timestamp: "2026-01-01T00:00:00.000Z",
      cwd: "/tmp/stats-test",
    },
    branch: [assistantEntry("a1", "ASSISTANT-ONE"), userEntry("u1", "USER-ONE")],
    totalEntries: 2,
    stats: { ...fullStats(), ...overrides },
  };
}

// ---- Mocks ----

const getSessionMock = vi.fn();
const listSessionsMock = vi.fn();
const listChildrenMock = vi.fn();

vi.mock("../../src/api", async () => {
  const actual =
    await vi.importActual<typeof import("../../src/api")>("../../src/api");
  return {
    ...actual,
    getSession: (...args: unknown[]): Promise<SessionDetail> =>
      getSessionMock(...args) as Promise<SessionDetail>,
    listSessions: (...args: unknown[]): Promise<SessionListItem[]> =>
      listSessionsMock(...args) as Promise<SessionListItem[]>,
    listChildren: (...args: unknown[]): Promise<string[]> =>
      listChildrenMock(...args) as Promise<string[]>,
    streamUrl: () => "/api/sessions/x/stream",
  };
});

// Captured handlers from useEventSource so tests can simulate SSE events.
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

// ---- Helpers ----

/** Look up a stats chip by its (lowercased) label and return its value. */
function statValue(container: HTMLElement, label: string): string | null {
  for (const chip of container.querySelectorAll(".session-stat")) {
    const l = chip.querySelector(".session-stat-label")?.textContent ?? "";
    if (l === label) {
      return chip.querySelector(".session-stat-value")?.textContent ?? null;
    }
  }
  return null;
}

function expectStat(container: HTMLElement, label: string, value: string): void {
  expect(statValue(container, label)).toBe(value);
}

const noop = (): void => undefined;
const noopTheme = (): void => undefined;

beforeEach(() => {
  entryHandlers.length = 0;
  getSessionMock.mockReset();
  getSessionMock.mockResolvedValue(buildDetail());
  listSessionsMock.mockReset();
  listSessionsMock.mockResolvedValue([]);
  listChildrenMock.mockReset();
  listChildrenMock.mockResolvedValue([]);
});

// ---- Tests ----

describe("SessionView stats strip", () => {
  it("renders all 11 chips when detail.stats is fully populated", async () => {
    const { container } = renderWithRouter(
      <SessionView sessionId="session-stats" onBack={noop} />,
    );
    await waitFor(() => {
      expect(container.querySelector(".session-stats")).not.toBeNull();
    });

    // Same environment → same locale formatting.
    const started = new Date("2026-01-01T00:00:00.000Z").toLocaleString();
    const lastEntry = new Date("2026-01-01T00:02:13.133Z").toLocaleString();

    expectStat(container, "context", "150 tokens");
    expectStat(container, "in", "12.3k");
    expectStat(container, "out", "1.2k");
    expectStat(container, "turns", "12");
    expectStat(container, "tools", "38");
    expectStat(container, "agents", "5");
    expectStat(container, "compactions", "2");
    expectStat(container, "CH", "45%");
    // 133.133s → "2m 13s".
    expectStat(container, "duration", "2m 13s");
    expectStat(container, "started", started);
    expectStat(container, "last entry", lastEntry);
    expectStat(container, "model", "MiniMax-M3 x12");

    // Tooltips carry the unformatted underlying values.
    const contextChip = Array.from(
      container.querySelectorAll(".session-stat"),
    ).find((c) => c.querySelector(".session-stat-label")?.textContent === "context");
    expect(contextChip?.getAttribute("title")).toBe("150");
  });

  it("hides the model chip when latestModel is null", async () => {
    getSessionMock.mockReset();
    getSessionMock.mockResolvedValue(buildDetail({ latestModel: null }));
    const { container } = renderWithRouter(
      <SessionView sessionId="session-stats" onBack={noop} />,
    );
    await waitFor(() => {
      expect(container.querySelector(".session-stats")).not.toBeNull();
    });
    expect(statValue(container, "model")).toBeNull();
    // The rest of the row is still there.
    expectStat(container, "turns", "12");
  });

  it("updates the chips when an SSE entry envelope arrives", async () => {
    getSessionMock.mockReset();
    // 3 turns before the SSE event.
    getSessionMock.mockResolvedValue(buildDetail({ turns: 3 }));
    const { container } = renderWithRouter(
      <SessionView sessionId="session-stats" onBack={noop} />,
    );
    await waitFor(() => {
      expect(container.querySelector(".session-stats")).not.toBeNull();
    });
    expectStat(container, "turns", "3");

    // Fire an SSE `entry` event with the new `{ entry, stats }` envelope.
    const envelope = {
      entry: assistantEntry("sse-a1", "SSE-ASSISTANT"),
      stats: { ...fullStats(), turns: 4 },
    };
    for (const h of entryHandlers) h(envelope);

    await waitFor(() => {
      expectStat(container, "turns", "4");
    });
    // Other chips update from the same envelope too.
    expectStat(container, "tools", "38");
    expectStat(container, "model", "MiniMax-M3 x12");
  });
});

describe("SessionListView stats strip", () => {
  it("does NOT render .session-stats on the list view", async () => {
    listSessionsMock.mockResolvedValueOnce([
      {
        id: "a",
        cwd: "/tmp/stats-test",
        name: null,
        createdAt: "2026-01-01T00:00:00.000Z",
        lastActivity: "2026-01-01T00:02:13.133Z",
        messageCount: 12,
        sizeBytes: 1024,
        preview: "preview",
      },
    ]);
    const { container } = renderWithRouter(
      <SessionListView
        onNavigate={noop}
        theme="dark"
        onThemeChange={noopTheme}
      />,
    );
    await waitFor(() => {
      expect(container.querySelector(".session-card")).not.toBeNull();
    });
    expect(container.querySelector(".session-stats")).toBeNull();
    expect(container.querySelector('[data-testid="session-stats"]')).toBeNull();
  });
});
