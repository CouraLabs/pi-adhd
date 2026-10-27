import { describe, expect, it, vi } from "vitest";
import type { ProviderRegistrar, RegisteredProviderSource } from "../../../../extensions/tools/spawn/session/provider-inheritance.ts";
import { inheritRegisteredProviders } from "../../../../extensions/tools/spawn/session/provider-inheritance.ts";

interface Fixture {
	native?: string;
	config?: string;
}

function sourceWith(ids: string[], fixtures: Record<string, Fixture>) {
	return {
		getRegisteredProviderIds: () => ids,
		getRegisteredNativeProvider: (id: string) => fixtures[id]?.native,
		getRegisteredProviderConfig: (id: string) => fixtures[id]?.config,
	};
}

function recorder() {
	const calls: string[] = [];
	return {
		calls,
		registerNative: vi.fn((provider: string) => calls.push(`native:${provider}`)),
		registerConfigured: vi.fn((id: string, config: string) => calls.push(`config:${id}:${config}`)),
	} as unknown as ProviderRegistrar<string, string> & { calls: string[] };
}

describe("inheritRegisteredProviders", () => {
	it("prefers the native provider over the config one", () => {
		const target = recorder();
		inheritRegisteredProviders(
			sourceWith(["a"], { a: { native: "native-a", config: "config-a" } }),
			target,
		);
		expect(target.calls).toEqual(["native:native-a"]);
		expect(target.registerConfigured).not.toHaveBeenCalled();
	});

	it("falls back to the config provider when native is undefined", () => {
		const target = recorder();
		inheritRegisteredProviders(sourceWith(["b"], { b: { config: "config-b" } }), target);
		expect(target.calls).toEqual(["config:b:config-b"]);
	});

	it("skips ids with neither native nor config", () => {
		const target = recorder();
		inheritRegisteredProviders(sourceWith(["c"], {}), target);
		expect(target.calls).toEqual([]);
	});

	it("registers in source order across mixed kinds", () => {
		const target = recorder();
		inheritRegisteredProviders(
			sourceWith(["first", "second", "third"], {
				first: { native: "n1" },
				second: { config: "c2" },
				third: { native: "n3", config: "c3" },
			}),
			target,
		);
		expect(target.calls).toEqual(["native:n1", "config:second:c2", "native:n3"]);
	});
});
