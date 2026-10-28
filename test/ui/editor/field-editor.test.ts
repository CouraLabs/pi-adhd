import { Theme } from "@earendil-works/pi-coding-agent";
import { getKeybindings } from "@earendil-works/pi-tui";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FieldEditor } from "../../../extensions/ui/editor/field-editor.ts";
import { attachImageMarkers, registerImageBytes } from "../../../extensions/ui/editor/image-paste.ts";
import type { EditorTheme, TUI } from "@earendil-works/pi-tui";
import { stripTerminalSequences, visibleWidth } from "@earendil-works/pi-tui";

vi.mock("@earendil-works/pi-coding-agent", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@earendil-works/pi-coding-agent")>();
	return { ...actual, copyToClipboard: vi.fn().mockResolvedValue(undefined) };
});

const copyToClipboard = vi.mocked(
	(await import("@earendil-works/pi-coding-agent")).copyToClipboard,
);

const themePath = join(
	process.cwd(),
	"node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/theme/dark.json",
);
const themeJson = JSON.parse(readFileSync(themePath, "utf8")) as {
	colors: Record<string, string>;
	vars: Record<string, string>;
};
const colors = Object.fromEntries(
	Object.entries(themeJson.colors).map(([token, value]) => [token, themeJson.vars[value] ?? value]),
);
const theme = new Theme(colors as never, {} as never, "truecolor");

const LEFT = "\x1b[D";
const SHIFT_LEFT = "\x1b[1;2D";
const SHIFT_RIGHT = "\x1b[1;2C";
const BACKSPACE = "\x7f";
const FORWARD_DELETE = "\x1b[3~";
const CTRL_A = "\x01";
const CTRL_C = "\x03";
const UNDO = "\x1f";

const fakeTui = {
	terminal: { rows: 40, columns: 100 },
	requestRender() {},
	requestImmediateRender() {},
} as unknown as TUI;

const fakeTheme = {
	borderColor: (text: string) => text,
	selectList: {},
} as unknown as EditorTheme;

interface ActiveSelectionView {
	anchor: { line: number; col: number };
	focus: { line: number; col: number };
}

const createEditor = () =>
	new FieldEditor(
		fakeTui,
		fakeTheme,
		getKeybindings() as never,
		() => ({ cwd: "/tmp/demo", git: { branch: "main", additions: 1, removals: 0 }, theme, fullCwd: false }),
		() => "idle",
	);

let editor: FieldEditor;

const type = (text: string) => {
	for (const char of text) editor.handleInput(char);
};

const selectionView = () =>
	(editor as unknown as { selection: ActiveSelectionView | undefined }).selection;

const selectedText = () => (editor as unknown as { selectedText(): string }).selectedText();

const cursorCells = (rendered: string[]): string[] => {
	const cells: string[] = [];
	const pattern = new RegExp("\x1b_pi:fc\x07([\\s\\S]*?)\x1b_pi:/fc\x07", "g");
	for (const line of rendered) {
		for (const match of line.matchAll(pattern)) cells.push(stripTerminalSequences(match[1]));
	}
	return cells;
};

beforeEach(() => {
	editor = createEditor();
	copyToClipboard.mockClear();
	copyToClipboard.mockResolvedValue(undefined);
});

describe("selection", () => {
	it("ctrl+a selects all", () => {
		type("alpha\nbeta");
		editor.handleInput(CTRL_A);
		expect(selectionView()).toEqual({ anchor: { line: 0, col: 0 }, focus: { line: 1, col: 4 } });
		expect(selectedText()).toBe("alpha\nbeta");
	});

	it("shift+left extends character by character", () => {
		type("word");
		editor.handleInput(SHIFT_LEFT);
		editor.handleInput(SHIFT_LEFT);
		expect(selectedText()).toBe("rd");
	});

	it("shift+left wraps to the previous line", () => {
		type("one\ntwo");
		for (let i = 0; i < 4; i++) editor.handleInput(SHIFT_LEFT);
		expect(selectedText()).toBe("\ntwo");
		editor.handleInput(SHIFT_LEFT);
		expect(selectedText()).toBe("e\ntwo");
	});

	it("shift+right wraps to the next line", () => {
		type("one\ntwo");
		for (let i = 0; i < 4; i++) editor.handleInput(LEFT);
		editor.handleInput(SHIFT_RIGHT);
		expect(selectedText()).toBe("\n");
		editor.handleInput(SHIFT_RIGHT);
		expect(selectedText()).toBe("\nt");
	});

	it("typing replaces the selection and clears it", () => {
		type("word");
		editor.handleInput(SHIFT_LEFT);
		editor.handleInput(SHIFT_LEFT);
		editor.handleInput("X");
		expect(editor.getText()).toBe("woX");
		expect(selectionView()).toBeUndefined();
	});

	it("backspace deletes the whole selection", () => {
		type("alpha\nbeta");
		editor.handleInput(CTRL_A);
		editor.handleInput(BACKSPACE);
		expect(editor.getText()).toBe("");
	});

	it("forward delete removes the whole selection", () => {
		type("alpha");
		editor.handleInput(CTRL_A);
		editor.handleInput(FORWARD_DELETE);
		expect(editor.getText()).toBe("");
	});

	it("plain movement clears the selection", () => {
		type("word");
		editor.handleInput(SHIFT_LEFT);
		editor.handleInput(LEFT);
		expect(selectionView()).toBeUndefined();
	});

	it("collapses to no selection when the cursor returns to the anchor", () => {
		type("word");
		editor.handleInput(SHIFT_LEFT);
		editor.handleInput(SHIFT_RIGHT);
		expect(selectionView()).toBeUndefined();
	});
});

describe("selection auto-copy", () => {
	it("copies the selection after the debounce", async () => {
		vi.useFakeTimers();
		try {
			type("hello");
			editor.handleInput(SHIFT_LEFT);
			editor.handleInput(SHIFT_LEFT);
			await vi.advanceTimersByTimeAsync(400);
			expect(copyToClipboard).toHaveBeenCalledWith("lo");
		} finally {
			vi.useRealTimers();
		}
	});

	it("debounces rapid extensions into one copy", async () => {
		vi.useFakeTimers();
		try {
			type("hello");
			editor.handleInput(SHIFT_LEFT);
			await vi.advanceTimersByTimeAsync(100);
			editor.handleInput(SHIFT_LEFT);
			await vi.advanceTimersByTimeAsync(100);
			editor.handleInput(SHIFT_LEFT);
			await vi.advanceTimersByTimeAsync(100);
			expect(copyToClipboard).not.toHaveBeenCalled();
			await vi.advanceTimersByTimeAsync(300);
			expect(copyToClipboard).toHaveBeenCalledTimes(1);
			expect(copyToClipboard).toHaveBeenCalledWith("llo");
		} finally {
			vi.useRealTimers();
		}
	});

	it("ctrl+c copies the selection immediately", async () => {
		type("hello");
		editor.handleInput(SHIFT_LEFT);
		editor.handleInput(SHIFT_LEFT);
		editor.handleInput(CTRL_C);
		await vi.waitFor(() => expect(copyToClipboard).toHaveBeenCalledWith("lo"));
		expect(selectionView()).toEqual({ anchor: { line: 0, col: 5 }, focus: { line: 0, col: 3 } });
	});

	it("does not copy when the selection is cleared", async () => {
		vi.useFakeTimers();
		try {
			type("hello");
			editor.handleInput(SHIFT_LEFT);
			editor.handleInput(LEFT);
			await vi.advanceTimersByTimeAsync(1000);
			expect(copyToClipboard).not.toHaveBeenCalled();
		} finally {
			vi.useRealTimers();
		}
	});
});

describe("image objects", () => {
	it("renders and deletes as one unit", async () => {
		const marker = await registerImageBytes(Uint8Array.from([0x89, 0x50, 0x4e, 0x47]), true);
		editor.insertTextAtCursor(`see ${marker}`);
		expect(editor.getText()).toBe(`see ${marker}`);
		editor.handleInput(BACKSPACE);
		expect(editor.getText()).toBe("see ");
	});

	it("survives undo with a working attachment", async () => {
		const marker = await registerImageBytes(Uint8Array.from([0x89, 0x50, 0x4e, 0x47]), true);
		editor.insertTextAtCursor(marker);
		editor.handleInput(BACKSPACE);
		editor.handleInput(UNDO);
		expect(editor.getText()).toBe(marker);
		const attached = await attachImageMarkers(editor.getText());
		expect(attached.images).toHaveLength(1);
	});

	it("select all treats the object as text", async () => {
		const marker = await registerImageBytes(Uint8Array.from([0x89, 0x50, 0x4e, 0x47]), true);
		editor.insertTextAtCursor(marker);
		editor.handleInput(CTRL_A);
		expect(selectedText()).toBe(marker);
	});
});

describe("rendering", () => {
	it("keeps row widths constant with styled markdown", () => {
		type("# Title\n\nSome **bold** and `code` text\n- item one\n- item two");
		const lines = editor.render(80);
		const widths = lines.map(visibleWidth);
		expect(new Set(widths).size).toBe(1);
	});

	it("places the fake cursor on the correct character inside styled text", () => {
		type("plain **bold** tail");
		for (let i = 0; i < 5; i++) editor.handleInput(LEFT);
		const cursor = editor.getCursor();
		const lineText = editor.getText().split("\n")[cursor.line] ?? "";
		const expected = cursor.col >= lineText.length ? " " : lineText[cursor.col];
		const cells = cursorCells(editor.render(80));
		expect(cells).toEqual([expected]);
	});

	it("highlights the selection without breaking text", () => {
		type("hello world");
		for (let i = 0; i < 5; i++) editor.handleInput(SHIFT_LEFT);
		const lines = editor.render(80);
		const joined = lines.join("\n");
		expect(joined).toContain("selectedBg" === "" ? "never" : "\x1b[4");
		expect(lines.map(stripTerminalSequences).join("\n")).toContain("hello world");
		expect(cursorCells(lines)).toEqual(["w"]);
	});

	it("shows the image object in rendered output", async () => {
		const marker = await registerImageBytes(Uint8Array.from([0x89, 0x50, 0x4e, 0x47]), true);
		editor.insertTextAtCursor(marker);
		const lines = editor.render(80);
		expect(lines.map(stripTerminalSequences).join("\n")).toContain("[Image #1]");
	});
});
