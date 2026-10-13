// Persistence for pi-spawn operational settings.
// Stored under the `spawn` key of the pi-adhd settings file
// (~/.pi/couralabs/settings.json), written by /spawn:settings.

import {
  DEFAULT_SETTINGS,
  loadSettings as loadCouralabsSettings,
  updateSettings as updateCouralabsSettings,
  type SpawnConfig,
} from "../../../shared/settings.ts";
import { isBelowMinimumTurns, MIN_MAX_TURNS } from "./lifecycle/turn-limits.ts";
import { parseThinkingLevel } from "./config/thinking-level.ts";
import type { PromptInheritance } from "./types.ts";
/**
 * The persisted spawn settings: a partial view of the shared
 * `SpawnConfig`, plus the load-only retired-key marker.
 *
 * Field notes (carried over from the former standalone interface):
 * - `defaultMaxTurns`: 0 = unlimited — the extension's single source of truth
 *   for that convention: `normalizeMaxTurns()` in turn-limits.ts treats
 *   0 → `undefined`, and the `/spawn:settings` input prompt explicitly
 *   says "0 = unlimited".
 * - `wrapUpTurns`: turns left when a spawn is warned about its budget.
 * - `consumedSessionRetentionMinutes`: minutes a consumed agent's session is
 *   retained after its last relevance event.
 * - `unconsumedSessionRetentionMinutes`: minutes an unconsumed agent's session
 *   is retained (safety cap).
 * - `excludedExtensionPackages`: Pi package sources whose extensions child
 *   sessions must not load, matched against Pi's configured source string
 *   exactly (e.g. `npm:@scope/pkg`). The package's skills, prompts, and themes
 *   stay available to children.
 * - `promptInheritance`: prompt-inheritance strategy per provider, keyed by the
 *   provider id of the child's resolved model. Every provider not listed
 *   inherits `"full"`.
 * - `agentModels`: model override per built-in agent name, written by
 *   `/spawn:model`.
 * - `agentThinking`: thinking-level override per built-in agent name, also
 *   written by `/spawn:model`.
 */
export type SpawnSettings = Partial<SpawnConfig> & {
  /**
   * Load-only marker: a settings file still names the removed `graceTurns`.
   * `load()` warns and strips it, so it is never applied, emitted, or saved.
   */
  legacyGraceTurns?: true;
};

/**
 * The persisted form of the in-memory settings values.
 * `saveSettings` merges this shape into the shared pi-adhd settings file, so
 * every key that must survive a `/spawn:settings` edit has to
 * appear here.
 */
export interface SettingsSnapshot {
  defaultMaxTurns: number;
  wrapUpTurns: number;
  consumedSessionRetentionMinutes: number;
  unconsumedSessionRetentionMinutes: number;
  /**
   * Present only when non-empty, so files that never set it gain no noise.
   * It must round-trip: the key has no `/spawn:settings` affordance, so a
   * hand-edited value would otherwise be erased by any unrelated setting change.
   */
  excludedExtensionPackages?: string[];
  /** Present only when non-empty, and round-tripped for the same reason. */
  promptInheritance?: Record<string, PromptInheritance>;
  /**
   * Present only when non-empty, and round-tripped for the same reason.
   * `agentModels` is written by `/spawn:model`, which has no
   * `/spawn:settings` affordance either, so an unrelated settings change
   * must not erase it.
   */
  agentModels?: Record<string, string>;
  /** Same contract as `agentModels`, for the per-agent thinking override. */
  agentThinking?: Record<string, string>;
}


/** Emit callback — a subset of `pi.events.emit` to keep helpers testable. */
export type SettingsEmit = (event: string, payload: unknown) => void;

/**
 * Owns all three in-memory settings values and their load/save/persist cycle.
 * Replaces the scattered free-function + SettingsAppliers callback pattern.
 */
export class SettingsManager {
  private _defaultMaxTurns: number | undefined = undefined;
  private _wrapUpTurns: number = DEFAULT_SETTINGS.spawn.wrapUpTurns;
  private _consumedSessionRetentionMinutes: number = DEFAULT_SETTINGS.spawn.consumedSessionRetentionMinutes;
  private _unconsumedSessionRetentionMinutes: number = DEFAULT_SETTINGS.spawn.unconsumedSessionRetentionMinutes;
  private _excludedExtensionPackages: string[] = [];
  private _promptInheritance: Record<string, PromptInheritance> = {};
  private _agentModels: Record<string, string> = {};
  private _agentThinking: Record<string, string> = {};

  private readonly emit: SettingsEmit;

  constructor(deps: { emit: SettingsEmit }) {
    this.emit = deps.emit;
  }

  // ── defaultMaxTurns: 0 or undefined → unlimited (undefined); else at least MIN_MAX_TURNS ──

  get defaultMaxTurns(): number | undefined {
    return this._defaultMaxTurns;
  }

  set defaultMaxTurns(n: number | undefined) {
    if (n == null || n === 0) {
      this._defaultMaxTurns = undefined;
    } else {
      this._defaultMaxTurns = Math.max(MIN_MAX_TURNS, n);
    }
  }

  // ── wrapUpTurns: minimum 1 ──

  get wrapUpTurns(): number {
    return this._wrapUpTurns;
  }

  set wrapUpTurns(n: number) {
    this._wrapUpTurns = Math.max(1, n);
  }

  // ── retention windows: clamped to [1, RETENTION_MINUTES_CEILING] minutes ──

  get consumedSessionRetentionMinutes(): number {
    return this._consumedSessionRetentionMinutes;
  }

  set consumedSessionRetentionMinutes(n: number) {
    this._consumedSessionRetentionMinutes = clampRetentionMinutes(n);
  }

  get unconsumedSessionRetentionMinutes(): number {
    return this._unconsumedSessionRetentionMinutes;
  }

  set unconsumedSessionRetentionMinutes(n: number) {
    this._unconsumedSessionRetentionMinutes = clampRetentionMinutes(n);
  }

  // ── excludedExtensionPackages: hand-edited only; no /spawn:settings affordance ──

  get excludedExtensionPackages(): readonly string[] {
    return this._excludedExtensionPackages;
  }

  // ── promptInheritance: hand-edited only; no /spawn:settings affordance ──

  /**
   * The prompt-inheritance strategy a child on `provider` adopts.
   *
   * Unlisted providers, and a child that resolved no model at all, inherit
   * `"full"` — the default, which changes no existing child's prompt.
   */
  promptInheritanceFor(provider: string | undefined): PromptInheritance {
    if (provider === undefined) return "full";
    return this._promptInheritance[provider] ?? "full";
  }

  // ── agentModels / agentThinking: written by /spawn:model; no /spawn:settings affordance ──

  /**
   * Model overrides for built-in agents, keyed by agent name. Custom agents are
   * absent here: their markdown `model:` is the more specific source and wins.
   */
  get agentModels(): Record<string, string> {
    return this._agentModels;
  }

  /** Thinking-level overrides for built-in agents, keyed the same way. */
  get agentThinking(): Record<string, string> {
    return this._agentThinking;
  }

  // ── Lifecycle methods ──

  /**
   * Load merged settings (global + project), apply to in-memory values,
   * and emit the `spawn:settings_loaded` lifecycle event.
   * Returns the raw loaded settings object.
   */
  load(): SpawnSettings {
    const { legacyGraceTurns, ...settings } = loadSettings();
    warnAboutRetiredSettings(settings, legacyGraceTurns === true);
    if (typeof settings.defaultMaxTurns === "number") this.defaultMaxTurns = settings.defaultMaxTurns;
    if (typeof settings.wrapUpTurns === "number") this.wrapUpTurns = settings.wrapUpTurns;
    if (typeof settings.consumedSessionRetentionMinutes === "number")
      this.consumedSessionRetentionMinutes = settings.consumedSessionRetentionMinutes;
    if (typeof settings.unconsumedSessionRetentionMinutes === "number")
      this.unconsumedSessionRetentionMinutes = settings.unconsumedSessionRetentionMinutes;
    // Assigned unconditionally: removing the key from disk must clear the value.
    this._excludedExtensionPackages = [...(settings.excludedExtensionPackages ?? [])];
    this._promptInheritance = { ...settings.promptInheritance };
    this._agentModels = { ...settings.agentModels };
    this._agentThinking = { ...settings.agentThinking };
    this.emit("spawn:settings_loaded", { settings });
    return settings;
  }

  /**
   * Snapshot current in-memory values for persistence.
   * `defaultMaxTurns` uses 0 as the on-disk marker for unlimited (undefined).
   */
  snapshot(): SettingsSnapshot {
    const snapshot: SettingsSnapshot = {
      defaultMaxTurns: this._defaultMaxTurns ?? 0,
      wrapUpTurns: this._wrapUpTurns,
      consumedSessionRetentionMinutes: this._consumedSessionRetentionMinutes,
      unconsumedSessionRetentionMinutes: this._unconsumedSessionRetentionMinutes,
    };
    if (this._excludedExtensionPackages.length > 0) {
      snapshot.excludedExtensionPackages = [...this._excludedExtensionPackages];
    }
    if (Object.keys(this._promptInheritance).length > 0) {
      snapshot.promptInheritance = { ...this._promptInheritance };
    }
    if (Object.keys(this._agentModels).length > 0) {
      snapshot.agentModels = { ...this._agentModels };
    }
    if (Object.keys(this._agentThinking).length > 0) {
      snapshot.agentThinking = { ...this._agentThinking };
    }
    return snapshot;
  }

  /**
   * Set a built-in agent's model override, persist, and return the toast.
   * `undefined` clears the override so the agent inherits again.
   * Owns the full consequence chain so the command handler stays a thin wire.
   */
  applyAgentModel(agentName: string, modelId: string | undefined): { message: string; level: "info" | "warning" } {
    this._agentModels = assignmentWithout(this._agentModels, agentName, modelId);
    return this.saveAndNotify(
      modelId === undefined ? `${agentName} model reset to inherit` : `${agentName} now uses ${modelId}`,
    );
  }

  /**
   * Set a built-in agent's thinking-level override, persist, and return the
   * toast. `undefined` clears the override so the agent inherits again.
   */
  applyAgentThinking(
    agentName: string,
    level: string | undefined,
  ): { message: string; level: "info" | "warning" } {
    this._agentThinking = assignmentWithout(this._agentThinking, agentName, level);
    return this.saveAndNotify(
      level === undefined ? `${agentName} thinking reset to inherit` : `${agentName} now thinks at ${level}`,
    );
  }

  /**
   * Set defaultMaxTurns, persist, and return the toast.
   * Pass 0 for unlimited (maps to undefined internally).
   */
  applyDefaultMaxTurns(n: number): { message: string; level: "info" | "warning" } {
    this.defaultMaxTurns = n === 0 ? undefined : n; // setter normalizes further
    const label = this.defaultMaxTurns == null ? "unlimited" : String(this.defaultMaxTurns);
    return this.saveAndNotify(`Default max turns set to ${label}`);
  }

  /**
   * Set wrapUpTurns, persist, and return the toast.
   */
  applyWrapUpTurns(n: number): { message: string; level: "info" | "warning" } {
    this.wrapUpTurns = n; // setter normalizes: max(1, n)
    return this.saveAndNotify(`Wrap-up turns set to ${this.wrapUpTurns}`);
  }

  /** Set the consumed-session retention window (minutes), persist, and return the toast. */
  applyConsumedSessionRetentionMinutes(n: number): { message: string; level: "info" | "warning" } {
    this.consumedSessionRetentionMinutes = n; // setter normalizes: clamp [1, ceiling]
    return this.saveAndNotify(`Consumed-session retention set to ${this.consumedSessionRetentionMinutes} min`);
  }

  /** Set the unconsumed-session retention window (minutes), persist, and return the toast. */
  applyUnconsumedSessionRetentionMinutes(n: number): { message: string; level: "info" | "warning" } {
    this.unconsumedSessionRetentionMinutes = n; // setter normalizes: clamp [1, ceiling]
    return this.saveAndNotify(`Unconsumed-session retention set to ${this.unconsumedSessionRetentionMinutes} min`);
  }

  /**
   * Persist the current snapshot, emit `spawn:settings_changed`,
   * and return the toast the UI should display.
   */
  saveAndNotify(successMsg: string): { message: string; level: "info" | "warning" } {
    const snap = this.snapshot();
    const persisted = saveSettings(snap);
    this.emit("spawn:settings_changed", { settings: snap, persisted });
    return persistToastFor(successMsg, persisted);
  }
}

// Sanity ceilings — prevent hand-edited configs from asking for values that
// make no operational sense (e.g. 1e6 concurrent spawn). Permissive enough
// that any realistic power-user setting passes through.
const MAX_TURNS_CEILING = 10_000;
const WRAP_UP_TURNS_CEILING = 1_000;
// Retention windows: 1 minute floor, two-week ceiling (60 * 24 * 14).
const RETENTION_MINUTES_CEILING = 20_160;

/** Clamp a retention window to [1, RETENTION_MINUTES_CEILING] minutes. */
function clampRetentionMinutes(n: number): number {
  return Math.min(RETENTION_MINUTES_CEILING, Math.max(1, n));
}

/** True when a value is an integer minute count within the accepted retention range. */
function isRetentionMinutes(n: unknown): n is number {
  return Number.isInteger(n) && (n as number) >= 1 && (n as number) <= RETENTION_MINUTES_CEILING;
}

/**
 * Tell the operator about settings this version reads differently, so a value
 * that stopped meaning what they wrote does not change behavior silently.
 */
function warnAboutRetiredSettings(settings: SpawnSettings, hasGraceTurns: boolean): void {
  if (hasGraceTurns) {
    console.warn(
      `[pi-spawn] graceTurns was removed; set wrapUpTurns (turns left when a spawn is warned, default ${DEFAULT_SETTINGS.spawn.wrapUpTurns}) instead.`,
    );
  }
  if (isBelowMinimumTurns(settings.defaultMaxTurns)) {
    console.warn(
      `[pi-spawn] defaultMaxTurns ${settings.defaultMaxTurns} is below the minimum of ${MIN_MAX_TURNS}; using ${MIN_MAX_TURNS}.`,
    );
  }
}

/** Drop fields that don't match the expected shape. Silent — garbage becomes absent. */
function sanitize(raw: unknown): SpawnSettings {
  if (!raw || typeof raw !== "object") return {};
  const r = raw as Record<string, unknown>;
  const out: SpawnSettings = {};
  if (
    Number.isInteger(r.defaultMaxTurns) &&
    (r.defaultMaxTurns as number) >= 0 &&
    (r.defaultMaxTurns as number) <= MAX_TURNS_CEILING
  ) {
    out.defaultMaxTurns = r.defaultMaxTurns as number;
  }
  if (
    Number.isInteger(r.wrapUpTurns) &&
    (r.wrapUpTurns as number) >= 1 &&
    (r.wrapUpTurns as number) <= WRAP_UP_TURNS_CEILING
  ) {
    out.wrapUpTurns = r.wrapUpTurns as number;
  }
  if ("graceTurns" in r) {
    out.legacyGraceTurns = true;
  }
  if (isRetentionMinutes(r.consumedSessionRetentionMinutes)) {
    out.consumedSessionRetentionMinutes = r.consumedSessionRetentionMinutes;
  }
  if (isRetentionMinutes(r.unconsumedSessionRetentionMinutes)) {
    out.unconsumedSessionRetentionMinutes = r.unconsumedSessionRetentionMinutes;
  }
  if (Array.isArray(r.excludedExtensionPackages)) {
    const sources = r.excludedExtensionPackages
      .filter((value): value is string => typeof value === "string")
      .map((value) => value.trim())
      .filter(Boolean);
    out.excludedExtensionPackages = [...new Set(sources)];
  }
  const promptInheritance = sanitizePromptInheritance(r.promptInheritance);
  if (promptInheritance) {
    out.promptInheritance = promptInheritance;
  }
  const agentModels = sanitizeAgentStringMap(r.agentModels);
  if (agentModels) {
    out.agentModels = agentModels;
  }
  const agentThinking = sanitizeAgentThinking(r.agentThinking);
  if (agentThinking) {
    out.agentThinking = agentThinking;
  }
  return out;
}

/**
 * Keep only provider entries naming a known strategy, absent when none survive.
 *
 * Settings arrive from JSON, where the declared types are aspirations, so the
 * strategy is checked at run time rather than trusted.
 */
function sanitizePromptInheritance(
  raw: unknown,
): Record<string, PromptInheritance> | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const rules: Record<string, PromptInheritance> = {};
  for (const [provider, strategy] of Object.entries(raw as Record<string, unknown>)) {
    if (strategy === "full" || strategy === "portable") {
      rules[provider] = strategy;
    }
  }
  return Object.keys(rules).length > 0 ? rules : undefined;
}

/** Keep only string-valued agent model overrides, absent when none survive. */
function sanitizeAgentStringMap(raw: unknown): Record<string, string> | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const models: Record<string, string> = {};
  for (const [agent, model] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof model === "string") {
      models[agent] = model;
    }
  }
  return Object.keys(models).length > 0 ? models : undefined;
}

/**
 * Keep only agent thinking overrides naming a level Pi accepts, absent when none
 * survive. Settings arrive from JSON, where the declared types are aspirations,
 * so the level is checked at run time rather than trusted.
 */
function sanitizeAgentThinking(raw: unknown): Record<string, string> | undefined {
  const entries = sanitizeAgentStringMap(raw);
  if (!entries) return undefined;
  const levels: Record<string, string> = {};
  for (const [agent, level] of Object.entries(entries)) {
    if (parseThinkingLevel(level) !== undefined) {
      levels[agent] = level;
    }
  }
  return Object.keys(levels).length > 0 ? levels : undefined;
}

/** Return a copy of `map` with `key` set to `value`, dropping the key when `value` is undefined. */
function assignmentWithout(map: Record<string, string>, key: string, value: string | undefined): Record<string, string> {
  const next = { ...map };
  if (value === undefined) delete next[key];
  else next[key] = value;
  return next;
}

/** Load the operational settings from the shared pi-adhd settings file, sanitized. */
export function loadSettings(): SpawnSettings {
  return sanitize(loadCouralabsSettings().spawn);
}

/**
 * Merge operational settings into the shared pi-adhd settings file.
 * Returns `true` on success, `false` if the write failed so the caller can
 * surface a warning — persistence isn't fatal but isn't silent.
 */
export function saveSettings(s: SettingsSnapshot): boolean {
  try {
    updateCouralabsSettings({ spawn: s });
    return true;
  } catch {
    return false;
  }
}

/**
 * Format the user-facing toast for a settings mutation. Pure function —
 * routes the success/failure of `saveSettings` into the right message + level
 * so the UI layer (index.ts) stays a thin wire between input and notification.
 */
export function persistToastFor(
  successMsg: string,
  persisted: boolean,
): { message: string; level: "info" | "warning" } {
  return persisted
    ? { message: successMsg, level: "info" }
    : { message: `${successMsg} (session only; failed to persist)`, level: "warning" };
}
