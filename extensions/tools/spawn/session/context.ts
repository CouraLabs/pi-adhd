import type { TextContent } from "@earendil-works/pi-ai";
import type { SessionContext } from "../types.ts";

type MessageEntry = {
  type: "message";
  message: { role: string; content: string | { type: string }[] };
};
type CompactionEntry = { type: "compaction"; summary?: string };
type BranchEntry = MessageEntry | CompactionEntry | { type: string };

function isTextContent(c: unknown): c is TextContent {
  return typeof c === "object" && c !== null && (c as { type: string }).type === "text";
}

export function extractText(content: unknown[]): string {
  return content
    .filter(isTextContent)
    .map((c) => c.text)
    .join("\n");
}

function formatMessageEntry(entry: MessageEntry): string | undefined {
  const msg = entry.message;
  const text = typeof msg.content === "string" ? msg.content : extractText(msg.content);
  if (!text.trim()) return undefined;
  if (msg.role === "user") return `[User]: ${text.trim()}`;
  if (msg.role === "assistant") return `[Assistant]: ${text.trim()}`;
  return undefined;
}

function formatCompactionEntry(entry: CompactionEntry): string | undefined {
  return entry.summary ? `[Summary]: ${entry.summary}` : undefined;
}

function formatBranchEntry(entry: BranchEntry): string | undefined {
  if (entry.type === "message") return formatMessageEntry(entry as MessageEntry);
  if (entry.type === "compaction") return formatCompactionEntry(entry as CompactionEntry);
  return undefined;
}

export function buildParentContext(ctx: SessionContext): string {
  const entries = ctx.sessionManager.getBranch();

  if (!entries || entries.length === 0) return "";

  const parts = (entries as BranchEntry[])
    .map(formatBranchEntry)
    .filter((p): p is string => p !== undefined);

  if (parts.length === 0) return "";

  return `# Parent Conversation Context
The following is the conversation history from the parent session that spawned you.
Use this context to understand what has been discussed and decided so far.

${parts.join("\n\n")}

---
# Your Task (below)
`;
}
