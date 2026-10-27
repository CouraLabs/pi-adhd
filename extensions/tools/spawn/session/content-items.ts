import type { TextContent, ToolCall } from "@earendil-works/pi-ai";

export interface AssistantContentParts {
  textParts: string[];
  toolNames: string[];
}

export function getToolCallName(c: { type: string }): string {
  if (c.type !== "toolCall") return "unknown";
  return (c as ToolCall).name;
}

export function extractAssistantContent(
  content: ReadonlyArray<{ type: string }>,
): AssistantContentParts {
  const textParts: string[] = [];
  const toolNames: string[] = [];
  for (const c of content) {
    if (c.type === "text") {
      const text = (c as TextContent).text;
      if (text) textParts.push(text);
    } else if (c.type === "toolCall") {
      toolNames.push(getToolCallName(c));
    }
  }
  return { textParts, toolNames };
}
