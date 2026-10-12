// Persistence for pi-subagents operational settings.
// Stored under the `subagents` key of the pi-pack settings file
// (~/.pi/couralabs/settings.json), written by /subagents:settings.

import {
  DEFAULT_SETTINGS,
  loadSettings as loadCouralabsSettings,
  updateSettings as updateCouralabsSettings,
  type SubagentsConfig,
} from "../../../shared/settings.ts";
import { isBelowMinimumTurns, MIN_MAX_TURNS } from "./lifecycle/turn-limits.ts";
import type { PromptInheritance } from "./types.ts";
/**
 * The persisted subagent settings: a partial view of the shared
 * `SubagentsConfig`, plus the load-only retired-key marker.
 *
 * Field notes (carried over from the former standalone interface):
 * - `maxConcurrent`: maximum number of background agents running at once.
 * - `defaultMaxTurns`: 0 = unlimited — the extension's single source of truth
 *   for that convention: `normalizeMaxTurns()` in turn-limits.ts treats
 *   0 → `undefined`, and the `/subagents:settings` input prompt explicitly
 *   says "0 = unlimited".
 * - `wrapUpTurns`: turns left when a subagent is warned about its budget.
 * - `consumedSessionRetentionMinutes`: minutes a consumed agent's session is
 *   retained after its last relevance event.
 * - `unconsumedSessionRetentionMinutes`: minutes an unconsumed agent's session
 *   is retained (safety cap).
 * - `abortAllOnInterrupt`: when false, a parent interrupt (ESC) leaves
 *   background and queued subagents running. Foreground agents hold the
 *   parent's run signal directly, so they abort on ESC either way.
 * - `midRunUpdates`: when false, a background child is not given the
 *   `notify_parent` tool, so it cannot interrupt the parent with a mid-run
 *   finding. Ask-back is unaffected.
 * - `excludedExtensionPackages`: Pi package sources whose extensions child
 *   sessions must not load, matched against Pi's configured source string
 *   exactly (e.g. `npm:@scope/pkg`). The package's skills, prompts, and themes
 *   stay available to children.
 * - `promptInheritance`: prompt-inheritance strategy per provider, keyed by the
 *   provider id of the child's resolved model. Every provider not listed
 *   inherits `"full"`.
 * - `agentModels`: model override per built-in agent name, written by
 *   `/subagent-model`.
 */
export type SubagentsSettings = Partial<Omit<SubagentsConfig, "enabled">> & {
  /**
   * Load-only marker: a settings file still names the removed `graceTurns`.
   * `load()` warns and strips it, so it is never applied, emitted, or saved.
   */
  legacyGraceTurns?: true;
};

/**
 * The persisted form of the in-memory settings values.
 * `saveSettings` merges this shape into the shared pi-pack settings file, so
 * every key that must survive a `/subagents:settings` edit has to
 * appear here.
 */
export interface SettingsSnapshot {
  maxConcurrent: number;
  defaultMaxTurns: number;
  wrapUpTurns: number;
  consumedSessionRetentionMinutes: number;
  unconsumedSessionRetentionMinutes: number;
  abortAllOnInterrupt: boolean;
  midRunUpdates: boolean;
  /**
   * Present only when non-empty, so files that never set it gain no noise.
   * It must round-trip: the key has no `/subagents:settings` affordance, so a
   * hand-edited value would otherwise be erased by any unrelated setting change.
   */
  excludedExtensionPackages?: string[];
  /** Present only when non-empty, and round-tripped for the same reason. */
  promptInheritance?: Record<string, PromptInheritance>;
  /**
   * Present only when non-empty, and round-tripped for the same reason.
   * `agentModels` is written by `/subagent-model`, which has no
   * `/subagents:settings` affordance either, so an unrelated settings change
   * must not erase it.
   */
  agentModels?: Record<string, string>;
}


/** Emit callback — a subset of `pi.events.emit` to keep helpers testable. */
export type SettingsEmit = (event: string, payload: unknown) => void;

/**
 * Owns all three in-memory settings values and their load/save/persist cycle.
 * Replaces the scattered free-function + SettingsAppliers callback pattern.
 */
export class SettingsManager {
  private _defaultMaxTurns: number | undefined = undefined;
  private _wrapUpTurns: number = DEFAULT_SETTINGS.subagents.wrapUpTurns;
  private _maxConcurrent: number = DEFAULT_SETTINGS.subagents.maxConcurrent;
  private _consumedSessionRetentionMinutes: number = DEFAULT_SETTINGS.subagents.consumedSessionRetentionMinutes;
  private _unconsumedSessionRetentionMinutes: number = DEFAULT_SETTINGS.subagents.unconsumedSessionRetentionMinutes;
  private _abortAllOnInterrupt: boolean = DEFAULT_SETTINGS.subagents.abortAllOnInterrupt;
  private _midRunUpdates: boolean = DEFAULT_SETTINGS.subagents.midRunUpdates;
  private _excludedExtensionPackages: string[] = [];
  private _promptInheritance: Record<string, PromptInheritance> = {};
  private _agentModels: Record<string, string> = {};

  private readonly emit: SettingsEmit;
  private readonly onMaxConcurrentChanged: (() => void) | undefined;

  constructor(deps: { emit: SettingsEmit; onMaxConcurrentChanged?: () => void }) {
    this.emit = deps.emit;
    this.onMaxConcurrentChanged = deps.onMaxConcurrentChanged;
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

  // ── maxConcurrent: minimum 1 ──

  get maxConcurrent(): number {
    return this._maxConcurrent;
  }

  set maxConcurrent(n: number) {
    this._maxConcurrent = Math.max(1, n);
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

  // ── abortAllOnInterrupt: flipped via toggleAbortAllOnInterrupt(); no normalization ──

  get abortAllOnInterrupt(): boolean {
    return this._abortAllOnInterrupt;
  }

  // ── excludedExtensionPackages: hand-edited only; no /subagents:settings affordance ──

  get excludedExtensionPackages(): readonly string[] {
    return this._excludedExtensionPackages;
  }

  // ── promptInheritance: hand-edited only; no /subagents:settings affordance ──

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

  // ── agentModels: written by /subagent-model; no /subagents:settings affordance ──

  /**
   * Model overrides for built-in agents, keyed by agent name. Custom agents are
   * absent here: their markdown `model:` is the more specific source and wins.
   */
  get agentModels(): Record<string, string> {
    return this._agentModels;
  }

  // ── Lifecycle methods ──

  /**
   * Load merged settings (global + project), apply to in-memory values,
   * and emit the `subagents:settings_loaded` lifecycle event.
   * Returns the raw loaded settings object.
   */
  load(): SubagentsSettings {
    const { legacyGraceTurns, ...settings } = loadSettings();
    warnAboutRetiredSettings(settings, legacyGraceTurns === true);
    if (typeof settings.maxConcurrent === "number") this.maxConcurrent = settings.maxConcurrent;
    if (typeof settings.defaultMaxTurns === "number") this.defaultMaxTurns = settings.defaultMaxTurns;
    if (typeof settings.wrapUpTurns === "number") this.wrapUpTurns = settings.wrapUpTurns;
    if (typeof settings.consumedSessionRetentionMinutes === "number")
      this.consumedSessionRetentionMinutes = settings.consumedSessionRetentionMinutes;
    if (typeof settings.unconsumedSessionRetentionMinutes === "number")
      this.unconsumedSessionRetentionMinutes = settings.unconsumedSessionRetentionMinutes;
    if (typeof settings.abortAllOnInterrupt === "boolean")
      this._abortAllOnInterrupt = settings.abortAllOnInterrupt;
    if (typeof settings.midRunUpdates === "boolean") this._midRunUpdates = settings.midRunUpdates;
    // Assigned unconditionally: removing the key from disk must clear the value.
    this._excludedExtensionPackages = [...(settings.excludedExtensionPackages ?? [])];
    this._promptInheritance = { ...settings.promptInheritance };
    this._agentModels = { ...settings.agentModels };
    this.emit("subagents:settings_loaded", { settings });
    return settings;
  }

  /**
   * Snapshot current in-memory values for persistence.
   * `defaultMaxTurns` uses 0 as the on-disk marker for unlimited (undefined).
   */
  snapshot(): SettingsSnapshot {
    const snapshot: SettingsSnapshot = {
      maxConcurrent: this._maxConcurrent,
      defaultMaxTurns: this._defaultMaxTurns ?? 0,
      wrapUpTurns: this._wrapUpTurns,
      consumedSessionRetentionMinutes: this._consumedSessionRetentionMinutes,
      unconsumedSessionRetentionMinutes: this._unconsumedSessionRetentionMinutes,
      abortAllOnInterrupt: this._abortAllOnInterrupt,
      midRunUpdates: this._midRunUpdates,
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
    return snapshot;
  }

  /**
   * Set a built-in agent's model override, persist, and return the toast.
   * Owns the full consequence chain so the command handler stays a thin wire.
   */
  applyAgentModel(agentName: string, modelId: string): { message: string; level: "info" | "warning" } {
    this._agentModels = { ...this._agentModels, [agentName]: modelId };
    return this.saveAndNotify(`${agentName} now uses ${modelId}`);
  }

  /**
   * Set maxConcurrent, notify interested parties, persist, and return the toast.
   * Owns the full consequence chain so callers just say what they want.
   */
  applyMaxConcurrent(n: number): { message: string; level: "info" | "warning" } {
    this.maxConcurrent = n; // setter normalizes: max(1, n)
    this.onMaxConcurrentChanged?.();
    return this.saveAndNotify(`Max concurrency set to ${this.maxConcurrent}`);
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
   * Flip whether a parent interrupt (ESC) aborts every subagent, persist, and
   * return the toast. The manager owns the negation so callers just say "flip it".
   */
  toggleAbortAllOnInterrupt(): { message: string; level: "info" | "warning" } {
    this._abortAllOnInterrupt = !this._abortAllOnInterrupt;
    return this.saveAndNotify(
      `Abort all subagents on ESC: ${this._abortAllOnInterrupt ? "on" : "off"}`,
    );
  }

  get midRunUpdates(): boolean {
    return this._midRunUpdates;
  }

  /**
   * Flip whether a background child may interrupt the parent with a mid-run
   * update, persist, and return the toast.
   */
  toggleMidRunUpdates(): { message: string; level: "info" | "warning" } {
    this._midRunUpdates = !this._midRunUpdates;
    return this.saveAndNotify(
      `Mid-run updates from background subagents: ${this._midRunUpdates ? "on" : "off"}`,
    );
  }

  /**
   * Persist the current snapshot, emit `subagents:settings_changed`,
   * and return the toast the UI should display.
   */
  saveAndNotify(successMsg: string): { message: string; level: "info" | "warning" } {
    const snap = this.snapshot();
    const persisted = saveSettings(snap);
    this.emit("subagents:settings_changed", { settings: snap, persisted });
    return persistToastFor(successMsg, persisted);
  }
}

// Sanity ceilings — prevent hand-edited configs from asking for values that
// make no operational sense (e.g. 1e6 concurrent subagents). Permissive enough
// that any realistic power-user setting passes through.
const MAX_CONCURRENT_CEILING = 1024;
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
function warnAboutRetiredSettings(settings: SubagentsSettings, hasGraceTurns: boolean): void {
  if (hasGraceTurns) {
    console.warn(
      `[pi-subagents] graceTurns was removed; set wrapUpTurns (turns left when a subagent is warned, default ${DEFAULT_SETTINGS.subagents.wrapUpTurns}) instead.`,
    );
  }
  if (isBelowMinimumTurns(settings.defaultMaxTurns)) {
    console.warn(
      `[pi-subagents] defaultMaxTurns ${settings.defaultMaxTurns} is below the minimum of ${MIN_MAX_TURNS}; using ${MIN_MAX_TURNS}.`,
    );
  }
}

/** Drop fields that don't match the expected shape. Silent — garbage becomes absent. */
function sanitize(raw: unknown): SubagentsSettings {
  if (!raw || typeof raw !== "object") return {};
  const r = raw as Record<string, unknown>;
  const out: SubagentsSettings = {};
  if (
    Number.isInteger(r.maxConcurrent) &&
    (r.maxConcurrent as number) >= 1 &&
    (r.maxConcurrent as number) <= MAX_CONCURRENT_CEILING
  ) {
    out.maxConcurrent = r.maxConcurrent as number;
  }
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
  if (typeof r.abortAllOnInterrupt === "boolean") {
    out.abortAllOnInterrupt = r.abortAllOnInterrupt;
  }
  if (typeof r.midRunUpdates === "boolean") {
    out.midRunUpdates = r.midRunUpdates;
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
  const agentModels = sanitizeAgentModels(r.agentModels);
  if (agentModels) {
    out.agentModels = agentModels;
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
function sanitizeAgentModels(raw: unknown): Record<string, string> | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const models: Record<string, string> = {};
  for (const [agent, model] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof model === "string") {
      models[agent] = model;
    }
  }
  return Object.keys(models).length > 0 ? models : undefined;
}

/** Load the operational settings from the shared pi-pack settings file, sanitized. */
export function loadSettings(): SubagentsSettings {
  return sanitize(loadCouralabsSettings().subagents);
}

/**
 * Merge operational settings into the shared pi-pack settings file.
 * Returns `true` on success, `false` if the write failed so the caller can
 * surface a warning — persistence isn't fatal but isn't silent.
 */
export function saveSettings(s: SettingsSnapshot): boolean {
  try {
    updateCouralabsSettings({ subagents: s });
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
