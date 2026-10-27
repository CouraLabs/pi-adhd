import {
  DEFAULT_SETTINGS,
  loadSettings as loadCouralabsSettings,
  updateSettings as updateCouralabsSettings,
  type SpawnConfig,
} from "../../../shared/settings.ts";
import { isBelowMinimumTurns, MIN_MAX_TURNS } from "./lifecycle/turn-limits.ts";
import { parseThinkingLevel } from "./config/thinking-level.ts";
import type { PromptInheritance } from "./types.ts";

export type SpawnSettings = Partial<SpawnConfig> & {

  legacyGraceTurns?: true;
};

export interface SettingsSnapshot {
  defaultMaxTurns: number;
  wrapUpTurns: number;
  consumedSessionRetentionMinutes: number;
  unconsumedSessionRetentionMinutes: number;

  excludedExtensionPackages?: string[];

  promptInheritance?: Record<string, PromptInheritance>;

  agentModels?: Record<string, string>;

  agentThinking?: Record<string, string>;
}

export type SettingsEmit = (event: string, payload: unknown) => void;

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

  get wrapUpTurns(): number {
    return this._wrapUpTurns;
  }

  set wrapUpTurns(n: number) {
    this._wrapUpTurns = Math.max(1, n);
  }

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

  get excludedExtensionPackages(): readonly string[] {
    return this._excludedExtensionPackages;
  }

  promptInheritanceFor(provider: string | undefined): PromptInheritance {
    if (provider === undefined) return "full";
    return this._promptInheritance[provider] ?? "full";
  }

  get agentModels(): Record<string, string> {
    return this._agentModels;
  }

  get agentThinking(): Record<string, string> {
    return this._agentThinking;
  }

  load(): SpawnSettings {
    const { legacyGraceTurns, ...settings } = loadSettings();
    warnAboutRetiredSettings(settings, legacyGraceTurns === true);
    if (typeof settings.defaultMaxTurns === "number") this.defaultMaxTurns = settings.defaultMaxTurns;
    if (typeof settings.wrapUpTurns === "number") this.wrapUpTurns = settings.wrapUpTurns;
    if (typeof settings.consumedSessionRetentionMinutes === "number")
      this.consumedSessionRetentionMinutes = settings.consumedSessionRetentionMinutes;
    if (typeof settings.unconsumedSessionRetentionMinutes === "number")
      this.unconsumedSessionRetentionMinutes = settings.unconsumedSessionRetentionMinutes;

    this._excludedExtensionPackages = [...(settings.excludedExtensionPackages ?? [])];
    this._promptInheritance = { ...settings.promptInheritance };
    this._agentModels = { ...settings.agentModels };
    this._agentThinking = { ...settings.agentThinking };
    this.emit("spawn:settings_loaded", { settings });
    return settings;
  }

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

  applyAgentModel(agentName: string, modelId: string | undefined): { message: string; level: "info" | "warning" } {
    this._agentModels = assignmentWithout(this._agentModels, agentName, modelId);
    return this.saveAndNotify(
      modelId === undefined ? `${agentName} model reset to inherit` : `${agentName} now uses ${modelId}`,
    );
  }

  applyAgentThinking(
    agentName: string,
    level: string | undefined,
  ): { message: string; level: "info" | "warning" } {
    this._agentThinking = assignmentWithout(this._agentThinking, agentName, level);
    return this.saveAndNotify(
      level === undefined ? `${agentName} thinking reset to inherit` : `${agentName} now thinks at ${level}`,
    );
  }

  applyDefaultMaxTurns(n: number): { message: string; level: "info" | "warning" } {
    this.defaultMaxTurns = n === 0 ? undefined : n;
    const label = this.defaultMaxTurns == null ? "unlimited" : String(this.defaultMaxTurns);
    return this.saveAndNotify(`Default max turns set to ${label}`);
  }

  applyWrapUpTurns(n: number): { message: string; level: "info" | "warning" } {
    this.wrapUpTurns = n;
    return this.saveAndNotify(`Wrap-up turns set to ${this.wrapUpTurns}`);
  }

  applyConsumedSessionRetentionMinutes(n: number): { message: string; level: "info" | "warning" } {
    this.consumedSessionRetentionMinutes = n;
    return this.saveAndNotify(`Consumed-session retention set to ${this.consumedSessionRetentionMinutes} min`);
  }

  applyUnconsumedSessionRetentionMinutes(n: number): { message: string; level: "info" | "warning" } {
    this.unconsumedSessionRetentionMinutes = n;
    return this.saveAndNotify(`Unconsumed-session retention set to ${this.unconsumedSessionRetentionMinutes} min`);
  }

  saveAndNotify(successMsg: string): { message: string; level: "info" | "warning" } {
    const snap = this.snapshot();
    const persisted = saveSettings(snap);
    this.emit("spawn:settings_changed", { settings: snap, persisted });
    return persistToastFor(successMsg, persisted);
  }
}

const MAX_TURNS_CEILING = 10_000;
const WRAP_UP_TURNS_CEILING = 1_000;

const RETENTION_MINUTES_CEILING = 20_160;

function clampRetentionMinutes(n: number): number {
  return Math.min(RETENTION_MINUTES_CEILING, Math.max(1, n));
}

function isRetentionMinutes(n: unknown): n is number {
  return Number.isInteger(n) && (n as number) >= 1 && (n as number) <= RETENTION_MINUTES_CEILING;
}

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

function assignmentWithout(map: Record<string, string>, key: string, value: string | undefined): Record<string, string> {
  const next = { ...map };
  if (value === undefined) delete next[key];
  else next[key] = value;
  return next;
}

export function loadSettings(): SpawnSettings {
  return sanitize(loadCouralabsSettings().spawn);
}

export function saveSettings(s: SettingsSnapshot): boolean {
  try {
    updateCouralabsSettings({ spawn: s });
    return true;
  } catch {
    return false;
  }
}

export function persistToastFor(
  successMsg: string,
  persisted: boolean,
): { message: string; level: "info" | "warning" } {
  return persisted
    ? { message: successMsg, level: "info" }
    : { message: `${successMsg} (session only; failed to persist)`, level: "warning" };
}
