import { describe, expect, it } from "vitest";
import type { PackageSource } from "@earendil-works/pi-coding-agent";
import { createExcludedPackagesStorage, withPackageExtensionsDisabled } from "../../../../extensions/tools/spawn/session/package-exclusions.ts";

type Settings = Parameters<typeof withPackageExtensionsDisabled>[0];

function settings(packages?: unknown): Settings {
	return { ...(packages === undefined ? {} : { packages }) } as Settings;
}

describe("withPackageExtensionsDisabled", () => {
	it("returns the settings unchanged when there is no packages key", () => {
		const input = settings();
		expect(withPackageExtensionsDisabled(input, new Set(["github.com/x"]))).toBe(input);
	});

	it("returns the settings unchanged when the excluded set is empty", () => {
		const input = settings(["github.com/x"]);
		expect(withPackageExtensionsDisabled(input, new Set())).toBe(input);
	});

	it("replaces a matching string package with an extensions-free object", () => {
		const result = withPackageExtensionsDisabled(
			settings(["github.com/x", "github.com/y"]),
			new Set(["github.com/x"]),
		);
		expect(result.packages).toEqual([
			{ source: "github.com/x", extensions: [] },
			"github.com/y",
		]);
	});

	it("empties extensions on a matching object package and keeps other fields", () => {
		const pkg = {
			source: "github.com/x",
			extensions: ["ext.ts"],
			path: "pkg",
		} as unknown as PackageSource;
		const result = withPackageExtensionsDisabled(settings([pkg]), new Set(["github.com/x"]));
		expect(result.packages).toEqual([{ source: "github.com/x", extensions: [], path: "pkg" }]);
	});

	it("leaves non-matching packages untouched", () => {
		const kept = "github.com/y";
		const pkgObj = { source: "github.com/z", extensions: ["e.ts"] } as unknown as PackageSource;
		const result = withPackageExtensionsDisabled(
			settings([kept, pkgObj]),
			new Set(["github.com/x"]),
		);
		expect(result.packages?.[0]).toBe(kept);
		expect(result.packages?.[1]).toBe(pkgObj);
	});
});

describe("createExcludedPackagesStorage", () => {
	it("serializes the filtered global settings under the global lock", () => {
		const globalSettings = settings(["github.com/x"]);
		const projectSettings = settings(["github.com/x"]);
		let captured: string | undefined;
		const storage = createExcludedPackagesStorage(
			{
				getGlobalSettings: () => globalSettings,
				getProjectSettings: () => projectSettings,
			},
			new Set(["github.com/x"]),
		);
		storage.withLock("global", (json) => {
			captured = json;
		});
		expect(JSON.parse(captured ?? "")).toEqual({ packages: [{ source: "github.com/x", extensions: [] }] });
	});

	it("serializes the filtered project settings under the project lock", () => {
		const globalSettings = settings();
		const projectSettings = settings(["github.com/x"]);
		let captured: string | undefined;
		const storage = createExcludedPackagesStorage(
			{
				getGlobalSettings: () => globalSettings,
				getProjectSettings: () => projectSettings,
			},
			new Set(["github.com/x"]),
		);
		storage.withLock("project", (json) => {
			captured = json;
		});
		expect(JSON.parse(captured ?? "")).toEqual({ packages: [{ source: "github.com/x", extensions: [] }] });
	});
});
