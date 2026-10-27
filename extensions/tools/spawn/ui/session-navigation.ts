import { buildSessionContext, parseSessionEntries, type SessionEntry, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import type { AgentConfigLookup } from "../config/agent-types.ts";
import { isRunningStatus, type SpawnStatus } from "../lifecycle/spawn-state.ts";
import type { PersistedRunSummary } from "../persisted-record.ts";
import type { AgentSessionEvent, SessionMessage, SpawnType } from "../types.ts";
import { formatDuration, getDisplayName, getPromptModeLabel, type ModelIdentity } from "./display.ts";

export interface NavigableSpawn {
  readonly id: string;
  readonly type: SpawnType;
  readonly description: string;
  readonly status: SpawnStatus;
  readonly startedAt: number;
  readonly completedAt: number | undefined;
  readonly toolUses: number;
  readonly activeTools: ReadonlyMap<string, string>;
  readonly responseText: string;
  readonly agentMessages: readonly SessionMessage[];

  readonly outputFile: string | undefined;

  readonly model: ModelIdentity | undefined;

  readonly thinkingLevel: string | undefined;
  isSessionReady(): boolean;
  subscribeToUpdates(fn: (event: AgentSessionEvent) => void): (() => void) | undefined;
  getToolDefinition(name: string): ToolDefinition | undefined;
}

export type NavigationEntry =
  | { readonly kind: "live"; readonly label: string; readonly heading: EntryHeading; readonly record: NavigableSpawn }
  | { readonly kind: "snapshot"; readonly label: string; readonly heading: EntryHeading; readonly outputFile: string };

export interface EntryHeading {
  readonly name: string;

  readonly modeLabel: string | undefined;
  readonly description: string;
}

interface LabelFields {
  readonly type: SpawnType;
  readonly description: string;
  readonly status: SpawnStatus;
  readonly startedAt: number;
  readonly completedAt: number | undefined;
  readonly toolUses: number;
}

export interface SessionModel {
  readonly model: ModelIdentity | undefined;
  readonly thinkingLevel: string | undefined;
}

export interface StreamingState {
  readonly activeTools: ReadonlyMap<string, string>;
  readonly responseText: string;
}

export interface TranscriptSource {

  getMessages(): readonly SessionMessage[];

  subscribe(onChange: (event?: AgentSessionEvent) => void): (() => void) | undefined;

  streaming(): StreamingState | undefined;

  getToolDefinition(name: string): ToolDefinition | undefined;

  sessionModel(): SessionModel;
}

export function listNavigableAgents(
  agents: readonly NavigableSpawn[],
  registry: AgentConfigLookup,
  persisted: readonly PersistedRunSummary[],
): NavigationEntry[] {
  const live: NavigationEntry[] = [];
  const snapshots: NavigationEntry[] = [];
  for (const record of agents) {
    const heading = buildHeading(record, registry);
    if (record.isSessionReady()) {
      live.push({ kind: "live", record, heading, label: buildLabel(record, registry) });
    } else if (record.outputFile) {
      snapshots.push({ kind: "snapshot", outputFile: record.outputFile, heading, label: buildLabel(record, registry, true) });
    }
  }
  const held = new Set(agents.map((record) => record.id));
  for (const run of persisted) {
    if (held.has(run.id) || !run.outputFile) continue;
    snapshots.push({ kind: "snapshot", outputFile: run.outputFile, heading: buildHeading(run, registry), label: buildLabel(run, registry, true) });
  }
  return [...live, ...snapshots];
}

export function fileSnapshotSource(
  outputFile: string,
  readFile: (path: string) => string,
): TranscriptSource {
  const entries = parseSessionEntries(readFile(outputFile));
  const sessionEntries = entries.filter((entry): entry is SessionEntry => entry.type !== "session");
  const { messages, model, thinkingLevel } = buildSessionContext(sessionEntries);

  const recorded: SessionModel = {
    model: model?.provider && model.modelId ? { provider: model.provider, id: model.modelId } : undefined,
    thinkingLevel,
  };
  return {
    getMessages: () => messages,
    subscribe: () => undefined,
    streaming: () => undefined,
    getToolDefinition: () => undefined,
    sessionModel: () => recorded,
  };
}

export function liveSource(record: NavigableSpawn): TranscriptSource {
  return {
    getMessages: () => record.agentMessages,
    subscribe: (onChange) => record.subscribeToUpdates(onChange),
    streaming: () =>
      isRunningStatus(record.status)
        ? { activeTools: record.activeTools, responseText: record.responseText }
        : undefined,
    getToolDefinition: (name) => record.getToolDefinition(name),
    sessionModel: () => ({ model: record.model, thinkingLevel: record.thinkingLevel }),
  };
}

function buildHeading(fields: Pick<LabelFields, "type" | "description">, registry: AgentConfigLookup): EntryHeading {
  return {
    name: getDisplayName(fields.type, registry),
    modeLabel: getPromptModeLabel(fields.type, registry),
    description: fields.description,
  };
}

function buildLabel(fields: LabelFields, registry: AgentConfigLookup, released = false): string {
  const name = getDisplayName(fields.type, registry);
  const duration = formatDuration(fields.startedAt, fields.completedAt);
  const marker = released ? " · session released (snapshot)" : "";
  return `${name} (${fields.description}) · ${fields.toolUses} tools · ${fields.status} · ${duration}${marker}`;
}
