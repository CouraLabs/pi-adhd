// @vitest-environment happy-dom
// tests/client/SessionView-filters.test.tsx
//
// Integration tests for the FilterBar in SessionView: filter toggles hide
// and reveal entries without disturbing display order, and SSE-arrived
// entries are visible when their filter matches.

import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, waitFor } from "@testing-library/react";
import { SessionView } from "../../src/views/SessionView";
import { renderWithRouter } from "./helpers/renderWithRouter";
import type { SessionDetail, SessionEntry } from "../../src/types";
import { DEFAULT_FILTERS } from "../../src/lib/filters";

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

function toolResultEntry(id: string, text: string): SessionEntry {
  return {
    type: "message",
    id,
    parentId: null,
    timestamp: "2026-01-01T00:00:00.000Z",
    message: {
      role: "toolResult",
      toolCallId: "call_1",
      toolName: "read",
      content: [{ type: "text", text }],
      isError: false,
      timestamp: 0,
    },
  };
}

function bashToolResultEntry(id: string, text: string): SessionEntry {
  return {
    type: "message",
    id,
    parentId: null,
    timestamp: "2026-01-01T00:00:00.000Z",
    message: {
      role: "toolResult",
      toolCallId: "call_bash",
      toolName: "bash",
      content: [{ type: "text", text }],
      isError: false,
      timestamp: 0,
    },
  };
}

function assistantWithThinkingEntry(
  id: string,
  text: string,
  thinking: string,
): SessionEntry {
  return {
    type: "message",
    id,
    parentId: null,
    timestamp: "2026-01-01T00:00:00.000Z",
    message: {
      role: "assistant",
      content: [
        { type: "text", text },
        { type: "thinking", thinking },
      ],
      timestamp: 0,
    },
  };
}

function bashEntry(id: string): SessionEntry {
  return {
    type: "message",
    id,
    parentId: null,
    timestamp: "2026-01-01T00:00:00.000Z",
    message: {
      role: "bashExecution",
      command: "ls",
      output: "file.txt",
      exitCode: 0,
      cancelled: false,
      truncated: false,
      timestamp: 0,
    },
  };
}

function modelChange(id: string): SessionEntry {
  return {
    type: "model_change",
    id,
    parentId: null,
    timestamp: "2026-01-01T00:00:00.000Z",
    provider: "anthropic",
    modelId: "claude-3",
  };
}

function thinkingLevelChange(id: string): SessionEntry {
  return {
    type: "thinking_level_change",
    id,
    parentId: null,
    timestamp: "2026-01-01T00:00:00.000Z",
    thinkingLevel: "high",
  };
}

function compaction(id: string): SessionEntry {
  return {
    type: "compaction",
    id,
    parentId: null,
    timestamp: "2026-01-01T00:00:00.000Z",
    summary: "Compacted summary text",
    firstKeptEntryId: "x",
    tokensBefore: 1,
  };
}

function customMessage(id: string, display: boolean): SessionEntry {
  return {
    type: "custom_message",
    id,
    parentId: null,
    timestamp: "2026-01-01T00:00:00.000Z",
    customType: "internal",
    content: "custom-content",
    display,
  };
}

/**
 * Build a SessionDetail with mixed entry types in the wire (leaf-first) format:
 *   branch[0] = NEWEST (leaf)
 *   branch[last] = OLDEST (root)
 *
 * The fixture includes:
 *   - 2 user messages
 *   - 2 assistant messages (one with a trailing toolResult)
 *   - 1 bashExecution
 *   - 1 custom_message (display:true)
 *   - 1 model_change
 *   - 1 thinking_level_change
 *   - 1 compaction
 */
function buildDetail(): SessionDetail {
  // Build oldest-first, then reverse for leaf-first wire format.
  const oldestFirst: SessionEntry[] = [
    userEntry("u1", "USER-ONE"),
    assistantEntry("a1", "ASSISTANT-ONE"),
    toolResultEntry("t1", "TOOL-RESULT-ONE"),
    userEntry("u2", "USER-TWO"),
    assistantEntry("a2", "ASSISTANT-TWO"),
    bashEntry("b1"),
    customMessage("c1", true),
    modelChange("m1"),
    thinkingLevelChange("tl1"),
    compaction("cp1"),
  ];
  const branch = oldestFirst.slice().reverse();
  return {
    header: {
      id: "session-xyz",
      version: 3,
      timestamp: "2026-01-01T00:00:00.000Z",
      cwd: "/tmp/filter-test",
    },
    branch,
    totalEntries: branch.length,
  };
}

// ---- Mocks ----

const getSessionMock = vi.fn();

vi.mock("../../src/api", async () => {
  const actual =
    await vi.importActual<typeof import("../../src/api")>("../../src/api");
  return {
    ...actual,
    getSession: (...args: unknown[]): Promise<SessionDetail> =>
      getSessionMock(...args) as Promise<SessionDetail>,
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

function getFilterPill(container: HTMLElement, role: string): HTMLButtonElement {
  const el = container.querySelector<HTMLButtonElement>(
    `.filter-pill[data-role="${role}"]`,
  );
  if (!el) throw new Error(`pill for ${role} not found`);
  return el;
}

function getDividersPill(container: HTMLElement): HTMLButtonElement {
  const el = container.querySelector<HTMLButtonElement>(
    `.filter-pill[data-filter="hideDividers"]`,
  );
  if (!el) throw new Error("hide-dividers pill not found");
  return el;
}

function getThinkingPill(container: HTMLElement): HTMLButtonElement {
  const el = container.querySelector<HTMLButtonElement>(
    `.filter-pill[data-filter="showThinking"]`,
  );
  if (!el) throw new Error("showThinking pill not found");
  return el;
}

function sortedByDocumentOrder(els: Element[]): Element[] {
  return [...els].sort((a, b) => {
    const pos = a.compareDocumentPosition(b);
    if (pos & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
    if (pos & Node.DOCUMENT_POSITION_PRECEDING) return 1;
    return 0;
  });
}

beforeEach(() => {
  // Reset localStorage so filter persistence (added in step 13) doesn't
  // leak state from one test into the next. happy-dom's localStorage
  // persists across `it()` blocks within this file unless explicitly cleared.
  window.localStorage.clear();
  entryHandlers.length = 0;
  getSessionMock.mockReset();
  getSessionMock.mockResolvedValue(buildDetail());
});

// ---- Tests ----

describe("SessionView filter integration", () => {
  it("renders the filter bar with all 7 pills (5 role pressed, thinking + hide-dividers unpressed by default)", async () => {
    const noop = (): void => undefined;
    const { container } = renderWithRouter(
      <SessionView sessionId="session-xyz" onBack={noop} />,
    );
    await waitFor(() => {
      expect(container.querySelector(".filter-bar")).not.toBeNull();
    });
    const pills = Array.from(container.querySelectorAll(".filter-pill"));
    // 5 role pills + 2 bundle pills (showThinking, hideDividers).
    expect(pills).toHaveLength(7);
    // 5 role pills pressed (visible by default), both bundle pills unpressed
    // (dividers shown / thinking hidden by default — pressed=true means shown).
    const rolePills = pills.filter((p) => !p.classList.contains("filter-pill-bundle"));
    const bundlePills = pills.filter((p) => p.classList.contains("filter-pill-bundle"));
    expect(rolePills).toHaveLength(5);
    expect(bundlePills).toHaveLength(2);
    for (const p of rolePills) {
      expect(p.getAttribute("aria-pressed")).toBe("true");
    }
    for (const p of bundlePills) {
      expect(p.getAttribute("aria-pressed")).toBe("false");
    }
    // The thinking pill reads "thinking hidden" by default.
    const thinkingPill = bundlePills.find(
      (p) => p.getAttribute("data-filter") === "showThinking",
    );
    expect(thinkingPill).toBeDefined();
    expect(thinkingPill?.textContent).toContain("thinking hidden");
    // The dividers pill reads "dividers shown" by default.
    const dividersPill = bundlePills.find(
      (p) => p.getAttribute("data-filter") === "hideDividers",
    );
    expect(dividersPill?.textContent).toContain("dividers shown");
  });

  it("with DEFAULT_FILTERS renders every entry (regression)", async () => {
    const noop = (): void => undefined;
    const { container } = renderWithRouter(
      <SessionView sessionId="session-xyz" onBack={noop} />,
    );
    await waitFor(() => {
      expect(container.querySelectorAll(".message-user").length).toBe(2);
    });
    expect(container.querySelectorAll(".message-user").length).toBe(2);
    expect(container.querySelectorAll(".message-assistant").length).toBe(2);
    expect(container.querySelectorAll(".tool-result").length).toBe(1);
    expect(container.querySelectorAll(".bash").length).toBe(1);
    expect(container.querySelectorAll(".compaction").length).toBe(1);
    expect(container.querySelectorAll(".entry-divider").length).toBe(2);
  });

  it("toggling showRoles.user off hides user messages and keeps the rest", async () => {
    const noop = (): void => undefined;
    const { container } = renderWithRouter(
      <SessionView sessionId="session-xyz" onBack={noop} />,
    );
    await waitFor(() => {
      expect(container.querySelectorAll(".message-user").length).toBe(2);
    });
    fireEvent.click(getFilterPill(container, "user"));
    await waitFor(() => {
      expect(container.querySelectorAll(".message-user").length).toBe(0);
    });
    expect(container.querySelectorAll(".message-assistant").length).toBe(2);
    expect(container.querySelectorAll(".tool-result").length).toBe(1);
    expect(container.querySelectorAll(".bash").length).toBe(1);
    expect(container.querySelectorAll(".compaction").length).toBe(1);

    // Header counter updates to "8 of 10 entries".
    expect(container.querySelector(".session-meta")?.textContent).toContain(
      "8 of 10",
    );
    // The pill reflects the off state.
    expect(
      getFilterPill(container, "user").getAttribute("aria-pressed"),
    ).toBe("false");

    // Toggling back on restores them.
    fireEvent.click(getFilterPill(container, "user"));
    await waitFor(() => {
      expect(container.querySelectorAll(".message-user").length).toBe(2);
    });
  });

  it("toggling showRoles.toolResult off removes tool-result content but keeps the assistant that owned it", async () => {
    const noop = (): void => undefined;
    const { container } = renderWithRouter(
      <SessionView sessionId="session-xyz" onBack={noop} />,
    );
    await waitFor(() => {
      expect(container.querySelectorAll(".tool-result").length).toBe(1);
    });
    fireEvent.click(getFilterPill(container, "toolResult"));
    await waitFor(() => {
      expect(container.querySelectorAll(".tool-result").length).toBe(0);
    });
    // The assistant that owned the toolResult is still rendered (its
    // message-group-children simply has no items now).
    expect(container.querySelectorAll(".message-assistant").length).toBe(2);
    // No "TOOL-RESULT-ONE" text in the DOM.
    expect(container.textContent).not.toContain("TOOL-RESULT-ONE");
    // Toggling back on restores it.
    fireEvent.click(getFilterPill(container, "toolResult"));
    await waitFor(() => {
      expect(container.querySelectorAll(".tool-result").length).toBe(1);
    });
  });

  it("toggling hideDividers on hides model_change, thinking_level_change, and compaction entries", async () => {
    const noop = (): void => undefined;
    const { container } = renderWithRouter(
      <SessionView sessionId="session-xyz" onBack={noop} />,
    );
    await waitFor(() => {
      expect(container.querySelectorAll(".compaction").length).toBe(1);
    });
    expect(container.querySelectorAll(".entry-divider").length).toBe(2);
    fireEvent.click(getDividersPill(container));
    await waitFor(() => {
      expect(container.querySelectorAll(".compaction").length).toBe(0);
    });
    expect(container.querySelectorAll(".entry-divider").length).toBe(0);
    // Message-role entries untouched.
    expect(container.querySelectorAll(".message-user").length).toBe(2);
    expect(container.querySelectorAll(".message-assistant").length).toBe(2);
    expect(container.querySelectorAll(".tool-result").length).toBe(1);
    // Toggling back on restores them.
    fireEvent.click(getDividersPill(container));
    await waitFor(() => {
      expect(container.querySelectorAll(".compaction").length).toBe(1);
    });
    expect(container.querySelectorAll(".entry-divider").length).toBe(2);
  });

  it("turning all role toggles off plus hideDividers on shows the empty-state message", async () => {
    const noop = (): void => undefined;
    const { container } = renderWithRouter(
      <SessionView sessionId="session-xyz" onBack={noop} />,
    );
    await waitFor(() => {
      expect(container.querySelector(".filter-bar")).not.toBeNull();
    });
    fireEvent.click(getFilterPill(container, "user"));
    fireEvent.click(getFilterPill(container, "assistant"));
    fireEvent.click(getFilterPill(container, "toolResult"));
    fireEvent.click(getFilterPill(container, "bashExecution"));
    fireEvent.click(getFilterPill(container, "customMessage"));
    fireEvent.click(getDividersPill(container));
    await waitFor(() => {
      expect(container.querySelector(".session-empty")).not.toBeNull();
    });
    expect(container.textContent).toContain(
      "All entries hidden — toggle a filter to show messages",
    );
    // Header counter shows "0 of 10 entries".
    expect(container.querySelector(".session-meta")?.textContent).toContain(
      "0 of 10",
    );
  });

  it("filter toggles do not disturb display order (still oldest at top, newest at bottom)", async () => {
    const noop = (): void => undefined;
    const { container } = renderWithRouter(
      <SessionView sessionId="session-xyz" onBack={noop} />,
    );
    await waitFor(() => {
      expect(container.querySelectorAll(".message-user").length).toBe(2);
    });
    // Hide dividers so we can compare only message bubbles.
    fireEvent.click(getDividersPill(container));
    await waitFor(() => {
      expect(container.querySelectorAll(".compaction").length).toBe(0);
    });

    // Collect every message-role bubble in document order (top-to-bottom).
    const bubbles = Array.from(
      container.querySelectorAll(
        ".message-user, .message-assistant, .tool-result, .bash",
      ),
    );
    const ordered = sortedByDocumentOrder(bubbles).map(
      (el) => el.textContent ?? "",
    );

    // The branch was [newest, ..., oldest]. The leaves (newest) are
    //   bashEntry("b1"), customMessage("c1"), assistantEntry("a2"),
    //   userEntry("u2"), toolResultEntry("t1"), assistantEntry("a1"),
    //   userEntry("u1").
    // Reversed for display, the top-to-bottom order is:
    //   u1, a1, t1, u2, a2, (custom c1 is filtered out via customMessage
    //   but we'll also expect bash to render), b1.
    // We expect at least:
    expect(ordered[0]).toContain("USER-ONE");
    expect(ordered[ordered.length - 1]).toContain("file.txt"); // bash output
    // And no duplicates (filtering didn't reshuffle).
    const count = (substr: string): number =>
      ordered.filter((t) => t.includes(substr)).length;
    expect(count("USER-ONE")).toBe(1);
    expect(count("ASSISTANT-ONE")).toBe(1);
    expect(count("TOOL-RESULT-ONE")).toBe(1);
    expect(count("USER-TWO")).toBe(1);
    expect(count("ASSISTANT-TWO")).toBe(1);
  });

  it("SSE-arrived entries are visible when their filter matches", async () => {
    const noop = (): void => undefined;
    const { container } = renderWithRouter(
      <SessionView sessionId="session-xyz" onBack={noop} />,
    );
    await waitFor(() => {
      expect(container.querySelectorAll(".message-user").length).toBe(2);
    });

    // Simulate an SSE entry arriving (prepended to branch state). The
    // server wraps each entry in a `{ entry, stats }` envelope.
    const sseUser = userEntry("sse-u", "SSE-USER-NEW");
    for (const h of entryHandlers) h({ entry: sseUser });

    await waitFor(() => {
      expect(container.textContent).toContain("SSE-USER-NEW");
    });
    // Counter updates.
    expect(container.querySelector(".session-meta")?.textContent).toContain(
      "11 of 11",
    );

    // Now turn user off — the SSE-arrived user disappears.
    fireEvent.click(getFilterPill(container, "user"));
    await waitFor(() => {
      expect(container.textContent).not.toContain("SSE-USER-NEW");
    });
    // But it's still tracked in branch state — re-enabling brings it back.
    fireEvent.click(getFilterPill(container, "user"));
    await waitFor(() => {
      expect(container.textContent).toContain("SSE-USER-NEW");
    });
  });

  it("header counter uses plural for branch.length > 1 and singular for 1 (defensive)", async () => {
    // Single-entry branch → singular form.
    const singleEntry: SessionDetail = {
      header: {
        id: "session-solo",
        version: 3,
        timestamp: "2026-01-01T00:00:00.000Z",
        cwd: "/tmp/solo",
      },
      branch: [userEntry("only", "only message")],
      totalEntries: 1,
    };
    getSessionMock.mockReset();
    getSessionMock.mockResolvedValueOnce(singleEntry);
    const noop = (): void => undefined;
    const { container } = renderWithRouter(
      <SessionView sessionId="session-solo" onBack={noop} />,
    );
    await waitFor(() => {
      expect(container.querySelectorAll(".message-user").length).toBe(1);
    });
    expect(container.querySelector(".session-meta")?.textContent).toContain(
      "1 of 1 entry",
    );
    // And it does NOT say "entries".
    expect(container.querySelector(".session-meta")?.textContent).not.toContain(
      "entries",
    );
  });
});

describe("DEFAULT_FILTERS contract", () => {
  it("matches the documented contract used by FilterBar", () => {
    expect(DEFAULT_FILTERS.hideDividers).toBe(false);
    expect(Object.values(DEFAULT_FILTERS.showRoles).every(Boolean)).toBe(true);
  });
});

describe("SessionView filter integration — adjacent assistant/toolResult", () => {
  /**
   * Build a fixture with a truly adjacent assistant/toolResult pair in
   * leaf-first order matching real-data geometry: assistant at idx 5
   * (older), toolResult at idx 6 (newer) — i.e. the assistant's index+1
   * look-ahead picks up the toolResult. Layout:
   *   0: toolResult(t2)       — orphan (no preceding assistant)
   *   1: user(u2)
   *   2: modelChange(m1)
   *   3: user(u1)
   *   4: bashExecution(b1)
   *   5: assistant(a1)        — grouped with t1 at idx 6
   *   6: toolResult(t1)       — absorbed by assistant at idx 5
   *   7: thinkingLevelChange(tl1)
   *   8: compaction(cp1)
   *   9: customMessage(c1)    — display:true
   * After leaf-first reversal: u2 (top) ... a1+t1 ... customMessage (bottom).
   */
  function buildAdjacentDetail(): SessionDetail {
    const oldestFirst: SessionEntry[] = [
      customMessage("c1", true),
      compaction("cp1"),
      thinkingLevelChange("tl1"),
      toolResultEntry("t1", "TOOL-RESULT-ONE"),
      assistantEntry("a1", "ASSISTANT-ONE"),
      bashEntry("b1"),
      userEntry("u1", "USER-ONE"),
      modelChange("m1"),
      userEntry("u2", "USER-TWO"),
      toolResultEntry("t2", "ORPHAN-TOOL"),
    ];
    const branch = oldestFirst.slice().reverse();
    return {
      header: {
        id: "session-adj",
        version: 3,
        timestamp: "2026-01-01T00:00:00.000Z",
        cwd: "/tmp/adj",
      },
      branch,
      totalEntries: branch.length,
    };
  }

  it("toggling the tool pill hides the toolResult nested in an assistant group (adjacent fixture)", async () => {
    getSessionMock.mockReset();
    getSessionMock.mockResolvedValueOnce(buildAdjacentDetail());
    const noop = (): void => undefined;
    const { container } = renderWithRouter(
      <SessionView sessionId="session-adj" onBack={noop} />,
    );
    await waitFor(() => {
      expect(container.querySelectorAll(".message-assistant").length).toBe(1);
    });
    // Sanity: two toolResults render — t2 (orphan, branch[0]) and t1
    // (absorbed into the assistant's group-children).
    expect(container.querySelectorAll(".tool-result").length).toBe(2);
    expect(container.textContent).toContain("TOOL-RESULT-ONE");
    expect(container.textContent).toContain("ORPHAN-TOOL");
    fireEvent.click(getFilterPill(container, "toolResult"));
    await waitFor(() => {
      expect(container.querySelectorAll(".tool-result").length).toBe(0);
    });
    // The assistant bubble is still visible (it just has no group-children now).
    expect(container.querySelectorAll(".message-assistant").length).toBe(1);
    expect(container.textContent).toContain("ASSISTANT-ONE");
    expect(container.textContent).not.toContain("TOOL-RESULT-ONE");
    expect(container.textContent).not.toContain("ORPHAN-TOOL");
  });

  it("toggling the assistant pill hides the assistant; toolResult renders as orphan (adjacent fixture)", async () => {
    getSessionMock.mockReset();
    getSessionMock.mockResolvedValueOnce(buildAdjacentDetail());
    const noop = (): void => undefined;
    const { container } = renderWithRouter(
      <SessionView sessionId="session-adj" onBack={noop} />,
    );
    await waitFor(() => {
      expect(container.querySelectorAll(".message-assistant").length).toBe(1);
    });
    fireEvent.click(getFilterPill(container, "assistant"));
    await waitFor(() => {
      expect(container.querySelectorAll(".message-assistant").length).toBe(0);
    });
    // The toolResult that was absorbed into the assistant group must now
    // render as an orphan (not be swallowed into nothing). Both t1 and t2
    // should be present (t2 was already an orphan, t1 is newly orphan).
    expect(container.querySelectorAll(".tool-result").length).toBe(2);
    expect(container.textContent).toContain("TOOL-RESULT-ONE");
    expect(container.textContent).toContain("ORPHAN-TOOL");
  });
});

describe("SessionView filter integration — bash toolResult", () => {
  function buildBashDetail(): SessionDetail {
    // Three entries: user, assistant-with-tool, bash toolResult.
    const oldestFirst: SessionEntry[] = [
      bashToolResultEntry("btr", "BASH-OUTPUT"),
      assistantEntry("a1", "ASSISTANT-WITH-BASH"),
      userEntry("u1", "USER-PROMPT"),
    ];
    const branch = oldestFirst.slice().reverse();
    return {
      header: {
        id: "session-bash",
        version: 3,
        timestamp: "2026-01-01T00:00:00.000Z",
        cwd: "/tmp/bash",
      },
      branch,
      totalEntries: branch.length,
    };
  }

  it("toggling bash pill hides bash toolResult", async () => {
    getSessionMock.mockReset();
    getSessionMock.mockResolvedValueOnce(buildBashDetail());
    const noop = (): void => undefined;
    const { container } = renderWithRouter(
      <SessionView sessionId="session-bash" onBack={noop} />,
    );
    await waitFor(() => {
      expect(container.querySelectorAll(".tool-result").length).toBe(1);
    });
    fireEvent.click(getFilterPill(container, "bashExecution"));
    await waitFor(() => {
      expect(container.querySelectorAll(".tool-result").length).toBe(0);
    });
    expect(container.textContent).not.toContain("BASH-OUTPUT");
  });

  it("toggling tool pill does NOT hide bash toolResult (bash has its own pill)", async () => {
    getSessionMock.mockReset();
    getSessionMock.mockResolvedValueOnce(buildBashDetail());
    const noop = (): void => undefined;
    const { container } = renderWithRouter(
      <SessionView sessionId="session-bash" onBack={noop} />,
    );
    await waitFor(() => {
      expect(container.querySelectorAll(".tool-result").length).toBe(1);
    });
    fireEvent.click(getFilterPill(container, "toolResult"));
    await waitFor(() => {
      // The bash toolResult must still render — it's gated by bash, not tool.
      expect(container.querySelectorAll(".tool-result").length).toBe(1);
    });
    expect(container.textContent).toContain("BASH-OUTPUT");
  });

  it("turning both bash AND tool off hides bash toolResult", async () => {
    getSessionMock.mockReset();
    getSessionMock.mockResolvedValueOnce(buildBashDetail());
    const noop = (): void => undefined;
    const { container } = renderWithRouter(
      <SessionView sessionId="session-bash" onBack={noop} />,
    );
    await waitFor(() => {
      expect(container.querySelectorAll(".tool-result").length).toBe(1);
    });
    fireEvent.click(getFilterPill(container, "bashExecution"));
    fireEvent.click(getFilterPill(container, "toolResult"));
    await waitFor(() => {
      expect(container.querySelectorAll(".tool-result").length).toBe(0);
    });
    expect(container.textContent).not.toContain("BASH-OUTPUT");
  });
});

describe("SessionView filter integration — thinking pill", () => {
  function buildThinkingDetail(): SessionDetail {
    const oldestFirst: SessionEntry[] = [
      assistantWithThinkingEntry("a1", "ASSISTANT-TEXT", "THINKING-REASONING"),
      userEntry("u1", "USER-PROMPT"),
    ];
    const branch = oldestFirst.slice().reverse();
    return {
      header: {
        id: "session-think",
        version: 3,
        timestamp: "2026-01-01T00:00:00.000Z",
        cwd: "/tmp/thinking",
      },
      branch,
      totalEntries: branch.length,
    };
  }

  it("thinking pill is present, starts unpressed, and renders .thinking-block when clicked", async () => {
    getSessionMock.mockReset();
    getSessionMock.mockResolvedValueOnce(buildThinkingDetail());
    const noop = (): void => undefined;
    const { container } = renderWithRouter(
      <SessionView sessionId="session-think" onBack={noop} />,
    );
    await waitFor(() => {
      expect(container.querySelector(".filter-bar")).not.toBeNull();
    });
    // Pill exists and starts unpressed (default showThinking=false).
    const pill = getThinkingPill(container);
    expect(pill.getAttribute("aria-pressed")).toBe("false");
    expect(pill.textContent).toContain("thinking hidden");
    // Assistant is rendered, but no thinking block yet (default off).
    await waitFor(() => {
      expect(container.querySelectorAll(".message-assistant").length).toBe(1);
    });
    expect(container.querySelector(".thinking-block")).toBeNull();
    expect(container.textContent).toContain("ASSISTANT-TEXT");
    expect(container.textContent).not.toContain("THINKING-REASONING");
    // Click the pill.
    fireEvent.click(pill);
    await waitFor(() => {
      expect(container.querySelector(".thinking-block")).not.toBeNull();
    });
    expect(pill.getAttribute("aria-pressed")).toBe("true");
    expect(pill.textContent).toContain("thinking shown");
    expect(container.textContent).toContain("THINKING-REASONING");
    // Toggling back off removes the block.
    fireEvent.click(pill);
    await waitFor(() => {
      expect(container.querySelector(".thinking-block")).toBeNull();
    });
    expect(container.textContent).not.toContain("THINKING-REASONING");
  });
});