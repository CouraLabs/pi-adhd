import { afterEach, describe, expect, it, vi } from "vitest";
import {
	getFooterSections,
	registerFooterSection,
	subscribeFooterSections,
	type FooterSection,
} from "../../shared/footer-sections.ts";

function section(id: string, line = id): FooterSection {
	return {
		id,
		render: () => [line],
	};
}

const unregisterFns: Array<() => void> = [];

function register(sectionToRegister: FooterSection): () => void {
	const unregister = registerFooterSection(sectionToRegister);
	unregisterFns.push(unregister);
	return unregister;
}

describe("footer sections", () => {
	afterEach(() => {
		while (unregisterFns.length > 0) unregisterFns.pop()?.();
	});

	it("returns an empty list when nothing is registered", () => {
		expect(getFooterSections()).toEqual([]);
	});

	it("appends later registrations in order", () => {
		register(section("a"));
		register(section("b"));
		register(section("c"));
		expect(getFooterSections().map((s) => s.id)).toEqual(["a", "b", "c"]);
	});

	it("replaces a registration with the same id", () => {
		register(section("a", "first"));
		register(section("a", "second"));
		expect(getFooterSections()).toHaveLength(1);
		expect(getFooterSections()[0].render({} as never)).toEqual(["second"]);
	});

	it("moves a re-registered id to the end", () => {
		register(section("a"));
		register(section("b"));
		register(section("a", "a2"));
		expect(getFooterSections().map((s) => s.id)).toEqual(["b", "a"]);
	});

	it("returns an unsubscribe that removes the section", () => {
		const unregister = register(section("a"));
		unregister();
		expect(getFooterSections()).toHaveLength(0);
	});

	it("keeps other sections when one unsubscribes", () => {
		register(section("a"));
		const unregisterB = register(section("b"));
		unregisterB();
		expect(getFooterSections().map((s) => s.id)).toEqual(["a"]);
	});

	it("notifies subscribers when sections change", () => {
		const listener = vi.fn();
		const unsubscribe = subscribeFooterSections(listener);
		register(section("a"));
		expect(listener).toHaveBeenCalledTimes(1);
		unsubscribe();
		register(section("b"));
		expect(listener).toHaveBeenCalledTimes(1);
	});
});
