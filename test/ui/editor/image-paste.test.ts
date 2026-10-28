import { rm } from "node:fs/promises";
import { afterEach, describe, expect, it } from "vitest";
import {
	attachImageMarkers,
	imageEntry,
	registerImageBytes,
	sniffImageMimeType,
} from "../../../extensions/ui/editor/image-paste.ts";

const PNG_HEADER = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const JPEG_HEADER = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
const GIF_HEADER = Uint8Array.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 1, 2]);
const WEBP_HEADER = Uint8Array.from([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]);

afterEach(async () => {
	await registerImageBytes(PNG_HEADER, true);
});

describe("sniffImageMimeType", () => {
	it("detects supported formats", () => {
		expect(sniffImageMimeType(PNG_HEADER)).toBe("image/png");
		expect(sniffImageMimeType(JPEG_HEADER)).toBe("image/jpeg");
		expect(sniffImageMimeType(GIF_HEADER)).toBe("image/gif");
		expect(sniffImageMimeType(WEBP_HEADER)).toBe("image/webp");
	});
});

describe("registerImageBytes", () => {
	it("writes the image to a temp file and returns the marker", async () => {
		const marker = await registerImageBytes(PNG_HEADER, true);
		expect(marker).toBe("[Image #1]");
		const attached = await attachImageMarkers(`see ${marker}`);
		expect(attached.images).toHaveLength(1);
		expect(attached.images[0]).toMatchObject({ type: "image", mimeType: "image/png" });
		expect(attached.text).toBe(`see ${marker}`);
	});

	it("keeps numbering stable across registrations and resets on empty editor", async () => {
		const second = await registerImageBytes(PNG_HEADER, false);
		expect(second).toBe("[Image #2]");
		const reset = await registerImageBytes(PNG_HEADER, true);
		expect(reset).toBe("[Image #1]");
	});

	it("strips markers whose temp file disappeared", async () => {
		const marker = await registerImageBytes(PNG_HEADER, true);
		const entry = imageEntry(1);
		expect(entry).toBeDefined();
		await rm(entry.path, { force: true });
		const attached = await attachImageMarkers(`before ${marker} after`);
		expect(attached.images).toHaveLength(0);
		expect(attached.text).toBe("before  after");
	});

	it("ignores markers without registry entries", async () => {
		const attached = await attachImageMarkers("see [Image #9] below");
		expect(attached).toEqual({ text: "see [Image #9] below", images: [] });
	});
});
