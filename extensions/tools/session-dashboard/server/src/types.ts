// src/types.ts
// Frontend mirror of server.ts types. Field names match exactly.

export type ContentBlock =
  | { type: "text"; text: string }
  | { type: string; [k: string]: unknown };

export type MessageBody =
  | { role: "user"; content: ContentBlock[]; timestamp: number }
  | {
      role: "assistant";
      content: ContentBlock[];
      timestamp: number;
      api?: string;
      provider?: string;
      model?: string;
      usage?: unknown;
      stopReason?: string;
      rawStopReason?: string;
      errorMessage?: string;
      responseId?: string;
      responseModel?: string;
      details?: unknown;
    }
  | {
      role: "toolResult";
      toolCallId: string;
      toolName: string;
      content: ContentBlock[];
      isError: boolean;
      timestamp: number;
      details?: unknown;
      errorMessage?: string;
    }
  | {
      role: "bashExecution";
      command: string;
      output: string;
      exitCode: number;
      cancelled: boolean;
      truncated: boolean;
      timestamp: number;
      excludeFromContext?: boolean;
    };

export type SessionEntry =
  | {
      type: "session";
      version: number;
      id: string;
      timestamp: string;
      cwd: string;
      parentSession?: string;
    }
  | { type: "message"; id: string; parentId: string | null; timestamp: string; message: MessageBody }
  | {
      type: "model_change";
      id: string;
      parentId: string | null;
      timestamp: string;
      provider: string;
      modelId: string;
    }
  | {
      type: "thinking_level_change";
      id: string;
      parentId: string | null;
      timestamp: string;
      thinkingLevel: string;
    }
  | {
      type: "compaction";
      id: string;
      parentId: string | null;
      timestamp: string;
      summary: string;
      firstKeptEntryId: string;
      tokensBefore: number;
      details?: { readFiles?: string[]; modifiedFiles?: string[] };
      fromHook?: boolean;
      usage?: unknown;
    }
  | {
      type: "branch_summary";
      id: string;
      parentId: string | null;
      timestamp: string;
      summary: string;
      fromHook?: boolean;
    }
  | {
      type: "session_info";
      id: string;
      parentId: string | null;
      timestamp: string;
      name?: string;
    }
  | { type: "label"; id: string; parentId: string | null; timestamp: string; label: string }
  | {
      type: "custom";
      id: string;
      parentId: string | null;
      timestamp: string;
      customType: string;
      data: unknown;
    }
  | {
      type: "custom_message";
      id: string;
      parentId: string | null;
      timestamp: string;
      customType: string;
      content: string;
      display: boolean;
    };

export interface SessionListItem {
  id: string;
  cwd: string;
  name: string | null;
  createdAt: string;
  lastActivity: string;
  messageCount: number;
  sizeBytes: number;
  preview: string;
  /** Parent session id recorded by an `agent-xpto-parent` custom marker, if any. */
  parentSession?: string;
}

export interface SessionChildrenResponse {
  parent: string;
  children: string[];
}

export interface SessionStats {
  /** Tokens reported in the most recent assistant message's `usage`. */
  latestContextTokens: number;
  /** Sum of `usage.input` across all assistant messages on the branch. */
  totalInputTokens: number;
  /** Sum of `usage.output` across all assistant messages on the branch. */
  totalOutputTokens: number;
  /** Count of assistant messages on the branch. */
  turns: number;
  /** Count of `toolResult` messages on the branch (all tool names, including `bash`, `read`, `call`, etc.). */
  toolCalls: number;
  /** Count of `toolResult` messages on the branch whose `message.toolName === "call"` (Pi's built-in agent-delegation tool). Always `<= toolCalls`. */
  agentCalls: number;
  /** Count of `compaction` entries on the branch. */
  compactions: number;
  /** Newest entry's ISO timestamp on the branch, or `null` if branch is empty. Same value as `branch[0]?.timestamp`. */
  lastTimestamp: string | null;
  /** Oldest entry's ISO timestamp on the branch, or `null` if branch is empty. Same value as `branch[branch.length - 1]?.timestamp`. */
  firstTimestamp: string | null;
  /** Model string of the most recent assistant message on the branch, plus the count of assistant messages that used it consecutively from the leaf backwards (a different model in between breaks the run). `null` if no assistant message with a model string is on the branch. */
  latestModel: { model: string; turns: number } | null;
  /** Cache hit rate as an integer 0..100: `round(100 * totalCacheRead / (totalInputTokens + totalCacheRead))`. `0` when neither input nor cacheRead were seen on the branch. */
  cacheHitPercent: number;
}

export interface SessionDetail {
  header: {
    id: string;
    version: number;
    timestamp: string;
    cwd: string;
    parentSession?: string;
  };
  branch: SessionEntry[];
  totalEntries: number;
  /** Absolute path of the session's JSONL file on disk. Server always
   * sends it; optional in the type so older mocks/fixtures stay valid. */
  filePath?: string;
  stats?: SessionStats;
}
