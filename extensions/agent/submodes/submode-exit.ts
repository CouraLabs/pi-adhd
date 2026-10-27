import type { ExtensionToolContext, ThemeColor, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { defineTool } from "@earendil-works/pi-coding-agent";
import { StringEnum } from "@earendil-works/pi-ai";
import { Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import { SUBMODE_LABEL } from "../../../shared/submodes.ts";

export type SubmodeExitMode = "exit" | "plan" | "grill" | "straight";

export interface SubmodeExitDeps {
	transition: (mode: SubmodeExitMode, ctx: ExtensionToolContext) => string;
}

const DESCRIPTION = `Exit the current submode or switch to another one.

- mode "exit": leave the submode and return to the normal coder agent.
- mode "plan": switch to the Plan submode (architect, submits a plan for review).
- mode "grill": switch to the Grill submode (designer, interviews you to a shared understanding).
- mode "straight": switch to the Straight submode (guided implementer, asks clarifying questions then implements with the full toolset).

Call this only when the current submode's work is done or the user asked to switch. The current run ends so the target submode takes effect.`;

const SWITCH_ARROW = "→";

const MODE_LABEL: Record<SubmodeExitMode, string> = {
	exit: "exit",
	plan: `${SWITCH_ARROW} ${SUBMODE_LABEL.plan}`,
	grill: `${SWITCH_ARROW} ${SUBMODE_LABEL.grill}`,
	straight: `${SWITCH_ARROW} ${SUBMODE_LABEL.straight}`,
};

const MODE_COLOR: Record<SubmodeExitMode, ThemeColor> = {
	exit: "muted",
	plan: "accent",
	grill: "warning",
	straight: "accent",
};

export function createSubmodeExitTool(deps: SubmodeExitDeps): ToolDefinition {
	return defineTool({
		name: "submode-exit",
		label: "Exit Submode",
		description: DESCRIPTION,
		promptSnippet: "Exit the current submode or switch to another",
		exposure: "direct",
		defaultActive: false,
		executionMode: "sequential",
		parameters: Type.Object({
			mode: StringEnum(["exit", "plan", "grill", "straight"] as const, {
				description: 'Target: "exit" to leave, "plan", "grill", or "straight" to switch.',
			}),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, ctx: ExtensionToolContext) {
			const message = deps.transition(params.mode, ctx);
			return {
				content: [{ type: "text" as const, text: message }],
				details: { mode: params.mode },
				terminate: true,
			};
		},
		renderCall(args, theme) {
			const mode = args?.mode as SubmodeExitMode | undefined;
			const label = mode ? ` ${theme.fg(MODE_COLOR[mode], MODE_LABEL[mode])}` : "";
			return new Text(`${theme.fg("toolTitle", theme.bold("Submode"))}${label}`, 0, 0);
		},
		renderResult(result, _options, theme) {
			const details = result.details as { mode?: SubmodeExitMode } | undefined;
			const mode = details?.mode ?? "exit";
			const text = result.content[0]?.type === "text" ? result.content[0].text : "";
			const glyph = mode === "exit" ? theme.fg("success", "✓") : theme.fg(MODE_COLOR[mode], SWITCH_ARROW);
			return new Text(`${glyph} ${theme.fg("muted", text)}`, 0, 0);
		},
	});
}
