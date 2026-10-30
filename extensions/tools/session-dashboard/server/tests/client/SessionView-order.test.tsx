// @vitest-environment happy-dom
// tests/client/SessionView-order.test.tsx
//
// Regression test for the "chat upside down" bug.
//
// The server's walkActiveBranch() returns `branch` LEAF-FIRST (newest at
// index 0, oldest at the end). The frontend used to render the array in
// array order, which placed the newest message at the TOP of the viewport.
// This test pins down the correct behavior:
//   - In the rendered DOM, the OLDEST entry appears FIRST (top of viewport).
//   - The NEWEST entry appears LAST (bottom of viewport).

import { describe, expect, it, vi, beforeEach } from "vitest";
import { waitFor } from "@testing-library/react";
import { SessionView } from "../../src/views/SessionView";
import { renderWithRouter } from "./helpers/renderWithRouter";
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

function assistantEntry(id: string, text: string): SessionEntry {
  return {
    type: "message",
    id,
    parentId: null,
    timestamp: "2026-01-01T00:00:00.000Z",
    message: {
      role: "assistant",
      content: [{ type: "text", text }],
      timestamp: 0,
    },
  };
}

/**
 * Build a SessionDetail with 5 messages, in the wire (leaf-first) format:
 *   branch[0] = NEWEST (leaf)
 *   branch[4] = OLDEST (root)
 *
 * Distinct text per message so the DOM order can be asserted unambiguously.
 */
function buildDetail(): SessionDetail {
  const oldest = userEntry("msg-1", "OLDEST-USER");
  const midA = assistantEntry("msg-2", "MIDDLE-ASSISTANT-1");
  const midU = userEntry("msg-3", "MIDDLE-USER");
  const midA2 = assistantEntry("msg-4", "MIDDLE-ASSISTANT-2");
  const newest = userEntry("msg-5", "NEWEST-USER");

  const branch: SessionEntry[] = [newest, midA2, midU, midA, oldest];

  return {
    header: {
      id: "session-abc",
      version: 3,
      timestamp: "2026-01-01T00:00:00.000Z",
      cwd: "/tmp/test",
    },
    branch,
    totalEntries: branch.length,
  };
}

// ---- Mocks ----

const getSessionMock = vi.fn();

vi.mock("../../src/api", async () => {
  const actual = await vi.importActual<typeof import("../../src/api")>("../../src/api");
  return {
    ...actual,
    getSession: (...args: unknown[]): Promise<SessionDetail> =>
      getSessionMock(...args) as Promise<SessionDetail>,
    streamUrl: () => "/api/sessions/x/stream",
  };
});

vi.mock("../../src/lib/useEventSource", () => {
  return {
    useEventSource: () => ({
      on: () => undefined,
      close: () => undefined,
    }),
  };
});

// ---- Helpers ----

/** Returns the rendered elements in document order (top-to-bottom). */
function sortedByDocumentOrder(els: Element[]): Element[] {
  return [...els].sort((a, b) => {
    const pos = a.compareDocumentPosition(b);
    if (pos & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
    if (pos & Node.DOCUMENT_POSITION_PRECEDING) return 1;
    return 0;
  });
}

// ---- Tests ----

describe("SessionView display order (regression: chat upside down)", () => {
  beforeEach(() => {
    getSessionMock.mockReset();
    getSessionMock.mockResolvedValue(buildDetail());
  });

  it("renders the branch with OLDEST at the TOP and NEWEST at the BOTTOM", async () => {
    const noop = (): void => undefined;
    const { container } = renderWithRouter(
      <SessionView sessionId="session-abc" onBack={noop} />,
    );

    // Wait for the initial fetch to populate state.
    await waitFor(() => {
      expect(container.querySelectorAll(".message-user").length).toBe(3);
    });

    // All five messages should now be in the DOM (3 user + 2 assistant).
    const userEls = Array.from(container.querySelectorAll(".message-user"));
    const assistantEls = Array.from(container.querySelectorAll(".message-assistant"));
    expect(userEls).toHaveLength(3);
    expect(assistantEls).toHaveLength(2);

    const all = sortedByDocumentOrder([...userEls, ...assistantEls]);

    const orderTexts = all.map((el) => el.textContent ?? "");
    // Expected top-to-bottom: OLDEST-USER, MIDDLE-ASSISTANT-1,
    // MIDDLE-USER, MIDDLE-ASSISTANT-2, NEWEST-USER.
    expect(orderTexts).toEqual([
      expect.stringContaining("OLDEST-USER"),
      expect.stringContaining("MIDDLE-ASSISTANT-1"),
      expect.stringContaining("MIDDLE-USER"),
      expect.stringContaining("MIDDLE-ASSISTANT-2"),
      expect.stringContaining("NEWEST-USER"),
    ]);

    // Be extra explicit: branch[0] (the leaf = NEWEST) is LAST in DOM.
    const last = all[all.length - 1];
    expect(last.textContent ?? "").toContain("NEWEST-USER");

    // And branch[last] (the root = OLDEST) is FIRST in DOM.
    const first = all[0];
    expect(first.textContent ?? "").toContain("OLDEST-USER");
  });

  it("uses stable, distinct React keys derived from entry id (5 direct children)", async () => {
    // The original `key={idx}` would collide when an entry was inserted at
    // index 0 via SSE prepend. We now use entry.id, and the rendered
    // children count should match the branch length.
    const noop = (): void => undefined;
    const { container } = renderWithRouter(
      <SessionView sessionId="session-abc" onBack={noop} />,
    );
    await waitFor(() => {
      expect(container.querySelectorAll(".message-user").length).toBe(3);
    });
    expect(container.querySelectorAll(".session-entries > *").length).toBe(5);
  });
});
