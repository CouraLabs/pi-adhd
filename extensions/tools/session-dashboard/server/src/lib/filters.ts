// src/lib/filters.ts
// Pure predicate module for the SessionView filter UI.
//
// Filters live in SessionView local state and are applied at render time
// (the parent .map() filters the array; <Message> still receives the
// original leaf-first index). New entries from SSE are never dropped by the
// filter — they are always prepended to branch state, and toggling a filter
// back on reveals them.

import type { SessionEntry } from "../types";

export type RoleFilter =
  | "user"
  | "assistant"
  | "toolResult"
  | "bashExecution"
  | "customMessage";

export interface Filters {
  showRoles: Record<RoleFilter, boolean>;
  hideDividers: boolean;
  showThinking: boolean;
}

export const DEFAULT_FILTERS: Filters = {
  showRoles: {
    user: true,
    assistant: true,
    toolResult: true,
    bashExecution: true,
    customMessage: true,
  },
  hideDividers: false,
  showThinking: false,
};

/**
 * Pure predicate. Returns true if the entry should be rendered given the
 * current filter state.
 *
 * Rules:
 * - `entry.type === "message"`: dispatch by `entry.message.role` and gate
 *   through `showRoles`.
 * - `entry.type === "custom_message"` with `display === false`: always
 *   return false (mirrors the dispatcher in Message.tsx).
 * - `entry.type === "custom_message"` with `display === true`: gate through
 *   `showRoles.customMessage`.
 * - `entry.type` in { model_change, thinking_level_change, compaction,
 *   branch_summary, label, session_info, custom, session }: return
 *   `!filters.hideDividers`. Label / session_info / custom / session are
 *   no-ops today (the dispatcher renders them as null) but applying the
 *   predicate uniformly keeps semantics consistent.
 * - Anything else: defensive default — return true.
 */
type MessageRole = "user" | "assistant" | "toolResult" | "bashExecution";

const MESSAGE_ROLES = new Set<MessageRole>([
  "user",
  "assistant",
  "toolResult",
  "bashExecution",
]);

export function passesFilter(entry: SessionEntry, filters: Filters): boolean {
  if (entry.type === "message") {
    const role = entry.message.role;
    // Defensive: only consult showRoles if the role is one we know about.
    if (MESSAGE_ROLES.has(role)) {
      // toolResult entries with toolName="bash" are gated by the bash pill
      // (not the tool pill) — bash has its own pill in the UI and these
      // entries are overwhelmingly stored as toolResult, not bashExecution.
      if (role === "toolResult") {
        const toolName = entry.message.toolName;
        if (toolName === "bash") return filters.showRoles.bashExecution;
        return filters.showRoles.toolResult;
      }
      return filters.showRoles[role];
    }
    return true;
  }
  if (entry.type === "custom_message") {
    if (!entry.display) return false;
    return filters.showRoles.customMessage;
  }
  switch (entry.type) {
    case "model_change":
    case "thinking_level_change":
    case "compaction":
    case "branch_summary":
    case "label":
    case "session_info":
    case "custom":
    case "session":
      return !filters.hideDividers;
    default:
      return true;
  }
}

/**
 * Returns a new Filters object with the named role toggle flipped.
 */
export function toggleRole(filters: Filters, role: RoleFilter): Filters {
  return {
    ...filters,
    showRoles: {
      ...filters.showRoles,
      [role]: !filters.showRoles[role],
    },
  };
}

/**
 * Returns a new Filters object with `hideDividers` flipped.
 */
export function toggleHideDividers(filters: Filters): Filters {
  return { ...filters, hideDividers: !filters.hideDividers };
}

/**
 * Returns a new Filters object with `showThinking` flipped.
 */
export function toggleThinking(filters: Filters): Filters {
  return { ...filters, showThinking: !filters.showThinking };
}