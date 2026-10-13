import type { AgentToolResult } from "@earendil-works/pi-coding-agent";
import type { ParentSnapshot } from "../lifecycle/parent-snapshot.ts";
import type { AgentSpawnConfig } from "../lifecycle/spawn-manager.ts";
import {
  renderOutcomeAddenda,
  renderOutcomeBody,
  renderStatusNote,
  renderWorkspaceNotice,
} from "../observation/outcome-delivery.ts";
import {
  buildDetails,
  formatLifetimeTokens,
  renderSpawnNotes,
  textResult,
} from "./helpers.ts";
import type { ResolvedSpawnConfig, SpawnPresentation } from "./spawn-config.ts";
import type { ParentSessionInfo, Spawn } from "../types.ts";
import { toUsageTotals } from "../lifecycle/usage.ts";
import { type AgentDetails, describeActivity, formatMs, modelLabel } from "../ui/display.ts";
import { SPINNER } from "../ui/glyphs.ts";

/** Narrow manager interface for the foreground runner. */
export interface ForegroundManagerDeps {
  spawnAndWait(
    snapshot: ParentSnapshot,
    type: string,
    prompt: string,
    opts: AgentSpawnConfig,
  ): Promise<Spawn>;
}

/** All values the foreground runner needs beyond the resolved config. */
export interface ForegroundParams {
  config: ResolvedSpawnConfig;
  snapshot: ParentSnapshot;
  parentSession: ParentSessionInfo;
}

/**
 * Stream a running agent's live state through `onUpdate` on Pi's spinner
 * cadence, returning a stop function. Shared by the foreground spawn and
 * foreground resume paths, so both show the same live spinner, stats, and
 * activity line instead of a static row until the run settles.
 *
 * `getRecord` is read on every tick rather than captured, because the spawn
 * path only learns its record once `onSessionCreated` fires — after the stream
 * has already started.
 */
export function startRunningStream(
  getRecord: () => Spawn | undefined,
  detailBase: SpawnPresentation["detailBase"],
  onUpdate: ((update: AgentToolResult<AgentDetails>) => void) | undefined,
  startedAt: number,
): () => void {
  if (!onUpdate) return () => {};

  let spinnerFrame = 0;
  const streamUpdate = () => {
    const record = getRecord();
    const toolUses = record?.toolUses ?? 0;
    const details: AgentDetails = {
      ...detailBase,
      modelName: modelLabel(record?.model) ?? detailBase.modelName,
      toolUses,
      tokens: record ? formatLifetimeTokens(record) : "",
      usage: record ? toUsageTotals(record.lifetimeUsage) : undefined,
      // Read activity off the record; absent until the session reports it.
      turnBudget: record?.turnBudget,
      durationMs: Date.now() - startedAt,
      status: "running",
      activity: describeActivity(
        record?.activeTools ?? new Map(),
        record?.responseText ?? "",
      ),
      spinnerFrame: spinnerFrame % SPINNER.length,
    };
    onUpdate({
      content: [{ type: "text", text: `${toolUses} tool uses...` }],
      details,
    });
  };

  // Animate spinner at ~80ms (smooth rotation through 10 braille frames)
  const spinnerInterval = setInterval(() => {
    spinnerFrame++;
    streamUpdate();
  }, 80);

  streamUpdate();

  return () => clearInterval(spinnerInterval);
}

/**
 * Run an agent synchronously in the foreground, streaming spinner updates.
 * Owns: spinner interval, streaming onUpdate callbacks, cleanup, and result formatting.
 */
export async function runForeground(
  manager: ForegroundManagerDeps,
  params: ForegroundParams,
  signal: AbortSignal | undefined,
  onUpdate: ((update: AgentToolResult<AgentDetails>) => void) | undefined,
) {
  const { identity, execution, presentation } = params.config;
  const startedAt = Date.now();

  let recordRef: Spawn | undefined;
  const stopStream = startRunningStream(
    () => recordRef,
    presentation.detailBase,
    onUpdate,
    startedAt,
  );

  let record: Spawn;
  try {
    record = await manager.spawnAndWait(
      params.snapshot,
      identity.spawnType,
      execution.prompt,
      {
        description: execution.description,
        model: execution.model,
        maxTurns: execution.effectiveMaxTurns,
        inheritContext: execution.inheritContext,
        thinkingLevel: execution.thinking,
        signal,
        parentSession: params.parentSession,
        observer: {
          onSessionCreated: (agent) => {
            recordRef = agent;
          },
        },
      },
    );
  } catch (err) {
    stopStream();
    return textResult(err instanceof Error ? err.message : String(err));
  }

  stopStream();

  // Foreground-return delivery edge: the result is handed back in this tool
  // result, so the outcome is collected. Mark it consumed.
  record.markConsumed();

  const tokenText = formatLifetimeTokens(record);
  const details = buildDetails(presentation.detailBase, record, { tokens: tokenText });

  const noteText = renderSpawnNotes(params.config.notes);

  if (record.status === "error") {
    // A failed run has no result text, so this return is the only carrier that
    // can say where its workspace saved the work — or what the child flagged
    // before the failure, which is the one place those findings survive.
    // The transcript pointer rides here for the same reason: with no result to
    // read, it is the parent's only route to what the child did before it died.
    // The success branch omits it deliberately — that return carries the result.
    // The ask-back affordance is not composed here: a failed run answers no
    // question, so this is the addenda tail minus the one that cannot apply.
    const transcriptLine = record.outputFile
      ? `\nFull transcript available at: ${record.outputFile}`
      : "";
    return textResult(
      `${noteText}Agent failed: ${record.error}\nAgent ID: ${record.id}${transcriptLine}` +
        renderWorkspaceNotice(record.workspaceNotice),
      details,
    );
  }

  const durationMs = (record.completedAt ?? Date.now()) - record.startedAt;
  const statsParts = [`${record.toolUses} tool uses`];
  if (tokenText) statsParts.push(tokenText);
  return textResult(
    `${noteText}Agent completed in ${formatMs(durationMs)} (${statsParts.join(", ")})${renderStatusNote(record)}.\n` +
      `Agent ID: ${record.id}\n\n` +
      renderOutcomeBody(record) +
      renderOutcomeAddenda(record),
    details,
  );
}
