import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import type { Model } from "@earendil-works/pi-ai";
import { readModeDeclaration, type AgentMode } from "../../../shared/modes.ts";
import {
	resolveInvocationModel,
	type DefaultModelRef,
	type ModelRegistry,
} from "../../../shared/model-resolver.ts";
import { resolveConfiguredDefaultModel } from "../../tools/spawn/config/default-model.ts";

interface ModeModelDeclaration {
	model?: string;
	error?: string;
}

export interface ModeModelSwitchDecision {
	switchTo?: Model<any>;
	error?: string;
	unchanged?: boolean;
}

export function resolveModeModelSwitch(
	declaration: ModeModelDeclaration | undefined,
	currentModel: Model<any> | undefined,
	registry: ModelRegistry,
	defaultModelRef?: DefaultModelRef,
): ModeModelSwitchDecision {
	if (declaration === undefined) {
		return { error: "Mode declaration could not be read." };
	}
	if (declaration.error !== undefined) {
		return { error: declaration.error };
	}
	const modelInput = declaration.model?.trim();
	if (!modelInput) {
		return { unchanged: true };
	}
	const resolution = resolveInvocationModel(currentModel, modelInput, false, registry, defaultModelRef);
	if (resolution.error !== undefined) {
		return { error: resolution.error };
	}
	if (resolution.fallbackNote !== undefined) {
		return { error: resolution.fallbackNote };
	}
	const resolved = resolution.model;
	if (resolved === undefined) {
		return { unchanged: true };
	}
	if (currentModel && currentModel.provider === resolved.provider && currentModel.id === resolved.id) {
		return { unchanged: true };
	}
	return { switchTo: resolved };
}

export async function applyModeModel(
	pi: ExtensionAPI,
	ctx: ExtensionCommandContext,
	mode: AgentMode,
): Promise<ModeModelSwitchDecision> {
	const decision = resolveModeModelSwitch(
		readModeDeclaration(mode),
		ctx.model,
		ctx.modelRegistry,
		resolveConfiguredDefaultModel(ctx.cwd),
	);
	if (decision.error !== undefined || decision.switchTo === undefined) return decision;
	if (!(await pi.setModel(decision.switchTo))) {
		return {
			error: `No credentials for ${decision.switchTo.provider}/${decision.switchTo.id}; the model could not be switched.`,
		};
	}
	return decision;
}
