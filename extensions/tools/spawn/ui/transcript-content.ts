import {
  AssistantMessageComponent,
  BashExecutionComponent,
  BranchSummaryMessageComponent,
  CompactionSummaryMessageComponent,
  parseSkillBlock,
  SkillInvocationMessageComponent,
  ToolExecutionComponent,
  UserMessageComponent,
} from "@earendil-works/pi-coding-agent";
import { Container, type MarkdownTheme, Spacer, type TUI, truncateToWidth } from "@earendil-works/pi-tui";
import type { AgentSessionEvent, SessionMessage } from "../types.ts";
import { describeActivity } from "./display.ts";
import { GLYPHS } from "./glyphs.ts";
import type { TranscriptSource } from "./session-navigation.ts";

export interface TranscriptContentOptions {
  tui: TUI;
  cwd: string;
  markdownTheme: MarkdownTheme;
  source: TranscriptSource;
}

export class TranscriptContent {
  private readonly options: TranscriptContentOptions;

  private blocks: SettledBlock[] = [];

  private consumedCount = 0;

  private lastConsumed: SessionMessage | undefined;

  private hasVisibleContent = false;

  private readonly pendingTools = new Map<string, PendingTool>();

  private settledWidth: number | undefined;

  private settledRows: readonly string[] | undefined;

  private inFlight: AssistantMessageComponent | undefined;

  private inFlightWidth: number | undefined;
  private inFlightRows: readonly string[] | undefined;

  constructor(options: TranscriptContentOptions) {
    this.options = options;
    this.consumeSettled();
  }

  lineCount(width: number): number {
    if (width <= 0) return 0;
    return this.settled(width).length + this.tail(width).length;
  }

  slice(width: number, start: number, count: number): string[] {
    if (width <= 0) return [];
    const settled = this.settled(width);
    const end = start + count;
    const rows = settled.slice(start, Math.min(end, settled.length));
    if (end > settled.length) {
      const tail = this.tail(width);
      rows.push(...tail.slice(Math.max(0, start - settled.length), end - settled.length));
    }
    return rows;
  }

  apply(event?: AgentSessionEvent): void {
    const partial = inFlightAssistantMessage(event);
    if (partial) {
      this.updateInFlight(partial);
      return;
    }
    if (event?.type === "agent_end" || event?.type === "compaction_end") {
      this.reset();
    } else if (event?.type === "message_end") {
      this.clearInFlight();
    }
    this.consumeSettled();
  }

  invalidate(): void {
    for (const block of this.blocks) {
      block.container.invalidate();
      block.rows = undefined;
    }
    this.settledRows = undefined;
    this.inFlight?.invalidate();
    this.inFlightRows = undefined;
  }

  private settled(width: number): readonly string[] {
    if (this.settledWidth !== width) {
      this.settledWidth = width;
      for (const block of this.blocks) block.rows = undefined;
      this.settledRows = undefined;
    }
    if (this.settledRows) return this.settledRows;
    const rows: string[] = [];
    for (const block of this.blocks) {
      block.rows ??= block.container.render(width).map((row) => truncateToWidth(row, width));
      rows.push(...block.rows);
    }
    this.settledRows = rows;
    return rows;
  }

  private tail(width: number): readonly string[] {
    const rows = [...this.inFlightRendered(width)];
    const streaming = this.options.source.streaming();
    if (streaming) {
      const activity = `${GLYPHS.streaming} ${describeActivity(streaming.activeTools, streaming.responseText)}`;
      rows.push("", truncateToWidth(activity, width));
    }
    return rows;
  }

  private inFlightRendered(width: number): readonly string[] {
    if (!this.inFlight) return [];
    if (this.inFlightWidth !== width) {
      this.inFlightWidth = width;
      this.inFlightRows = undefined;
    }
    this.inFlightRows ??= this.inFlight.render(width).map((row) => truncateToWidth(row, width));
    return this.inFlightRows;
  }

  private updateInFlight(message: AssistantSessionMessage): void {
    if (this.inFlight) this.inFlight.updateContent(message);
    else this.inFlight = new AssistantMessageComponent(message, false, this.options.markdownTheme);
    this.inFlightRows = undefined;
  }

  private clearInFlight(): void {
    this.inFlight = undefined;
    this.inFlightRows = undefined;
  }

  private reset(): void {
    this.blocks = [];
    this.consumedCount = 0;
    this.lastConsumed = undefined;
    this.hasVisibleContent = false;
    this.pendingTools.clear();
    this.settledRows = undefined;
    this.clearInFlight();
  }

  private consumeSettled(): void {
    const messages = this.options.source.getMessages();
    if (this.hasRewrittenHistory(messages)) this.reset();
    if (messages.length === this.consumedCount) return;
    for (let i = this.consumedCount; i < messages.length; i++) this.consumeMessage(messages[i]);
    this.consumedCount = messages.length;
    this.lastConsumed = messages.at(-1);
    this.settledRows = undefined;
  }

  private hasRewrittenHistory(messages: readonly SessionMessage[]): boolean {
    if (messages.length < this.consumedCount) return true;
    return this.consumedCount > 0 && messages[this.consumedCount - 1] !== this.lastConsumed;
  }

  private consumeMessage(message: SessionMessage): void {
    switch (message.role) {
      case "assistant":
        this.consumeAssistant(message);
        break;
      case "toolResult":
        this.consumeToolResult(message);
        break;
      case "user":
        this.consumeUser(message);
        break;
      case "bashExecution":
        this.consumeBashExecution(message);
        break;
      case "compactionSummary":
        this.consumeSummary(new CompactionSummaryMessageComponent(message, this.options.markdownTheme));
        break;
      case "branchSummary":
        this.consumeSummary(new BranchSummaryMessageComponent(message, this.options.markdownTheme));
        break;
    }
  }

  private consumeAssistant(message: AssistantSessionMessage): void {
    const block = this.appendBlock();
    block.container.addChild(new AssistantMessageComponent(message, false, this.options.markdownTheme));
    for (const content of message.content) {
      if (content.type !== "toolCall") continue;
      const tool = new ToolExecutionComponent(
        content.name,
        content.id,
        content.arguments,
        { showImages: false },
        this.options.source.getToolDefinition(content.name),
        this.options.tui,
        this.options.cwd,
      );
      tool.setExpanded(true);
      block.container.addChild(tool);
      this.pendingTools.set(content.id, { component: tool, block });
    }
    this.hasVisibleContent = true;
  }

  private consumeToolResult(message: Extract<SessionMessage, { role: "toolResult" }>): void {
    const pending = this.pendingTools.get(message.toolCallId);
    if (!pending) return;
    pending.component.updateResult(message);
    pending.block.rows = undefined;
    this.settledRows = undefined;
    this.pendingTools.delete(message.toolCallId);
  }

  private consumeUser(message: Extract<SessionMessage, { role: "user" }>): void {
    const block = this.appendBlock();
    addUserComponents(block.container, message.content, this.options.markdownTheme, this.hasVisibleContent);
    if (block.container.children.length > 0) this.hasVisibleContent = true;
  }

  private consumeBashExecution(message: Extract<SessionMessage, { role: "bashExecution" }>): void {
    const block = this.appendBlock();
    const bash = new BashExecutionComponent(message.command, this.options.tui, message.excludeFromContext);
    if (message.output) bash.appendOutput(message.output);
    bash.setComplete(message.exitCode, message.cancelled, undefined, message.fullOutputPath);
    block.container.addChild(bash);
    this.hasVisibleContent = true;
  }

  private consumeSummary(
    summary: CompactionSummaryMessageComponent | BranchSummaryMessageComponent,
  ): void {
    const block = this.appendBlock();
    block.container.addChild(new Spacer(1));
    summary.setExpanded(true);
    block.container.addChild(summary);
    this.hasVisibleContent = true;
  }

  private appendBlock(): SettledBlock {
    const block: SettledBlock = { container: new Container(), rows: undefined };
    this.blocks.push(block);
    return block;
  }
}

interface SettledBlock {
  readonly container: Container;
  rows: readonly string[] | undefined;
}

interface PendingTool {
  readonly component: ToolExecutionComponent;
  readonly block: SettledBlock;
}

type AssistantSessionMessage = Extract<SessionMessage, { role: "assistant" }>;

function inFlightAssistantMessage(event?: AgentSessionEvent): AssistantSessionMessage | undefined {
  if (event?.type !== "message_start" && event?.type !== "message_update") return undefined;
  return event.message.role === "assistant" ? event.message : undefined;
}

function addUserComponents(
  container: Container,
  content: string | readonly { type: string; text?: string }[],
  markdownTheme: MarkdownTheme,
  hasPrecedingContent: boolean,
): void {
  const text = userMessageText(content);
  if (!text) return;
  if (hasPrecedingContent) container.addChild(new Spacer(1));

  const skillBlock = parseSkillBlock(text);
  if (!skillBlock) {
    container.addChild(new UserMessageComponent(text, markdownTheme));
    return;
  }
  const skill = new SkillInvocationMessageComponent(skillBlock, markdownTheme);
  skill.setExpanded(true);
  container.addChild(skill);
  if (skillBlock.userMessage) {
    container.addChild(new Spacer(1));
    container.addChild(new UserMessageComponent(skillBlock.userMessage, markdownTheme));
  }
}

function userMessageText(content: string | readonly { type: string; text?: string }[]): string {
  if (typeof content === "string") return content;
  return content
    .filter((block) => block.type === "text")
    .map((block) => block.text ?? "")
    .join("");
}
