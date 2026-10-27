import { afterEach, describe, expect, it } from "vitest";
import { getSpawnService, publishSpawnService, unpublishSpawnService } from "../../shared/spawn-service.ts";

describe("spawn service registry", () => {
	afterEach(() => {
		unpublishSpawnService();
	});

	it("returns undefined when no service is published", () => {
		expect(getSpawnService()).toBeUndefined();
	});

	it("returns the published service", () => {
		const service = { listAgents: () => [] };
		publishSpawnService(service);
		expect(getSpawnService()).toBe(service);
	});

	it("keeps the first published service and ignores later ones", () => {
		const first = { listAgents: () => [] };
		const second = { listAgents: () => [] };
		publishSpawnService(first);
		publishSpawnService(second);
		expect(getSpawnService()).toBe(first);
	});

	it("removes the service on unpublish", () => {
		publishSpawnService({ listAgents: () => [] });
		unpublishSpawnService();
		expect(getSpawnService()).toBeUndefined();
	});

	it("allows publishing again after unpublish", () => {
		publishSpawnService({ listAgents: () => [] });
		unpublishSpawnService();
		const replacement = { listAgents: () => [] };
		publishSpawnService(replacement);
		expect(getSpawnService()).toBe(replacement);
	});
});
