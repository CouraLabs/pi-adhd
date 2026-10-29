// @vitest-environment happy-dom
// tests/client/filters.test.ts
//
// Pure unit tests for the filter predicate. No React, no DOM.

import { describe, expect, it } from "vitest";
import {
  DEFAULT_FILTERS,
  passesFilter,
  toggleHideDividers,
  toggleRole,
  toggleThinking,
  type Filters,
} from "../../src/lib/filters";
import type { SessionEntry } from "../../src/types";

// ---- Fixtures ----

function userEntry(id: string): SessionEntry {
  return {
    type: "message",
    id,
    parentId: null,
    timestamp: "2026-01-01T00:00:00.000Z",
    message: {
      role: "user",
      content: [{ type: "text", text: "hi" }],
      timestamp: 0,
    },
  };
}

function assistantEntry(id: string): SessionEntry {
  return {
    type: "message",
    id,
    parentId: null,
    timestamp: "2026-01-01T00:00:00.000Z",
    message: {
      role: "assistant",
      content: [{ type: "text", text: "hello" }],
      timestamp: 0,
    },
  };
}

function toolResultEntry(id: string): SessionEntry {
  return {
    type: "message",
    id,
    parentId: null,
    timestamp: "2026-01-01T00:00:00.000Z",
    message: {
      role: "toolResult",
      toolCallId: "call_1",
      toolName: "read",
      content: [{ type: "text", text: "out" }],
      isError: false,
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
      output: "",
      exitCode: 0,
      cancelled: false,
      truncated: false,
      timestamp: 0,
    },
  };
}

function bashToolResultEntry(id: string): SessionEntry {
  // Real Pi data stores bash output overwhelmingly as toolResult entries
  // with toolName="bash" (not bashExecution-role). The bash pill must
  // gate these too.
  return {
    type: "message",
    id,
    parentId: null,
    timestamp: "2026-01-01T00:00:00.000Z",
    message: {
      role: "toolResult",
      toolCallId: "call_1",
      toolName: "bash",
      content: [{ type: "text", text: "out" }],
      isError: false,
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
    summary: "s",
    firstKeptEntryId: "x",
    tokensBefore: 1,
  };
}

function branchSummary(id: string): SessionEntry {
  return {
    type: "branch_summary",
    id,
    parentId: null,
    timestamp: "2026-01-01T00:00:00.000Z",
    summary: "s",
  };
}

function customMessage(id: string, display: boolean): SessionEntry {
  return {
    type: "custom_message",
    id,
    parentId: null,
    timestamp: "2026-01-01T00:00:00.000Z",
    customType: "x",
    content: "c",
    display,
  };
}

function sessionInfo(id: string): SessionEntry {
  return {
    type: "session_info",
    id,
    parentId: null,
    timestamp: "2026-01-01T00:00:00.000Z",
  };
}

// ---- Tests ----

describe("DEFAULT_FILTERS", () => {
  it("has all roles enabled and dividers shown", () => {
    expect(DEFAULT_FILTERS.showRoles.user).toBe(true);
    expect(DEFAULT_FILTERS.showRoles.assistant).toBe(true);
    expect(DEFAULT_FILTERS.showRoles.toolResult).toBe(true);
    expect(DEFAULT_FILTERS.showRoles.bashExecution).toBe(true);
    expect(DEFAULT_FILTERS.showRoles.customMessage).toBe(true);
    expect(DEFAULT_FILTERS.hideDividers).toBe(false);
  });

  it("defaults showThinking to false (thinking blocks silently dropped)", () => {
    expect(DEFAULT_FILTERS.showThinking).toBe(false);
  });
});

describe("passesFilter", () => {
  describe("with DEFAULT_FILTERS", () => {
    it("shows every message role", () => {
      expect(passesFilter(userEntry("u"), DEFAULT_FILTERS)).toBe(true);
      expect(passesFilter(assistantEntry("a"), DEFAULT_FILTERS)).toBe(true);
      expect(passesFilter(toolResultEntry("t"), DEFAULT_FILTERS)).toBe(true);
      expect(passesFilter(bashEntry("b"), DEFAULT_FILTERS)).toBe(true);
    });

    it("shows dividers (model_change, thinking_level_change, compaction, branch_summary)", () => {
      expect(passesFilter(modelChange("m"), DEFAULT_FILTERS)).toBe(true);
      expect(passesFilter(thinkingLevelChange("tl"), DEFAULT_FILTERS)).toBe(true);
      expect(passesFilter(compaction("c"), DEFAULT_FILTERS)).toBe(true);
      expect(passesFilter(branchSummary("bs"), DEFAULT_FILTERS)).toBe(true);
    });

    it("shows custom_message with display=true and hides display=false regardless", () => {
      expect(passesFilter(customMessage("c1", true), DEFAULT_FILTERS)).toBe(true);
      const noCustom: Filters = {
        ...DEFAULT_FILTERS,
        showRoles: { ...DEFAULT_FILTERS.showRoles, customMessage: true },
      };
      expect(passesFilter(customMessage("c2", false), noCustom)).toBe(false);
    });

    it("shows reserved entry types (label, session_info, custom, session) under default filters", () => {
      expect(passesFilter(sessionInfo("si"), DEFAULT_FILTERS)).toBe(true);
    });
  });

  describe("role toggles", () => {
    it("hides user messages when showRoles.user=false", () => {
      const f: Filters = {
        ...DEFAULT_FILTERS,
        showRoles: { ...DEFAULT_FILTERS.showRoles, user: false },
      };
      expect(passesFilter(userEntry("u"), f)).toBe(false);
      expect(passesFilter(assistantEntry("a"), f)).toBe(true);
      expect(passesFilter(toolResultEntry("t"), f)).toBe(true);
      expect(passesFilter(bashEntry("b"), f)).toBe(true);
    });

    it("hides toolResult messages when showRoles.toolResult=false (per-entry; the dispatcher is what does the visual grouping)", () => {
      const f: Filters = {
        ...DEFAULT_FILTERS,
        showRoles: { ...DEFAULT_FILTERS.showRoles, toolResult: false },
      };
      expect(passesFilter(toolResultEntry("t"), f)).toBe(false);
      expect(passesFilter(userEntry("u"), f)).toBe(true);
      expect(passesFilter(assistantEntry("a"), f)).toBe(true);
    });

    it("hides bashExecution messages when showRoles.bashExecution=false", () => {
      const f: Filters = {
        ...DEFAULT_FILTERS,
        showRoles: { ...DEFAULT_FILTERS.showRoles, bashExecution: false },
      };
      expect(passesFilter(bashEntry("b"), f)).toBe(false);
      expect(passesFilter(userEntry("u"), f)).toBe(true);
    });

    it("hides toolResult-with-toolName=bash when showRoles.bashExecution=false (non-bash toolResults unaffected)", () => {
      const f: Filters = {
        ...DEFAULT_FILTERS,
        showRoles: { ...DEFAULT_FILTERS.showRoles, bashExecution: false },
      };
      expect(passesFilter(bashToolResultEntry("bt"), f)).toBe(false);
      // Non-bash toolResults are gated by the tool pill, which is still on.
      expect(passesFilter(toolResultEntry("t"), f)).toBe(true);
      // bashExecution-role entries also hidden by the bash pill.
      expect(passesFilter(bashEntry("b"), f)).toBe(false);
    });

    it("hides non-bash toolResults when showRoles.toolResult=false (bash toolResults unaffected)", () => {
      const f: Filters = {
        ...DEFAULT_FILTERS,
        showRoles: { ...DEFAULT_FILTERS.showRoles, toolResult: false },
      };
      expect(passesFilter(toolResultEntry("t"), f)).toBe(false);
      // Bash toolResults are gated by the bash pill, which is still on.
      expect(passesFilter(bashToolResultEntry("bt"), f)).toBe(true);
    });

    it("turning both bash and tool pills off hides bash toolResults", () => {
      const f: Filters = {
        ...DEFAULT_FILTERS,
        showRoles: {
          ...DEFAULT_FILTERS.showRoles,
          bashExecution: false,
          toolResult: false,
        },
      };
      expect(passesFilter(bashToolResultEntry("bt"), f)).toBe(false);
      expect(passesFilter(toolResultEntry("t"), f)).toBe(false);
    });

    it("hides visible custom_message when showRoles.customMessage=false but display=false always hidden", () => {
      const f: Filters = {
        ...DEFAULT_FILTERS,
        showRoles: { ...DEFAULT_FILTERS.showRoles, customMessage: false },
      };
      expect(passesFilter(customMessage("c1", true), f)).toBe(false);
      expect(passesFilter(customMessage("c2", false), f)).toBe(false);
    });

    it("hides assistant when showRoles.assistant=false (toolResult remains visible as orphan)", () => {
      const f: Filters = {
        ...DEFAULT_FILTERS,
        showRoles: { ...DEFAULT_FILTERS.showRoles, assistant: false },
      };
      expect(passesFilter(assistantEntry("a"), f)).toBe(false);
      expect(passesFilter(toolResultEntry("t"), f)).toBe(true);
    });
  });

  describe("hideDividers", () => {
    it("hides model_change, thinking_level_change, compaction, branch_summary", () => {
      const f = toggleHideDividers(DEFAULT_FILTERS);
      expect(f.hideDividers).toBe(true);
      expect(passesFilter(modelChange("m"), f)).toBe(false);
      expect(passesFilter(thinkingLevelChange("tl"), f)).toBe(false);
      expect(passesFilter(compaction("c"), f)).toBe(false);
      expect(passesFilter(branchSummary("bs"), f)).toBe(false);
    });

    it("hides reserved (no-op rendered) entry types for consistency", () => {
      const f = toggleHideDividers(DEFAULT_FILTERS);
      expect(passesFilter(sessionInfo("si"), f)).toBe(false);
    });

    it("does not hide message-role entries when hideDividers=true", () => {
      const f = toggleHideDividers(DEFAULT_FILTERS);
      expect(passesFilter(userEntry("u"), f)).toBe(true);
      expect(passesFilter(assistantEntry("a"), f)).toBe(true);
      expect(passesFilter(toolResultEntry("t"), f)).toBe(true);
    });
  });

  describe("combined", () => {
    it("applies both role toggle and hideDividers together", () => {
      const f: Filters = {
        showRoles: { ...DEFAULT_FILTERS.showRoles, user: false },
        hideDividers: true,
        showThinking: false,
      };
      expect(passesFilter(userEntry("u"), f)).toBe(false);
      expect(passesFilter(modelChange("m"), f)).toBe(false);
      expect(passesFilter(assistantEntry("a"), f)).toBe(true);
      expect(passesFilter(bashEntry("b"), f)).toBe(true);
    });
  });
});

describe("toggleRole", () => {
  it("flips a single role flag immutably", () => {
    const a = DEFAULT_FILTERS;
    const b = toggleRole(a, "user");
    expect(a.showRoles.user).toBe(true);
    expect(b.showRoles.user).toBe(false);
    // Other roles untouched.
    expect(b.showRoles.assistant).toBe(true);
    expect(b.showRoles.toolResult).toBe(true);
    expect(b.hideDividers).toBe(false);
  });

  it("flipping twice returns to the same value", () => {
    const a = toggleRole(DEFAULT_FILTERS, "toolResult");
    const b = toggleRole(a, "toolResult");
    expect(b.showRoles.toolResult).toBe(true);
  });
});

describe("toggleHideDividers", () => {
  it("flips hideDividers immutably", () => {
    const a = DEFAULT_FILTERS;
    const b = toggleHideDividers(a);
    expect(a.hideDividers).toBe(false);
    expect(b.hideDividers).toBe(true);
    // Role toggles untouched.
    expect(b.showRoles.user).toBe(true);
  });
});

describe("toggleThinking", () => {
  it("flips showThinking immutably", () => {
    const a = DEFAULT_FILTERS;
    const b = toggleThinking(a);
    expect(a.showThinking).toBe(false);
    expect(b.showThinking).toBe(true);
    // Other filters untouched.
    expect(b.showRoles.user).toBe(true);
    expect(b.hideDividers).toBe(false);
  });

  it("flipping twice returns to the same value", () => {
    const a = toggleThinking(DEFAULT_FILTERS);
    const b = toggleThinking(a);
    expect(b.showThinking).toBe(false);
  });
});