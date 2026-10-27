import { describe, expect, it, vi } from "vitest";
import { createGlobalStore } from "../../shared/store.ts";

describe("createGlobalStore", () => {
	it("returns the initial value from get", () => {
		const store = createGlobalStore(Symbol("store"), 7);
		expect(store.get()).toBe(7);
	});

	it("notifies subscribers with the new value on set", () => {
		const store = createGlobalStore(Symbol("store"), "a");
		const listener = vi.fn();
		store.subscribe(listener);
		store.set("b");
		expect(listener).toHaveBeenCalledTimes(1);
		expect(listener).toHaveBeenCalledWith("b");
		expect(store.get()).toBe("b");
	});

	it("notifies every subscriber in insertion order", () => {
		const store = createGlobalStore(Symbol("store"), 0);
		const calls: string[] = [];
		store.subscribe((value) => calls.push(`first:${value}`));
		store.subscribe((value) => calls.push(`second:${value}`));
		store.set(1);
		expect(calls).toEqual(["first:1", "second:1"]);
	});

	it("skips set entirely when the value is identical via Object.is", () => {
		const store = createGlobalStore(Symbol("store"), "same");
		const listener = vi.fn();
		store.subscribe(listener);
		store.set("same");
		expect(listener).not.toHaveBeenCalled();
		expect(store.get()).toBe("same");
	});

	it("treats NaN as identical to itself via Object.is", () => {
		const store = createGlobalStore(Symbol("store"), Number.NaN);
		const listener = vi.fn();
		store.subscribe(listener);
		store.set(Number.NaN);
		expect(listener).not.toHaveBeenCalled();
		expect(store.get()).toBeNaN();
	});

	it("stops notifying after unsubscribe", () => {
		const store = createGlobalStore(Symbol("store"), 1);
		const listener = vi.fn();
		const unsubscribe = store.subscribe(listener);
		store.set(2);
		unsubscribe();
		store.set(3);
		expect(listener).toHaveBeenCalledTimes(1);
		expect(listener).toHaveBeenCalledWith(2);
	});

	it("shares state between stores created with the same symbol key", () => {
		const key = Symbol("shared");
		const first = createGlobalStore(key, "a");
		const second = createGlobalStore(key, "b");
		expect(first.get()).toBe("a");
		expect(second.get()).toBe("a");
	});

	it("propagates a set from one store to subscribers of the other store on the same key", () => {
		const key = Symbol("shared");
		const first = createGlobalStore(key, 1);
		const second = createGlobalStore(key, 1);
		const listener = vi.fn();
		first.subscribe(listener);
		second.set(2);
		expect(listener).toHaveBeenCalledWith(2);
		expect(first.get()).toBe(2);
		expect(second.get()).toBe(2);
	});

	it("does not share state between stores with different symbol keys", () => {
		const first = createGlobalStore(Symbol("one"), "x");
		const second = createGlobalStore(Symbol("two"), "y");
		first.set("z");
		expect(second.get()).toBe("y");
	});
});
