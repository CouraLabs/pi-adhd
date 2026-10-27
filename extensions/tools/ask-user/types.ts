export interface ExtensionUISelectOption {
	label: string;
	description?: string;
}

export type ExtensionUISelectItem = string | ExtensionUISelectOption;

export interface ExtensionAskDialogOption {
	label: string;
	description?: string;
	preview?: string;
}

export interface ExtensionAskDialogQuestion {
	id: string;
	question: string;
	header?: string;
	options: ExtensionAskDialogOption[];
	multi?: boolean;
	recommended?: number;
}

export interface ExtensionAskDialogResultItem {
	id: string;
	question: string;
	options: string[];
	multi: boolean;
	selectedOptions: string[];
	customInput?: string;
	timedOut?: boolean;
}

export interface ExtensionAskDialogSubmitResult {
	kind: "submit";
	results: ExtensionAskDialogResultItem[];
}

export type ExtensionAskDialogResult = ExtensionAskDialogSubmitResult;

export interface QuestionResult {
	id: string;
	question: string;
	options: string[];
	multi: boolean;
	selectedOptions: string[];
	customInput?: string;
	timedOut?: boolean;
}

export interface AskToolDetails {
	question?: string;
	options?: string[];
	multi?: boolean;
	selectedOptions?: string[];
	customInput?: string;
	timedOut?: boolean;
	results?: QuestionResult[];
}

export interface AskOption {
	label: string;
	description?: string;
}
