import type { ThemeColor } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { isTerminalErrorStatus } from "../lifecycle/subagent-state.ts";
import { wrappedUpAtTurnLimit } from "../lifecycle/turn-limits.ts";
import type {
  NotificationDetails,
  UpdateDetails,
  WorkspaceNoticeDetails,
} from "../observation/notification.ts";
import { formatMs } from "./display.ts";
import { GLYPHS } from "./glyphs.ts";
import { emptyUsage, usageCost, usageGroup } from "../../../../shared/usage.ts";

/** Narrow theme interface — only the methods the renderer actually calls. */
interface RendererTheme {
  fg(color: ThemeColor, text: string): string;
  bold(text: string): string;
}

/** Narrow message interface — only the fields the renderer reads. */
interface RendererMessage {
  details?: NotificationDetails;
}

/** Narrow message interface for the update renderer. */
interface UpdateMessage {
  details?: UpdateDetails;
}

/** Narrow message interface for the workspace-notice renderer. */
interface WorkspaceNoticeMessage {
  details?: WorkspaceNoticeDetails;
}

/** Narrow render options — only the fields the renderer reads. */
interface RenderOptions {
  expanded: boolean;
}

// ---- Pure helpers (exported for unit testing) ----

/** Resolved status→presentation product: icon glyph/style and status label. */
export interface StatusPresentation {
  iconGlyph: string;
  iconStyle: ThemeColor;
  statusText: string;
}

/** Decide the icon and status label for a notification's status, once. */
export function resolveStatusPresentation(
  outcome: Pick<NotificationDetails, "status" | "turnBudget">,
): StatusPresentation {
  if (isTerminalErrorStatus(outcome.status))
    return { iconGlyph: GLYPHS.failure, iconStyle: "error", statusText: outcome.status };
  const statusText = wrappedUpAtTurnLimit(outcome) ? "completed (wrapped up)" : "completed";
  return { iconGlyph: GLYPHS.success, iconStyle: "success", statusText };
}

/** Fields `buildStatsParts` reads from a `NotificationDetails`. */
type StatsSource = Pick<
  NotificationDetails,
  "usage" | "durationMs"
>;

/** Assemble the stats-line parts (usage group, cost, duration), omitting empty fields. */
export function buildStatsParts(d: StatsSource, theme: RendererTheme): string[] {
  const parts: string[] = [];
  const usage = d.usage ?? emptyUsage();
  const group = usageGroup(usage, theme);
  if (group) parts.push(group);
  const cost = usageCost(usage, theme);
  if (cost) parts.push(cost);
  if (d.durationMs > 0) parts.push(theme.fg("dim", formatMs(d.durationMs)));
  return parts;
}

/**
 * Content lines for the result preview: the whole result (capped at 30 lines)
 * when expanded, or just the first line (capped at 80 columns) when collapsed.
 */
export function buildPreviewLines(resultPreview: string, expanded: boolean): string[] {
  if (expanded) return resultPreview.split("\n").slice(0, 30);
  return [resultPreview.split("\n")[0]?.slice(0, 80) ?? ""];
}

/**
 * Create the notification renderer callback for `pi.registerMessageRenderer`.
 * Returns a factory so the renderer is independently testable without the Pi SDK.
 */
export function createNotificationRenderer() {
  return (message: RendererMessage, { expanded }: RenderOptions, theme: RendererTheme): Text | undefined => {
    const d = message.details;
    if (!d) return undefined;

    const { iconGlyph, iconStyle, statusText } = resolveStatusPresentation(d);

    // Line 1: icon + agent description + status
    let line = `${theme.fg(iconStyle, iconGlyph)} ${theme.bold(d.description)} ${theme.fg("dim", statusText)}`;

    // Line 2: stats
    const parts = buildStatsParts(d, theme);
    if (parts.length) {
      line += "\n  " + parts.join(" " + theme.fg("dim", "·") + " ");
    }

    // Line 3: result preview (collapsed) or full (expanded)
    const previewLines = buildPreviewLines(d.resultPreview, expanded);
    if (expanded) {
      for (const l of previewLines) line += "\n" + theme.fg("dim", `  ${l}`);
    } else {
      line += "\n  " + theme.fg("dim", `${GLYPHS.subLine}  ${previewLines[0] ?? ""}`);
    }

    // Line 4: output file link (if present)
    if (d.outputFile) {
      line += "\n  " + theme.fg("muted", `transcript: ${d.outputFile}`);
    }

    return new Text(line, 0, 0);
  };
}

/**
 * Create the mid-run update renderer for `pi.registerMessageRenderer`.
 *
 * Separate from the completion renderer because the agent has not finished:
 * `resolveStatusPresentation` speaks only terminal statuses, so reusing it
 * would draw a still-running child as completed.
 */
export function createUpdateRenderer() {
  return (message: UpdateMessage, { expanded }: RenderOptions, theme: RendererTheme): Text | undefined => {
    const d = message.details;
    if (!d) return undefined;

    let line = `${theme.fg("accent", GLYPHS.agentsActive)} ${theme.bold(d.description)} ${theme.fg("dim", "update")}`;
    for (const l of buildPreviewLines(d.message, expanded)) {
      line += "\n  " + theme.fg("dim", expanded ? `  ${l}` : `${GLYPHS.subLine}  ${l}`);
    }
    return new Text(line, 0, 0);
  };
}

/**
 * Create the workspace-notice renderer for `pi.registerMessageRenderer`.
 *
 * Separate from the completion renderer because the agent's outcome was
 * reported long ago and has not changed: this reports only what a teardown did
 * with the child's work, so it carries no status, stats, or result preview.
 */
export function createWorkspaceNoticeRenderer() {
  return (
    message: WorkspaceNoticeMessage,
    { expanded }: RenderOptions,
    theme: RendererTheme,
  ): Text | undefined => {
    const d = message.details;
    if (!d) return undefined;

    let line = `${theme.fg("warning", GLYPHS.success)} ${theme.bold(d.description)} ${theme.fg("dim", "workspace")}`;
    for (const l of buildPreviewLines(d.notice.trim(), expanded)) {
      line += "\n  " + theme.fg("dim", expanded ? `  ${l}` : `${GLYPHS.subLine}  ${l}`);
    }
    return new Text(line, 0, 0);
  };
}
