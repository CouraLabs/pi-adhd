import type { ExtensionUIContext } from "@earendil-works/pi-coding-agent";
import { AskDialogComponent } from "./ask-dialog.ts";
import { untilAborted } from "./ask-legacy.ts";
import type { ExtensionAskDialogQuestion, ExtensionAskDialogResult } from "./types.ts";

export interface RichAskDialogOptions {
	timeoutMilliseconds?: number;
	signal?: AbortSignal;
}

export function showRichAskDialog(
	extensionUi: Pick<ExtensionUIContext, "custom">,
	questions: ExtensionAskDialogQuestion[],
	options: RichAskDialogOptions = {},
): Promise<ExtensionAskDialogResult | undefined> {
	const { timeoutMilliseconds, signal } = options;
	const showDialog = () =>
		extensionUi.custom<ExtensionAskDialogResult | undefined>((tui, theme, keybindings, done) => {
			const dialog = new AskDialogComponent(
				theme,
				keybindings,
				questions,
				{
					onSubmit: (result) => done(result),
					onCancel: () => done(undefined),
				},
				{ timeout: timeoutMilliseconds, tui: { requestRender: () => tui.requestRender() } },
			);
			signal?.addEventListener("abort", () => dialog.externalCancel(), { once: true });
			return dialog;
		});
	return untilAborted(signal, showDialog);
}
