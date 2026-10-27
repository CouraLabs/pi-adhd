export type TurnBudgetPhase = "within" | "warned" | "exhausted";

export interface TurnBudget {

  maxTurns?: number;

  used: number;
  phase: TurnBudgetPhase;
}

export type TurnBudgetAction = "warn" | "stop" | undefined;

export interface TurnOutcome {

  failed: boolean;

  ranTools: boolean;
}

export class TurnBudgetTracker {
  private readonly maxTurns: number | undefined;
  private readonly warnAt: number | undefined;
  private used = 0;
  private phase: TurnBudgetPhase = "within";

  constructor(limits: { maxTurns?: number; wrapUpTurns: number }) {
    this.maxTurns = limits.maxTurns;
    this.warnAt = limits.maxTurns == null ? undefined : Math.max(0, limits.maxTurns - limits.wrapUpTurns);
  }

  warnBeforeFirstTurn(): boolean {
    if (this.warnAt !== 0 || this.phase !== "within") return false;
    this.phase = "warned";
    return true;
  }

  onTurnEnd(turn: TurnOutcome): TurnBudgetAction {
    if (turn.failed) return undefined;
    this.used++;
    if (this.maxTurns == null || this.warnAt == null || !turn.ranTools) return undefined;
    if (this.used >= this.maxTurns) {
      this.phase = "exhausted";
      return "stop";
    }
    if (this.phase === "within" && this.used >= this.warnAt) {
      this.phase = "warned";
      return "warn";
    }
    return undefined;
  }

  onTurnStart(): TurnBudgetAction {
    if (this.maxTurns == null || this.phase === "exhausted" || this.used < this.maxTurns) return undefined;
    this.phase = "exhausted";
    return "stop";
  }

  get remaining(): number | undefined {
    return this.maxTurns == null ? undefined : this.maxTurns - this.used;
  }

  get budget(): TurnBudget {
    return this.maxTurns == null
      ? { used: this.used, phase: this.phase }
      : { maxTurns: this.maxTurns, used: this.used, phase: this.phase };
  }
}

export function wrappedUpAtTurnLimit(outcome: { status: string; turnBudget?: TurnBudget }): boolean {
  return outcome.status === "completed" && outcome.turnBudget?.phase === "warned";
}

export const MIN_MAX_TURNS = 2;

export function normalizeMaxTurns(n: number | undefined): number | undefined {
  if (n == null || n === 0) return undefined;
  return Math.max(MIN_MAX_TURNS, n);
}

export function isBelowMinimumTurns(n: number | undefined): n is number {
  return n != null && n !== 0 && n < MIN_MAX_TURNS;
}
