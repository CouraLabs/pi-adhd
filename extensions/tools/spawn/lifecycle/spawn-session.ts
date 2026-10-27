import type { Model } from "@earendil-works/pi-ai";
import {
  type AgentSession,
  type AgentSessionEvent,
  type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import type { ChildLifecyclePublisher } from "./child-lifecycle.ts";
import { emitChildSessionShutdown } from "./child-shutdown.ts";
import {
  normalizeMaxTurns,
  type TurnBudget,
  type TurnBudgetAction,
  TurnBudgetTracker,
  type TurnOutcome,
} from "./turn-limits.ts";
import { getSessionContextPercent, type SessionStatsLike } from "./usage.ts";
import { extractText } from "../session/context.ts";
import { getAgentConversation } from "../session/conversation.ts";
import { debugLog } from "../debug.ts";
import type { SessionMessage, ThinkingLevel } from "../types.ts";

export interface TurnLoopResult {
  responseText: string;

  turnBudget: TurnBudget;
}

export interface TurnLoopOptions {

  maxTurns?: number;

  defaultMaxTurns?: number;

  wrapUpTurns?: number;
  signal?: AbortSignal;

  onTurnBudget?: (budget: TurnBudget) => void;
}

export interface ResumeTurnLoopOptions {
  signal?: AbortSignal;

  onTurnBudget?: (budget: TurnBudget) => void;
}

export interface SpawnSessionMeta {

  outputFile: string | undefined;

  sessionId: string;

  sessionDir: string;
  agentName: string;

  agentMaxTurns: number | undefined;

  parentContext: string | undefined;
  lifecycle: ChildLifecyclePublisher;
}

export class SpawnSession {
  private disposed = false;

  private turnLimits: { maxTurns?: number; wrapUpTurns: number } = { wrapUpTurns: DEFAULT_WRAP_UP_TURNS };

  private readonly turnFailure: ReturnType<typeof collectTurnFailure>;

  constructor(
    private readonly _session: AgentSession,
    private readonly meta: SpawnSessionMeta,
  ) {
    this.turnFailure = collectTurnFailure(_session);
  }

  get session(): AgentSession {
    return this._session;
  }

  get outputFile(): string | undefined {
    return this.meta.outputFile;
  }

  get model(): Model<any> | undefined {
    return this._session.model;
  }

  get thinkingLevel(): ThinkingLevel {
    return this._session.thinkingLevel;
  }

  async runTurnLoop(prompt: string, opts: TurnLoopOptions): Promise<TurnLoopResult> {
    const session = this._session;
    this.turnLimits = {
      maxTurns: normalizeMaxTurns(opts.maxTurns ?? this.meta.agentMaxTurns ?? opts.defaultMaxTurns),
      wrapUpTurns: opts.wrapUpTurns ?? DEFAULT_WRAP_UP_TURNS,
    };
    const tracker = new TurnBudgetTracker(this.turnLimits);
    const unsubTurns = this.enforceTurnBudget(tracker, opts.onTurnBudget);
    const collector = collectResponseText(session);
    const cleanupAbort = forwardAbortSignal(session, opts.signal);

    const effectivePrompt = this.meta.parentContext
      ? this.meta.parentContext + prompt
      : prompt;

    try {
      await session.prompt(effectivePrompt);
      failIfProviderErrored(this.turnFailure.getFailure());
      this.meta.lifecycle.completed({
        sessionDir: this.meta.sessionDir,
        agentName: this.meta.agentName,
        turnBudget: tracker.budget,
      });
    } finally {
      unsubTurns();
      collector.unsubscribe();
      cleanupAbort();
    }

    const responseText = collector.getText().trim() || getLastAssistantText(session);
    return { responseText, turnBudget: tracker.budget };
  }

  private enforceTurnBudget(
    tracker: TurnBudgetTracker,
    report: ((budget: TurnBudget) => void) | undefined,
  ): () => void {
    if (tracker.warnBeforeFirstTurn()) this.sendBudgetWarning(tracker);
    report?.(tracker.budget);
    return this._session.subscribe((event: AgentSessionEvent) => {
      if (event.type === "turn_end") {
        this.actOnTurnBudget(tracker, tracker.onTurnEnd(turnOutcome(event)));
        report?.(tracker.budget);
      } else if (event.type === "turn_start") {
        const action = tracker.onTurnStart();
        this.actOnTurnBudget(tracker, action);
        if (action) report?.(tracker.budget);
      }
    });
  }

  private actOnTurnBudget(tracker: TurnBudgetTracker, action: TurnBudgetAction): void {
    if (action === "warn") this.sendBudgetWarning(tracker);

    else if (action === "stop") this._session.abort().catch((err) => debugLog("turn-budget abort", err));
  }

  private sendBudgetWarning(tracker: TurnBudgetTracker): void {

    this._session
      .sendCustomMessage(
        {
          customType: TURN_BUDGET_WARNING_TYPE,
          content: budgetWarningText(tracker.remaining ?? 0),
          display: true,
        },
        { triggerTurn: false },
      )
      .catch((err) => debugLog("turn-budget warning", err));
  }

  async resumeTurnLoop(prompt: string, opts: ResumeTurnLoopOptions): Promise<TurnLoopResult> {
    const session = this._session;
    const tracker = new TurnBudgetTracker(this.turnLimits);
    const unsubTurns = this.enforceTurnBudget(tracker, opts.onTurnBudget);
    const collector = collectResponseText(session);
    const cleanupAbort = forwardAbortSignal(session, opts.signal);

    try {
      await session.prompt(prompt);
      failIfProviderErrored(this.turnFailure.getFailure());
    } finally {
      unsubTurns();
      collector.unsubscribe();
      cleanupAbort();
    }

    const responseText = collector.getText().trim() || getLastAssistantText(session);
    return { responseText, turnBudget: tracker.budget };
  }

  getConversation(): string {
    return getAgentConversation(this._session);
  }

  getContextPercent(): number | null {
    return getSessionContextPercent(this._session);
  }

  subscribe(fn: (event: AgentSessionEvent) => void): () => void {
    return this._session.subscribe(fn);
  }

  getSessionStats(): SessionStatsLike {
    return this._session.getSessionStats();
  }

  get messages(): readonly unknown[] {
    return this._session.messages;
  }

  get agentMessages(): readonly SessionMessage[] {
    return this._session.messages;
  }

  getToolDefinition(name: string): ToolDefinition | undefined {
    return this._session.getToolDefinition(name);
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    this.turnFailure.unsubscribe();
    await emitChildSessionShutdown(this._session);

    this._session.dispose?.();
    this.meta.lifecycle.disposed({ sessionId: this.meta.sessionId });
  }
}

const PROVIDER_ERROR_WITHOUT_MESSAGE = "provider reported an error with no message";

function failIfProviderErrored(failure: string | undefined): void {
  if (failure) throw new Error(failure);
}

function collectTurnFailure(session: AgentSession) {
  let failure = readLastTurnFailure(session);
  const unsubscribe = session.subscribe((event: AgentSessionEvent) => {
    if (event.type !== "message_end" || event.message.role !== "assistant") return;
    failure =
      event.message.stopReason === "error"
        ?
          event.message.errorMessage || PROVIDER_ERROR_WITHOUT_MESSAGE
        : undefined;
  });
  return { getFailure: () => failure, unsubscribe };
}

function readLastTurnFailure(session: AgentSession): string | undefined {
  for (let i = session.messages.length - 1; i >= 0; i--) {
    const msg = session.messages[i];
    if (msg.role !== "assistant") continue;
    if (msg.stopReason !== "error") return undefined;

    return msg.errorMessage || PROVIDER_ERROR_WITHOUT_MESSAGE;
  }
  return undefined;
}

const TURN_BUDGET_WARNING_TYPE = "spawn:turn-budget-warning";

const DEFAULT_WRAP_UP_TURNS = 2;

function budgetWarningText(remaining: number): string {
  const turns = remaining === 1 ? "1 turn" : `${remaining} turns`;
  return (
    `Turn budget: you have ${turns} left, including this one. ` +
    "The harness stops you after that. Finish your work and give your final answer within that budget."
  );
}

function turnOutcome(event: Extract<AgentSessionEvent, { type: "turn_end" }>): TurnOutcome {
  const stopReason = event.message.role === "assistant" ? event.message.stopReason : undefined;
  return {
    failed: stopReason === "error" || stopReason === "aborted",
    ranTools: event.toolResults.length > 0,
  };
}

function collectResponseText(session: AgentSession) {
  let text = "";
  const unsubscribe = session.subscribe((event: AgentSessionEvent) => {
    if (event.type === "message_start") {
      text = "";
    }
    if (
      event.type === "message_update" &&
      event.assistantMessageEvent.type === "text_delta"
    ) {
      text += event.assistantMessageEvent.delta;
    }
  });
  return { getText: () => text, unsubscribe };
}

function getLastAssistantText(session: AgentSession): string {
  for (let i = session.messages.length - 1; i >= 0; i--) {
    const msg = session.messages[i];
    if (msg.role !== "assistant") continue;
    const text = extractText(msg.content).trim();
    if (text) return text;
  }
  return "";
}

function forwardAbortSignal(
  session: AgentSession,
  signal?: AbortSignal,
): () => void {
  if (!signal) return () => {};
  const onAbort = (): void => {
    void session.abort().catch(() => {});
  };

  if (signal.aborted) {
    onAbort();
    return () => {};
  }
  signal.addEventListener("abort", onAbort, { once: true });
  return () => signal.removeEventListener("abort", onAbort);
}
