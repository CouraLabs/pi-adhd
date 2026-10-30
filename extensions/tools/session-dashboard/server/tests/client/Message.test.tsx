// @vitest-environment happy-dom
// tests/client/Message.test.tsx
import { describe, expect, it } from "vitest";
import { renderWithRouter } from "./helpers/renderWithRouter";
import { Message } from "../../src/components/Message";
import type { SessionEntry } from "../../src/types";

function msg(
  id: string,
  role: "user" | "assistant" | "toolResult" | "bashExecution",
  text: string,
  extra: Record<string, unknown> = {},
): SessionEntry {
  const base = {
    type: "message" as const,
    id,
    parentId: null,
    timestamp: "2026-01-01T00:00:00.000Z",
  };
  if (role === "user" || role === "assistant") {
    return {
      ...base,
      message: {
        role,
        content: [{ type: "text", text }],
        timestamp: 0,
      },
    };
  }
  if (role === "toolResult") {
    return {
      ...base,
      message: {
        role,
        toolCallId: "call_1",
        toolName: "read",
        content: [{ type: "text", text }],
        isError: false,
        timestamp: 0,
      },
    };
  }
  return {
    ...base,
    message: {
      role,
      command: "echo hi",
      output: text,
      exitCode: 0,
      cancelled: false,
      truncated: false,
      timestamp: 0,
      ...extra,
    },
  };
}

describe("Message dispatcher", () => {
  it("renders a user message", () => {
    const entries: SessionEntry[] = [msg("00000001", "user", "Hello there")];
    const { container } = renderWithRouter(<Message entries={entries} index={0} />);
    expect(container.textContent).toContain("Hello there");
    expect(container.querySelector(".message-user")).not.toBeNull();
  });

  it("renders an assistant message", () => {
    const entries: SessionEntry[] = [
      msg("00000001", "assistant", "Hi! How can I help?"),
    ];
    const { container } = renderWithRouter(<Message entries={entries} index={0} />);
    expect(container.textContent).toContain("Hi! How can I help?");
    expect(container.querySelector(".message-assistant")).not.toBeNull();
  });

  it("groups toolResults visually with the preceding assistant message", () => {
    const entries: SessionEntry[] = [
      msg("00000001", "assistant", "Calling tool…"),
      msg("00000002", "toolResult", "Tool output here"),
    ];
    const { container } = renderWithRouter(<Message entries={entries} index={0} />);
    expect(container.querySelector(".message-group-assistant")).not.toBeNull();
    expect(container.textContent).toContain("Calling tool…");
    expect(container.textContent).toContain("Tool output here");
    // Index 1 should not render anything new (it's absorbed into index 0).
    const { container: c2 } = renderWithRouter(
      <Message entries={entries} index={1} />,
    );
    expect(c2.firstChild).toBeNull();
  });

  it("renders a bashExecution entry", () => {
    const entries: SessionEntry[] = [
      msg("00000001", "bashExecution", "hello\nworld", { command: "echo hello" }),
    ];
    const { container } = renderWithRouter(<Message entries={entries} index={0} />);
    expect(container.querySelector(".bash")).not.toBeNull();
    expect(container.textContent).toContain("echo hello");
    expect(container.textContent).toContain("hello");
  });

  it("renders a model_change divider", () => {
    const entry: SessionEntry = {
      type: "model_change",
      id: "00000001",
      parentId: null,
      timestamp: "2026-01-01T00:00:00.000Z",
      provider: "anthropic",
      modelId: "claude-3",
    };
    const { container } = renderWithRenderer(entry);
    expect(container.querySelector(".entry-divider")).not.toBeNull();
    expect(container.textContent).toContain("anthropic/claude-3");
  });

  it("renders a thinking_level_change divider", () => {
    const entry: SessionEntry = {
      type: "thinking_level_change",
      id: "00000001",
      parentId: null,
      timestamp: "2026-01-01T00:00:00.000Z",
      thinkingLevel: "high",
    };
    const { container } = renderWithRenderer(entry);
    expect(container.textContent).toContain("high");
  });

  it("renders a compaction card", () => {
    const entry: SessionEntry = {
      type: "compaction",
      id: "00000001",
      parentId: null,
      timestamp: "2026-01-01T00:00:00.000Z",
      summary: "## Summary\nold stuff",
      firstKeptEntryId: "00000002",
      tokensBefore: 12345,
    };
    const { container } = renderWithRenderer(entry);
    expect(container.querySelector(".compaction")).not.toBeNull();
    // Don't assert exact locale formatting — happy-dom and jsdom use different
    // thousand separators ("," vs "."). Just check the digits are present.
    expect(container.textContent).toMatch(/12.?345/);
    expect(container.textContent).toContain("Summary");
  });

  it("skips reserved entry types (label, session_info, custom, session)", () => {
    for (const e of [
      {
        type: "label",
        id: "00000001",
        parentId: null,
        timestamp: "2026-01-01T00:00:00.000Z",
        label: "important",
      },
      {
        type: "session_info",
        id: "00000001",
        parentId: null,
        timestamp: "2026-01-01T00:00:00.000Z",
        name: "foo",
      },
      {
        type: "custom",
        id: "00000001",
        parentId: null,
        timestamp: "2026-01-01T00:00:00.000Z",
        customType: "x",
        data: {},
      },
      {
        type: "session",
        version: 3,
        id: "00000001",
        timestamp: "2026-01-01T00:00:00.000Z",
        cwd: "/x",
      },
    ] as SessionEntry[]) {
      const entries: SessionEntry[] = [e];
      const { container } = renderWithRouter(
        <Message entries={entries} index={0} />,
      );
      expect(container.firstChild).toBeNull();
    }
  });

  it("skips custom_message when display is false", () => {
    const entry: SessionEntry = {
      type: "custom_message",
      id: "00000001",
      parentId: null,
      timestamp: "2026-01-01T00:00:00.000Z",
      customType: "internal",
      content: "hidden",
      display: false,
    };
    const entries: SessionEntry[] = [entry];
    const { container } = renderWithRouter(<Message entries={entries} index={0} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders custom_message when display is true", () => {
    const entry: SessionEntry = {
      type: "custom_message",
      id: "00000001",
      parentId: null,
      timestamp: "2026-01-01T00:00:00.000Z",
      customType: "internal",
      content: "visible text",
      display: true,
    };
    const entries: SessionEntry[] = [entry];
    const { container } = renderWithRouter(<Message entries={entries} index={0} />);
    expect(container.textContent).toContain("visible text");
  });

  it("returns null for an out-of-range index", () => {
    const entries: SessionEntry[] = [msg("00000001", "user", "hi")];
    const { container } = renderWithRouter(<Message entries={entries} index={5} />);
    expect(container.firstChild).toBeNull();
  });
});

describe("Message dispatcher — visibleIndices filter awareness", () => {
  it("treats all entries as visible when visibleIndices is undefined (default)", () => {
    // Two adjacent entries: assistant at 0, toolResult at 1.
    // Without visibleIndices, the assistant absorbs the toolResult (returns null at idx 1).
    const entries: SessionEntry[] = [
      msg("00000001", "assistant", "Calling tool…"),
      msg("00000002", "toolResult", "Tool output here"),
    ];
    const { container: c0 } = renderWithRouter(
      <Message entries={entries} index={0} />,
    );
    expect(c0.textContent).toContain("Calling tool…");
    expect(c0.textContent).toContain("Tool output here");
    const { container: c1 } = renderWithRouter(
      <Message entries={entries} index={1} />,
    );
    expect(c1.firstChild).toBeNull();
  });

  it("visibleIndices excluding the toolResult index → assistant's group-children does not include it", () => {
    const entries: SessionEntry[] = [
      msg("00000001", "assistant", "Calling tool…"),
      msg("00000002", "toolResult", "Tool output here"),
    ];
    // The assistant is at idx 0 (visible). The toolResult at idx 1 is
    // filtered out by visibleIndices.
    const visibleIndices = new Set<number>([0]);
    const { container } = renderWithRouter(
      <Message
        entries={entries}
        index={0}
        visibleIndices={visibleIndices}
      />,
    );
    expect(container.textContent).toContain("Calling tool…");
    expect(container.textContent).not.toContain("Tool output here");
    // The toolResult at idx 1 also renders nothing — it's filtered.
    const { container: c1 } = renderWithRouter(
      <Message
        entries={entries}
        index={1}
        visibleIndices={visibleIndices}
      />,
    );
    expect(c1.firstChild).toBeNull();
  });

  it("visibleIndices excluding preceding assistant index → toolResult renders as orphan (not null)", () => {
    const entries: SessionEntry[] = [
      msg("00000001", "assistant", "Will be hidden"),
      msg("00000002", "toolResult", "Standalone output"),
    ];
    // Only the toolResult at idx 1 is visible. The preceding assistant at
    // idx 0 is filtered out — the absorb check must NOT swallow the
    // toolResult, so it renders in orphan mode.
    const visibleIndices = new Set<number>([1]);
    const { container } = renderWithRouter(
      <Message
        entries={entries}
        index={1}
        visibleIndices={visibleIndices}
      />,
    );
    expect(container.firstChild).not.toBeNull();
    expect(container.textContent).toContain("Standalone output");
    expect(container.textContent).not.toContain("Will be hidden");
    // Sanity check on the renderer: rendering the hidden assistant directly
    // still produces output (Message itself does not gate its own index —
    // SessionView's parent .map() does that). The important contract is
    // that an orphan-mode toolResult is rendered when its preceding
    // assistant is filtered out, not absorbed into nothing.
  });
});

describe("Message dispatcher — showThinking prop", () => {
  function assistantWithThinking(id: string): SessionEntry {
    return {
      type: "message",
      id,
      parentId: null,
      timestamp: "2026-01-01T00:00:00.000Z",
      message: {
        role: "assistant",
        content: [
          { type: "text", text: "Hello" },
          // Defensive: thinking payload as a non-string also gets skipped.
          { type: "thinking", thinking: "reasoning about X" },
        ],
        timestamp: 0,
      },
    };
  }

  function assistantWithBadThinking(id: string): SessionEntry {
    // Defensive: thinking payload that's not a string is skipped.
    return {
      type: "message",
      id,
      parentId: null,
      timestamp: "2026-01-01T00:00:00.000Z",
      message: {
        role: "assistant",
        content: [
          { type: "thinking", thinking: 42 as unknown as string },
        ],
        timestamp: 0,
      },
    };
  }

  it("showThinking=true renders <details class=\"thinking-block\"> for thinking content blocks", () => {
    const entries: SessionEntry[] = [assistantWithThinking("00000001")];
    const { container } = renderWithRouter(
      <Message entries={entries} index={0} showThinking={true} />,
    );
    expect(container.textContent).toContain("Hello");
    const thinking = container.querySelector(".thinking-block");
    expect(thinking).not.toBeNull();
    expect(thinking?.tagName.toLowerCase()).toBe("details");
    expect(thinking?.querySelector("summary")?.textContent).toBe("thinking");
    expect(thinking?.querySelector("pre")?.textContent).toBe(
      "reasoning about X",
    );
  });

  it("showThinking=false does not render thinking blocks", () => {
    const entries: SessionEntry[] = [assistantWithThinking("00000001")];
    const { container } = renderWithRouter(
      <Message entries={entries} index={0} showThinking={false} />,
    );
    expect(container.textContent).toContain("Hello");
    expect(container.querySelector(".thinking-block")).toBeNull();
  });

  it("showThinking=undefined (default) does not render thinking blocks", () => {
    const entries: SessionEntry[] = [assistantWithThinking("00000001")];
    const { container } = renderWithRouter(
      <Message entries={entries} index={0} />,
    );
    expect(container.textContent).toContain("Hello");
    expect(container.querySelector(".thinking-block")).toBeNull();
  });

  it("defensive: thinking block with non-string thinking payload is skipped", () => {
    const entries: SessionEntry[] = [assistantWithBadThinking("00000001")];
    const { container } = renderWithRouter(
      <Message entries={entries} index={0} showThinking={true} />,
    );
    // No .thinking-block rendered because the payload was a number.
    expect(container.querySelector(".thinking-block")).toBeNull();
  });
});

function renderWithRenderer(entry: SessionEntry) {
  const entries: SessionEntry[] = [entry];
  return renderWithRouter(<Message entries={entries} index={0} />);
}
