// tests/helpers/makeSession.ts
// Creates JSONL session files in a tmp directory for use in tests.

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

export interface MessageOpts {
  role: "user" | "assistant" | "toolResult" | "bashExecution";
  content?: string;
  toolCallId?: string;
  toolName?: string;
  command?: string;
  output?: string;
  exitCode?: number;
}

export interface MakeSessionOpts {
  cwd?: string;
  messages?: MessageOpts[];
  compactionAt?: number;
  name?: string;
  /** Optional explicit session id; otherwise a fresh UUID. */
  sessionId?: string;
  /** When true, splits at index 1 producing two branches (for branch tests). */
  branchAt?: number;
  /** When true, adds an orphan entry not connected to any chain (orphan test). */
  orphan?: boolean;
  /** When set, emits a `custom` agent-xpto-parent marker with this parentSessionId. */
  parentMarker?: string;
}

function hex8(seed: number): string {
  // Deterministic 8-char hex from a counter — easier to assert against.
  return seed.toString(16).padStart(8, "0");
}

export function makeSession(
  tmpRoot: string,
  opts: MakeSessionOpts,
): { filepath: string; id: string } {
  const cwd = opts.cwd ?? "/Users/test/project";
  const encoded = "--" + cwd.replace(/^\//, "").replace(/\/$/, "").replace(/\//g, "-") + "--";
  const dir = join(tmpRoot, encoded);
  mkdirSync(dir, { recursive: true });

  const id = opts.sessionId ?? randomUUID();
  const lines: string[] = [];
  lines.push(
    JSON.stringify({
      type: "session",
      version: 3,
      id,
      timestamp: "2026-01-01T00:00:00.000Z",
      cwd,
    }),
  );

  let parentId: string | null = null;
  let counter = 1;
  const messages = opts.messages ?? [];

  // Track split point for branching test.
  let splitDone = false;
  let branchChildId: string | null = null;

  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    const id8 = hex8(counter++);

    // Branch handling: at the configured index, create a side-branch off the
    // current parent instead of continuing the main chain.
    if (opts.branchAt !== undefined && i === opts.branchAt && !splitDone) {
      // Side branch: this entry's parent is the current parent, sibling id.
      branchChildId = id8;
      // Build the entry but use the *current* parent as parentId (side chain).
      lines.push(
        JSON.stringify(buildMessage(id8, parentId, m)),
      );
      splitDone = true;
      continue;
    }
    if (opts.branchAt !== undefined && splitDone && i > (opts.branchAt ?? 0) && parentId !== branchChildId) {
      // After the split, continue main chain but the branch child stays as a sibling.
      // Don't update parentId to branchChildId; keep main chain going forward.
      // The side branch becomes orphaned from the leaf perspective; the main
      // chain continues and wins as the active leaf.
    }

    if (opts.compactionAt !== undefined && i === opts.compactionAt) {
      // Emit a compaction entry here, then continue the chain afterwards.
      const compactionId = hex8(counter++);
      lines.push(
        JSON.stringify({
          type: "compaction",
          id: compactionId,
          parentId,
          timestamp: "2026-01-01T00:00:00.000Z",
          summary: "## Summary\nThe conversation has been compacted.",
          firstKeptEntryId: id8, // next entry will be the first kept
          tokensBefore: 12345,
          details: { readFiles: [], modifiedFiles: [] },
          fromHook: false,
        }),
      );
      parentId = compactionId;
    }

    lines.push(JSON.stringify(buildMessage(id8, parentId, m)));
    parentId = id8;
  }

  if (opts.name) {
    const infoId = hex8(counter++);
    lines.push(
      JSON.stringify({
        type: "session_info",
        id: infoId,
        parentId,
        timestamp: "2026-01-01T00:00:00.000Z",
        name: opts.name,
      }),
    );
    parentId = infoId;
  }

  if (opts.parentMarker !== undefined) {
    const markerId = hex8(counter++);
    lines.push(
      JSON.stringify({
        type: "custom",
        id: markerId,
        parentId,
        timestamp: "2026-01-01T00:00:00.000Z",
        customType: "agent-xpto-parent",
        data: {
          parentSessionId: opts.parentMarker,
          parentSessionFile: "parent-session.jsonl",
          runId: "run-1",
          targetAgentId: "subagent-1",
          timestamp: "2026-01-01T00:00:00.000Z",
        },
      }),
    );
    parentId = markerId;
  }

  if (opts.orphan) {
    const orphanId = hex8(0xdead);
    lines.push(
      JSON.stringify({
        type: "message",
        id: orphanId,
        parentId: "0000ffff", // points to nothing in this file
        timestamp: "2026-01-01T00:00:00.000Z",
        message: {
          role: "user",
          content: [{ type: "text", text: "orphan" }],
          timestamp: 0,
        },
      }),
    );
  }

  const filename = `2026-01-01T00-00-00-000Z_${id}.jsonl`;
  const filepath = join(dir, filename);
  writeFileSync(filepath, lines.join("\n") + "\n", "utf8");
  return { filepath, id };
}

function buildMessage(id8: string, parentId: string | null, m: MessageOpts): unknown {
  const ts = "2026-01-01T00:00:00.000Z";
  switch (m.role) {
    case "user":
      return {
        type: "message",
        id: id8,
        parentId,
        timestamp: ts,
        message: {
          role: "user",
          content: [{ type: "text", text: m.content ?? "" }],
          timestamp: 0,
        },
      };
    case "assistant":
      return {
        type: "message",
        id: id8,
        parentId,
        timestamp: ts,
        message: {
          role: "assistant",
          content: [{ type: "text", text: m.content ?? "" }],
          timestamp: 0,
        },
      };
    case "toolResult":
      return {
        type: "message",
        id: id8,
        parentId,
        timestamp: ts,
        message: {
          role: "toolResult",
          toolCallId: m.toolCallId ?? "call_x",
          toolName: m.toolName ?? "read",
          content: [{ type: "text", text: m.content ?? "" }],
          isError: false,
          timestamp: 0,
        },
      };
    case "bashExecution":
      return {
        type: "message",
        id: id8,
        parentId,
        timestamp: ts,
        message: {
          role: "bashExecution",
          command: m.command ?? "echo hi",
          output: m.output ?? "hi\n",
          exitCode: m.exitCode ?? 0,
          cancelled: false,
          truncated: false,
          timestamp: 0,
        },
      };
  }
}
