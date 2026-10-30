// @vitest-environment happy-dom
// tests/client/useEventSource.test.tsx
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { useEffect, useState } from "react";
import { useEventSource } from "../../src/lib/useEventSource";
import { renderWithRouter } from "./helpers/renderWithRouter";

interface Listener {
  event: string;
  handler: (data: unknown) => void;
}

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  url: string;
  readyState = 0;
  closed = false;
  listeners: Listener[] = [];
  onerror: ((ev: unknown) => void) | null = null;
  onmessage: ((ev: unknown) => void) | null = null;

  constructor(url: string) {
    this.url = url;
    FakeEventSource.instances.push(this);
  }

  addEventListener(event: string, handler: (ev: MessageEvent) => void): void {
    this.listeners.push({
      event,
      handler: (data: unknown) => handler({ data } as unknown as MessageEvent),
    });
  }

  removeEventListener(event: string, handler: (ev: MessageEvent) => void): void {
    this.listeners = this.listeners.filter(
      (l) => !(l.event === event && l.handler === handler),
    );
  }

  close(): void {
    this.closed = true;
    this.readyState = 2;
  }

  /** Test helper: dispatch a JSON-parsed event. */
  emit(event: string, data: unknown): void {
    for (const l of this.listeners) {
      if (l.event === event) l.handler(data);
    }
  }
}

describe("useEventSource", () => {
  let original: typeof globalThis.EventSource | undefined;
  beforeEach(() => {
    FakeEventSource.instances = [];
    original = (globalThis as { EventSource?: typeof globalThis.EventSource }).EventSource;
    (globalThis as { EventSource?: unknown }).EventSource = FakeEventSource as unknown as typeof globalThis.EventSource;
  });

  afterEach(() => {
    if (original) {
      (globalThis as { EventSource?: typeof globalThis.EventSource }).EventSource = original;
    } else {
      delete (globalThis as { EventSource?: typeof globalThis.EventSource }).EventSource;
    }
  });

  it("creates an EventSource when URL is provided", () => {
    function Test(): JSX.Element {
      useEventSource("/api/sessions/abc/stream");
      return null;
    }
    renderWithRouter(<Test />);
    expect(FakeEventSource.instances).toHaveLength(1);
    expect(FakeEventSource.instances[0].url).toBe("/api/sessions/abc/stream");
  });

  it("does not create an EventSource when URL is null", () => {
    function Test(): JSX.Element {
      useEventSource(null);
      return null;
    }
    renderWithRouter(<Test />);
    expect(FakeEventSource.instances).toHaveLength(0);
  });

  it("invokes the registered handler with parsed data", () => {
    const handler = vi.fn();

    function Test(): JSX.Element {
      const es = useEventSource("/api/sessions/abc/stream");
      useEffect(() => {
        es.on("entry", handler);
      }, [es]);
      return null;
    }
    renderWithRouter(<Test />);

    const instance = FakeEventSource.instances[0];
    expect(instance).toBeDefined();
    instance.emit("entry", { foo: "bar" });
    expect(handler).toHaveBeenCalledWith({ foo: "bar" });
  });

  it("invokes the ready handler with parsed data", () => {
    const handler = vi.fn();

    function Test(): JSX.Element {
      const es = useEventSource("/api/sessions/abc/stream");
      useEffect(() => {
        es.on("ready", handler);
      }, [es]);
      return null;
    }
    renderWithRouter(<Test />);

    const instance = FakeEventSource.instances[0];
    instance.emit("ready", { fromOffset: 42 });
    expect(handler).toHaveBeenCalledWith({ fromOffset: 42 });
  });

  it("falls back to string data when payload isn't JSON", () => {
    const handler = vi.fn();

    function Test(): JSX.Element {
      const es = useEventSource("/api/sessions/abc/stream");
      useEffect(() => {
        es.on("entry", handler);
      }, [es]);
      return null;
    }
    renderWithRouter(<Test />);
    const instance = FakeEventSource.instances[0];
    // Emit with an unparseable payload — listener should still be called.
    for (const l of instance.listeners) {
      if (l.event === "entry") {
        l.handler("not-json");
      }
    }
    expect(handler).toHaveBeenCalledWith("not-json");
  });

  it("closes the EventSource on unmount", () => {
    function Test(): JSX.Element {
      const [mounted, setMounted] = useState(true);
      useEventSource(mounted ? "/api/sessions/abc/stream" : null);
      useEffect(() => {
        // Unmount after first render.
        setMounted(false);
      }, []);
      return null;
    }
    renderWithRouter(<Test />);
    // After unmount, the originally-created instance should be closed.
    expect(FakeEventSource.instances.length).toBeGreaterThanOrEqual(1);
    const first = FakeEventSource.instances[0];
    expect(first.closed).toBe(true);
  });

  it("close() on the handle closes the underlying EventSource", () => {
    let captured: ReturnType<typeof useEventSource> | null = null;

    function Test(): JSX.Element {
      const es = useEventSource("/api/sessions/abc/stream");
      captured = es;
      return null;
    }
    renderWithRouter(<Test />);
    expect(captured).not.toBeNull();
    captured!.close();
    expect(FakeEventSource.instances[0].closed).toBe(true);
  });
});
