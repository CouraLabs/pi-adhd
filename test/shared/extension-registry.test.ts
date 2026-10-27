import { afterEach, describe, expect, it } from "vitest";
import {
	isExtensionLoaded,
	markExtensionLoaded,
	resetExtensionRegistry,
	type ExtensionName,
} from "../../shared/extension-registry.ts";

const REGISTRY_KEY = Symbol.for("@couralabs/pi-adhd/loaded-extensions");

function registrySet(): Set<ExtensionName> {
	return (globalThis as Record<symbol, { value: Set<ExtensionName> }>)[REGISTRY_KEY].value;
}

describe("extension registry", () => {
	afterEach(() => {
		resetExtensionRegistry();
	});

	it("reports extensions as not loaded before marking", () => {
		resetExtensionRegistry();
		expect(isExtensionLoaded("timer")).toBe(false);
	});

	it("reports an extension as loaded after markExtensionLoaded", () => {
		markExtensionLoaded("timer");
		expect(isExtensionLoaded("timer")).toBe(true);
	});

	it("marks each extension independently", () => {
		markExtensionLoaded("timer");
		markExtensionLoaded("spawn");
		expect(isExtensionLoaded("timer")).toBe(true);
		expect(isExtensionLoaded("spawn")).toBe(true);
		expect(isExtensionLoaded("web")).toBe(false);
	});

	it("is idempotent for the same extension name", () => {
		markExtensionLoaded("timer");
		const before = registrySet();
		markExtensionLoaded("timer");
		expect(registrySet()).toBe(before);
	});

	it("copies the set instead of mutating it", () => {
		markExtensionLoaded("timer");
		const before = registrySet();
		markExtensionLoaded("web");
		expect(registrySet()).not.toBe(before);
		expect(before.has("timer")).toBe(true);
		expect(before.has("web")).toBe(false);
	});

	it("resetExtensionRegistry clears every marked extension", () => {
		markExtensionLoaded("timer");
		markExtensionLoaded("web");
		resetExtensionRegistry();
		expect(isExtensionLoaded("timer")).toBe(false);
		expect(isExtensionLoaded("web")).toBe(false);
	});
});
