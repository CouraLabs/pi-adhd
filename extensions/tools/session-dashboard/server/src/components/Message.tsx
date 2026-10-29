// src/components/Message.tsx
// Dispatcher that renders any SessionEntry into its appropriate component.
// ToolResults are visually grouped with the assistant message that produced
// them by looking ahead at subsequent entries.

import type { JSX } from "react";
import type { SessionEntry, MessageBody } from "../types";
import { EntryDivider } from "./EntryDivider";
import { UserMessage } from "./UserMessage";
import { AssistantMessage } from "./AssistantMessage";
import { ToolResult } from "./ToolResult";
import { BashExecution } from "./BashExecution";
import { CustomMessage } from "./CustomMessage";
import { Compaction } from "./Compaction";
import { BranchSummary } from "./BranchSummary";

export interface MessageProps {
  entries: SessionEntry[];
  index: number;
  /**
   * Set of leaf-first indices that pass the current filter predicate.
   * When provided, the dispatcher uses it to decide whether an adjacent
   * assistant/toolResult participates in the visual group, so toggling
   * filters hides nested toolResults correctly. When undefined, every
   * entry is treated as visible (existing single-entry test behavior).
   */
  visibleIndices?: ReadonlySet<number>;
  /**
   * Content-level toggle: when true, AssistantMessage renders thinking
   * blocks as collapsible details. Default false (silently dropped).
   */
  showThinking?: boolean;
}

function renderMessageBody(
  body: MessageBody,
  id: string | undefined,
  showThinking?: boolean,
): JSX.Element {
  switch (body.role) {
    case "user":
      return <UserMessage content={body.content} timestamp={body.timestamp} />;
    case "assistant":
      return (
        <AssistantMessage
          content={body.content}
          id={id}
          timestamp={body.timestamp}
          showThinking={showThinking}
        />
      );
    case "toolResult":
      return (
        <ToolResult
          toolCallId={body.toolCallId}
          toolName={body.toolName}
          content={body.content}
          isError={body.isError}
          errorMessage={body.errorMessage}
        />
      );
    case "bashExecution":
      return (
        <BashExecution
          command={body.command}
          output={body.output}
          exitCode={body.exitCode}
          cancelled={body.cancelled}
          truncated={body.truncated}
        />
      );
  }
}

function isToolResult(
  entry: SessionEntry | undefined,
): entry is Extract<SessionEntry, { type: "message" }> & {
  message: { role: "toolResult" };
} {
  return (
    !!entry &&
    entry.type === "message" &&
    entry.message.role === "toolResult"
  );
}

export function Message({
  entries,
  index,
  visibleIndices,
  showThinking,
}: MessageProps): JSX.Element | null {
  const entry = entries[index];
  if (!entry) return null;

  // If this entry is a toolResult that is visually absorbed into a preceding
  // assistant's group, render nothing here — the dispatcher at the assistant's
  // index already produced the merged group. With visibleIndices provided,
  // only absorb if the preceding assistant is itself currently visible
  // (otherwise a hidden assistant would still "swallow" a visible
  // toolResult and leave nothing in its place).
  if (
    entry.type === "message" &&
    entry.message.role === "toolResult" &&
    index > 0
  ) {
    const prev = entries[index - 1];
    if (prev && prev.type === "message" && prev.message.role === "assistant") {
      if (!visibleIndices || visibleIndices.has(index - 1)) {
        return null;
      }
    }
  }

  switch (entry.type) {
    case "message": {
      const m = entry.message;
      if (m.role === "assistant") {
        // Look ahead: collect consecutive toolResults as siblings.
        // visibleIndices gates which siblings are rendered; hidden ones are
        // skipped (not absorbed) so visible siblings still group visually.
        const toolResults: JSX.Element[] = [];
        let i = index + 1;
        while (i < entries.length) {
          const next = entries[i];
          if (!isToolResult(next)) break;
          if (visibleIndices && !visibleIndices.has(i)) {
            i++;
            continue;
          }
          toolResults.push(
            <span key={next.id}>{renderMessageBody(next.message, next.id)}</span>,
          );
          i++;
        }
        return (
          <div className="message-group message-group-assistant">
            {renderMessageBody(m, entry.id, showThinking)}
            {toolResults.length > 0 ? (
              <div className="message-group-children">
                {toolResults}
              </div>
            ) : null}
          </div>
        );
      }
      if (m.role === "toolResult") {
        // Orphan toolResult (no preceding assistant on the branch, or the
        // preceding assistant is currently filtered out). Render standalone;
        // subsequent toolResults still group visually.
        const toolResults: JSX.Element[] = [
          <span key={entry.id}>{renderMessageBody(m, entry.id)}</span>,
        ];
        let i = index + 1;
        while (i < entries.length) {
          const next = entries[i];
          if (!isToolResult(next)) break;
          if (visibleIndices && !visibleIndices.has(i)) {
            i++;
            continue;
          }
          toolResults.push(
            <span key={next.id}>{renderMessageBody(next.message, next.id)}</span>,
          );
          i++;
        }
        return (
          <div className="message-group message-group-toolresults">
            {toolResults}
          </div>
        );
      }
      return renderMessageBody(m, entry.id);
    }
    case "model_change":
      return (
        <EntryDivider>{`Model: ${entry.provider}/${entry.modelId}`}</EntryDivider>
      );
    case "thinking_level_change":
      return (
        <EntryDivider>{`Thinking: ${entry.thinkingLevel}`}</EntryDivider>
      );
    case "compaction":
      return (
        <Compaction
          summary={entry.summary}
          tokens={entry.tokensBefore}
          details={entry.details}
        />
      );
    case "branch_summary":
      return <BranchSummary summary={entry.summary} />;
    case "label":
    case "session_info":
    case "custom":
    case "session":
      return null;
    case "custom_message":
      return entry.display ? (
        <CustomMessage
          customType={entry.customType}
          content={entry.content}
          display={entry.display}
        />
      ) : null;
  }
}
