/**
 * agent-widget.ts — Persistent agent block rendered at the bottom of the pi-pack footer.
 *
 * Displays a tree of agents with animated spinners, live stats, and activity descriptions.
 * Publishes a footer section (see `shared/footer-sections.ts`) that the footer draws last.
 */

import type { TuiMode } from "@earendil-works/pi-tui";
import { registerFooterSection, type FooterSectionContext } from "../../../../shared/footer-sections.ts";
import { AgentTypeRegistry } from "../config/agent-types.ts";
import type { Subagent } from "../lifecycle/subagent.ts";
import type { SubagentManager, SubagentManagerObserver } from "../lifecycle/subagent-manager.ts";
import type { CompactionInfo } from "../types.ts";
import { ERROR_STATUSES } from "./display.ts";
import { renderWidgetLines, type WidgetAgent } from "./widget-renderer.ts";

// ---- Types ----

/** Minimal agent shape needed for widget lifecycle decisions. */
interface AgentSummary {
  readonly id: string;
  readonly status: string;
  readonly completedAt?: number;
}

/** Lightweight state snapshot used by AgentWidget.update() to decide what to show. */
export interface WidgetState {
  readonly runningCount: number;
  readonly queuedCount: number;
  readonly hasFinished: boolean;
  /** True when runningCount > 0 || queuedCount > 0. Included for call-site readability. */
  readonly hasActive: boolean;
}

/**
 * Count agents by status and return a lightweight state snapshot.
 * Pure function — no IO, no side effects. Exported for direct unit testing.
 */
export function assembleWidgetState(
  agents: readonly AgentSummary[],
  shouldShowFinished: (agentId: string, status: string) => boolean,
): WidgetState {
  let runningCount = 0;
  let queuedCount = 0;
  let hasFinished = false;
  for (const a of agents) {
    if (a.status === "running") { runningCount++; }
    else if (a.status === "queued") { queuedCount++; }
    else if (a.completedAt && shouldShowFinished(a.id, a.status)) { hasFinished = true; }
  }
  const hasActive = runningCount > 0 || queuedCount > 0;
  return { runningCount, queuedCount, hasFinished, hasActive };
}

/**
 * How often the widget re-renders while a subagent animates, per TUI mode.
 *
 * The widget is the only thing asking Pi for a frame while the parent idles,
 * and every frame walks the whole component tree, transcript included. Measured
 * against real session transcripts mounted on Pi's own renderers (pi-tui 1.0.0):
 *
 * - Fullscreen diffs only the visible rows and Pi's components cache their
 *   lines, so a frame costs under 1 ms even at 18k transcript lines (~1% of a
 *   core at 80 ms). It ticks at Pi's own `Loader` cadence.
 * - Regular mode's frame cost scales with the transcript (~9 ms at 18k lines),
 *   so 80 ms would cost ~11% of a core for as long as an agent runs; it keeps
 *   250 ms (~3.5%).
 *
 * An unknown mode (no footer frame rendered yet) takes the conservative
 * regular cadence.
 */
const FULLSCREEN_ANIMATION_MS = 80;
const REGULAR_ANIMATION_MS = 250;

function animationIntervalMs(mode: TuiMode | undefined): number {
  return mode === "fullscreen" ? FULLSCREEN_ANIMATION_MS : REGULAR_ANIMATION_MS;
}

// ---- Widget manager ----

export class AgentWidget implements SubagentManagerObserver {
  /** Session-active marker; set by `setUICtx` on `session_start`. */
  private uiCtx: unknown;
  private widgetFrame = 0;
  /** pi-pack toggle: when false the widget renders nothing but keeps its session marker. */
  private enabled = true;
  /** The pending one-shot animation tick; each tick's `update()` re-arms it while an agent runs. */
  private widgetTimer: ReturnType<typeof setTimeout> | undefined;
  /** Tracks how many turns each finished agent has survived. Key: agent ID, Value: turns since finished. */
  private finishedTurnAge = new Map<string, number>();
  /** How many extra turns errors/aborted agents linger (completed agents clear after 1 turn). */
  private static readonly ERROR_LINGER_TURNS = 2;

  /** Render trigger captured from the footer each frame. */
  private requestRender: (() => void) | undefined;
  /** Active renderer mode, for the animation cadence. */
  private tuiMode: TuiMode | undefined;
  /** Unregisters this widget's footer section. */
  private unregisterSection: (() => void) | undefined;

  constructor(
    private manager: SubagentManager,
    private registry: AgentTypeRegistry,
  ) {}

  /**
   * Mark the session active (called on session_start). The argument is only an
   * identity marker: a new session means a new footer instance, so the cached
   * render trigger and mode are dropped and the section re-registered.
   */
  setUICtx(ctx: unknown) {
    if (ctx !== this.uiCtx) {
      this.uiCtx = ctx;
      this.requestRender = undefined;
      this.tuiMode = undefined;
      this.registerSection();
    }
  }

  /** Register the footer section that renders this widget (idempotent). */
  private registerSection(): void {
    if (this.unregisterSection) return;
    this.unregisterSection = registerFooterSection({
      id: "agents",
      render: (ctx) => this.renderSection(ctx),
    });
  }

  /**
   * pi-pack enable/disable toggle. Disabling clears the block and stops the
   * animation timer, but keeps the session marker so a later `setEnabled(true)`
   * re-arms the widget without a new `session_start`.
   */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (enabled) {
      this.update();
    } else {
      this.clearWidget(this.listBackgroundAgents());
    }
  }

  /**
   * Called on each new turn (turn_start).
   * Ages finished agents and clears those that have lingered long enough.
   */
  onTurnStart() {
    // Age all finished agents
    for (const [id, age] of this.finishedTurnAge) {
      this.finishedTurnAge.set(id, age + 1);
    }
    // Trigger a widget refresh (will filter out expired agents)
    this.update();
  }

  // ---- SubagentManagerObserver: react to lifecycle, self-drive the timer ----

  /** A subagent started running — render, which arms the animation loop. */
  onSubagentStarted(_record: Subagent) {
    this.update();
  }

  /** A background subagent was created (queued) — render so the count shows. */
  onSubagentCreated(_record: Subagent) {
    this.update();
  }

  /** A subagent completed — render so the finished state is seeded and shown. */
  onSubagentCompleted(_record: Subagent) {
    this.update();
  }

  /** A subagent went back to running — render, which re-arms the animation loop. */
  onSubagentResuming(_record: Subagent) {
    this.update();
  }

  /** A subagent finished a resume — render so the refreshed result is shown. */
  onSubagentResumed(_record: Subagent) {
    this.update();
  }

  /** A subagent's session compacted — render to refresh the compaction count. */
  onSubagentCompacted(_record: Subagent, _info: CompactionInfo) {
    this.update();
  }

  /**
   * Single owner of the animation timer's existence. Idempotent in both
   * directions, so a caller states the wanted state rather than checking first.
   */
  private setTimerRunning(shouldRun: boolean): void {
    if (shouldRun) {
      this.widgetTimer ??= setTimeout(() => {
        this.widgetTimer = undefined;
        this.update();
      }, animationIntervalMs(this.tuiMode));
      return;
    }
    if (this.widgetTimer) {
      clearTimeout(this.widgetTimer);
      this.widgetTimer = undefined;
    }
  }

  /** Check if a finished agent should still be shown in the widget. */
  private shouldShowFinished(agentId: string, status: string): boolean {
    const age = this.finishedTurnAge.get(agentId) ?? 0;
    const maxAge = ERROR_STATUSES.has(status) ? AgentWidget.ERROR_LINGER_TURNS : 1;
    return age < maxAge;
  }

  /**
   * Background agents only — the widget's sole audience (ADR-0004 Decision A).
   * Foreground runs are rendered by the `subagent` tool's inline `onUpdate` stream,
   * so funneling both `listAgents()` call sites through this accessor applies the
   * background predicate exactly once at the source.
   *
   * The predicate reads the record's own resolved mode. It formerly re-derived
   * it from a per-call display snapshot only the tool door ever built — so every
   * SDK-spawned agent was filtered out permanently (#724).
   */
  private listBackgroundAgents(): Subagent[] {
    return this.manager.listAgents().filter(record => record.isBackground);
  }

  /** Project a live Subagent record onto a pure-data WidgetAgent snapshot. */
  private toWidgetAgent(record: Subagent): WidgetAgent {
    return {
      id: record.id,
      type: record.type,
      status: record.status,
      description: record.description,
      toolUses: record.toolUses,
      startedAt: record.startedAt,
      completedAt: record.completedAt,
      error: record.error,
      lifetimeUsage: record.lifetimeUsage,
      compactionCount: record.compactionCount,
      turnBudget: record.turnBudget,
      activeTools: record.activeTools,
      responseText: record.responseText,
      contextPercent: record.getContextPercent(),
      model: record.model,
    };
  }

  /** Render the widget body for the footer's current frame. */
  private renderSection(ctx: FooterSectionContext): string[] {
    this.requestRender = ctx.requestRender;
    this.tuiMode = ctx.mode;
    if (!this.enabled) return [];
    return renderWidgetLines({
      agents: this.listBackgroundAgents().map(r => this.toWidgetAgent(r)),
      registry: this.registry,
      spinnerFrame: this.widgetFrame,
      terminalWidth: ctx.width,
      terminalHeight: ctx.height,
      theme: ctx.theme,
      shouldShowFinished: (id, status) => this.shouldShowFinished(id, status),
    });
  }

  /**
   * Stop the animation timer, purge stale `finishedTurnAge` entries for agents
   * no longer in `backgroundAgents`, and repaint (the section renders nothing
   * once the roster is empty). Called only from `update`'s idle path — not from
   * `dispose`.
   */
  private clearWidget(backgroundAgents: readonly AgentSummary[]): void {
    this.setTimerRunning(false);
    for (const [id] of this.finishedTurnAge) {
      if (!backgroundAgents.some(a => a.id === id)) this.finishedTurnAge.delete(id);
    }
    this.requestRender?.();
  }

  /**
   * Seed linger tracking for any newly-observed finished agent.
   * The widget owns detection of completions it observes via `listAgents()`,
   * so no external bookkeeping call is needed.
   * Idempotent — only seeds when an entry is absent, so repeated updates within
   * a turn neither reset nor advance the age.
   */
  private seedFinishedAgents(agents: readonly AgentSummary[]): void {
    for (const a of agents) {
      if (a.completedAt && !this.finishedTurnAge.has(a.id)) {
        this.finishedTurnAge.set(a.id, 0);
      }
    }
  }

  /** Force an immediate widget update. */
  update() {
    if (!this.uiCtx || !this.enabled) return;

    const backgroundAgents = this.listBackgroundAgents();
    this.seedFinishedAgents(backgroundAgents);
    const state = assembleWidgetState(backgroundAgents, (id, status) => this.shouldShowFinished(id, status));

    if (!state.hasActive && !state.hasFinished) {
      this.clearWidget(backgroundAgents);
      return;
    }

    this.widgetFrame++;

    // Repaint the footer; the section's render() re-reads the live roster, so
    // this only asks Pi for a frame (the footer re-invokes the section).
    this.requestRender?.();

    // Only a running agent has content that changes between ticks: a finished
    // line's duration is fixed and the queued line is a count, so animating
    // either would ask Pi to re-render its whole component tree for a
    // byte-identical result.
    this.setTimerRunning(state.runningCount > 0);
  }

  /**
   * Release everything the widget acquired: the animation timer and the footer
   * section registration.
   *
   * Disposal is final. Dropping the session marker makes `update()` return at
   * its first line, so a notification arriving afterwards — the terminal
   * transition an abort drives synchronously — cannot re-register what this
   * released. `setUICtx()` re-arms the widget if a context ever arrives again.
   */
  dispose() {
    this.setTimerRunning(false);
    this.unregisterSection?.();
    this.unregisterSection = undefined;
    this.uiCtx = undefined;
    this.requestRender = undefined;
    this.tuiMode = undefined;
  }
}
