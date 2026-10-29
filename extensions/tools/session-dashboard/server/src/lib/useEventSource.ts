// src/lib/useEventSource.ts
import { useEffect, useRef } from "react";

export interface EventSourceHandle {
  on: (event: string, handler: (data: unknown) => void) => void;
  close: () => void;
}

/**
 * Subscribes to an SSE URL for the lifetime of the component. Returns a
 * stable handle whose `on(event, handler)` registers listeners and `close()`
 * closes the underlying EventSource.
 *
 * Browsers automatically reconnect EventSource; we don't need to re-create
 * one in a retry loop. When the URL is null, the hook is a no-op.
 */
export function useEventSource(url: string | null): EventSourceHandle {
  const handleRef = useRef<EventSourceHandle | null>(null);
  const listenersRef = useRef<Map<string, Set<(data: unknown) => void>>>(
    new Map(),
  );

  // Keep stable wrapper functions that always read the latest listeners.
  const fire = (event: string, data: unknown): void => {
    const set = listenersRef.current.get(event);
    if (!set) return;
    for (const cb of set) {
      try {
        cb(data);
      } catch (err) {
        console.error(`[useEventSource] listener for "${event}" threw:`, err);
      }
    }
  };

  useEffect(() => {
    if (!url) {
      handleRef.current = null;
      return;
    }
    // EventSource is a browser global. Guard for SSR / non-browser test envs.
    if (typeof globalThis.EventSource === "undefined") return;

    const es = new globalThis.EventSource(url);

    // Re-attach any listeners that were registered before the source was
    // ready. (Common race: component sets up `on` synchronously before
    // the effect runs.)
    const attachAll = (): void => {
      for (const [event, handlers] of listenersRef.current) {
        for (const h of handlers) {
          es.addEventListener(event, (ev) => {
            try {
              const parsed = JSON.parse((ev as MessageEvent).data);
              fire(event, parsed);
            } catch {
              fire(event, (ev as MessageEvent).data);
            }
          });
        }
      }
    };

    // For events that arrive before attachAll is called (e.g. "ready" emitted
    // immediately by the server), register a fallback that lazily resolves.
    const knownEvents = new Set<string>();
    const wrapAndAdd = (event: string): void => {
      if (knownEvents.has(event)) return;
      knownEvents.add(event);
      es.addEventListener(event, (ev) => {
        let parsed: unknown = (ev as MessageEvent).data;
        try {
          parsed = JSON.parse((ev as MessageEvent).data);
        } catch {
          /* leave as string */
        }
        fire(event, parsed);
      });
    };

    // Wrap addEventListener so subsequent `on(...)` calls bind to the live ES.
    const origAdd = es.addEventListener.bind(es);

    handleRef.current = {
      on(event, handler) {
        let set = listenersRef.current.get(event);
        if (!set) {
          set = new Set();
          listenersRef.current.set(event, set);
          wrapAndAdd(event);
        }
        set.add(handler);
        // Already-attached listeners get the message via the wrapAndAdd wrapper.
      },
      close() {
        try {
          es.close();
        } catch {
          /* ignore */
        }
      },
    };

    // Attach any pre-registered listeners now that the source exists.
    attachAll();
    // Suppress unused warning (origAdd reserved for future advanced use).
    void origAdd;

    return () => {
      try {
        es.close();
      } catch {
        /* ignore */
      }
      handleRef.current = null;
    };
  }, [url]);

  // The returned handle stays stable across renders — it always reads from
  // the ref so latest `on`/`close` functions work.
  return {
    on(event, handler) {
      const h = handleRef.current;
      if (h) h.on(event, handler);
      else {
        // Pre-effect registration: store the listener so the effect picks it up.
        let set = listenersRef.current.get(event);
        if (!set) {
          set = new Set();
          listenersRef.current.set(event, set);
        }
        set.add(handler);
      }
    },
    close() {
      const h = handleRef.current;
      if (h) h.close();
    },
  };
}
