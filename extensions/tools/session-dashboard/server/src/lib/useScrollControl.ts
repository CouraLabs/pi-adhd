// src/lib/useScrollControl.ts
import { useCallback, useEffect, useMemo, useRef } from "react";

export interface ScrollControl {
  scrollToBottom: () => void;
  isAtBottom: () => boolean;
  /** Subscribe to scroll events; returns an unsubscribe function. */
  onScroll: (cb: () => void) => () => void;
}

/**
 * Hook that returns imperative scroll helpers for a container element.
 * Tracks the "at bottom" state and lets a parent know when the user scrolls
 * up so it can pause auto-scroll.
 */
export function useScrollControl(
  ref: React.RefObject<HTMLElement>,
): ScrollControl {
  const listenersRef = useRef<Set<() => void>>(new Set());

  const isAtBottom = useCallback((): boolean => {
    const el = ref.current;
    if (!el) return true;
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
    return distance <= 50;
  }, [ref]);

  const scrollToBottom = useCallback((): void => {
    const el = ref.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [ref]);

  const fire = useCallback((): void => {
    for (const cb of listenersRef.current) cb();
  }, []);

  const onScroll = useCallback((cb: () => void): (() => void) => {
    listenersRef.current.add(cb);
    return () => {
      listenersRef.current.delete(cb);
    };
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const handler = (): void => fire();
    el.addEventListener("scroll", handler, { passive: true });
    return () => {
      el.removeEventListener("scroll", handler);
    };
  }, [ref, fire]);

  return useMemo(
    () => ({ scrollToBottom, isAtBottom, onScroll }),
    [scrollToBottom, isAtBottom, onScroll],
  );
}
