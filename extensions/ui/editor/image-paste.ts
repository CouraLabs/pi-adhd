import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ImageContent } from "@earendil-works/pi-ai";
import { getNativeClipboard } from "@earendil-works/pi-tui";
import { createGlobalStore } from "../../../shared/store.ts";

export const IMAGE_MARKER_PATTERN = /\[Image #(\d+)\]/g;

interface ImageEntry {

	path: string;

	mimeType: string;
}

interface ImagePasteState {

	entries: Map<number, ImageEntry>;

	nextId: number;
}

const store = createGlobalStore<ImagePasteState>(Symbol.for("couralabs.editor.imagePastes"), {
	entries: new Map<number, ImageEntry>(),
	nextId: 1,
});

export function imageMarkerSpans(text: string): Array<{ start: number; end: number }> {
	const spans: Array<{ start: number; end: number }> = [];
	for (const match of text.matchAll(IMAGE_MARKER_PATTERN)) {
		spans.push({ start: match.index, end: match.index + match[0].length });
	}
	return spans;
}

export function sniffImageMimeType(bytes: Uint8Array): string {
	if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
		return "image/png";
	}
	if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
		return "image/jpeg";
	}
	if (bytes.length >= 6 && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) {
		return "image/gif";
	}
	if (
		bytes.length >= 12
		&& bytes[0] === 0x52
		&& bytes[1] === 0x49
		&& bytes[2] === 0x46
		&& bytes[3] === 0x46
		&& bytes[8] === 0x57
		&& bytes[9] === 0x45
		&& bytes[10] === 0x42
		&& bytes[11] === 0x50
	) {
		return "image/webp";
	}
	return "image/png";
}

export async function pasteImageFromClipboard(resetNumbering: boolean): Promise<string | undefined> {
	const clipboard = getNativeClipboard();
	const bytes = await clipboard?.getImage();
	if (!bytes || bytes.length === 0) return undefined;
	return registerImageBytes(bytes, resetNumbering);
}

export async function registerImageBytes(bytes: Uint8Array, resetNumbering: boolean): Promise<string> {
	const state = store.get();
	if (resetNumbering) {
		state.entries.clear();
		state.nextId = 1;
	}
	const id = state.nextId++;
	const mimeType = sniffImageMimeType(bytes);
	const extension = mimeType.slice("image/".length);
	const path = join(tmpdir(), `pi-clipboard-${randomUUID()}.${extension}`);
	await writeFile(path, bytes);
	state.entries.set(id, { path, mimeType });
	return `[Image #${id}]`;
}

export interface AttachedImages {

	text: string;

	images: ImageContent[];
}

export function imageEntry(id: number): ImageEntry | undefined {
	return store.get().entries.get(id);
}

export async function attachImageMarkers(text: string): Promise<AttachedImages> {
	const ids = new Set<number>();
	for (const match of text.matchAll(IMAGE_MARKER_PATTERN)) {
		ids.add(Number(match[1]));
	}
	if (ids.size === 0) return { text, images: [] };
	const state = store.get();
	const images: ImageContent[] = [];
	let result = text;
	for (const id of [...ids].sort((a, b) => a - b)) {
		const entry = state.entries.get(id);
		if (!entry) continue;
		try {
			const bytes = await readFile(entry.path);
			images.push({ type: "image", data: bytes.toString("base64"), mimeType: entry.mimeType });
		} catch {
			result = result.replaceAll(`[Image #${id}]`, "");
		}
	}
	return { text: result, images };
}
