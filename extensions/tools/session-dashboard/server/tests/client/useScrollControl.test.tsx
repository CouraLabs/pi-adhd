// @vitest-environment happy-dom
// tests/client/useScrollControl.test.tsx
import { describe, expect, it } from "vitest";
import { useEffect, useRef } from "react";
import { useScrollControl } from "../../src/lib/useScrollControl";
import { renderWithRouter } from "./helpers/renderWithRouter";

interface ProbeState {
  api: ReturnType<typeof useScrollControl> | null;
}

function makeProbe() {
  const state: ProbeState = { api: null };
  function Probe({ hostRef }: { hostRef: React.RefObject<HTMLElement> }): JSX.Element {
    const api = useScrollControl(hostRef);
    // Assign on every render via a captured variable so we don't trigger re-renders.
    state.api = api;
    return null;
  }
  return { state, Probe };
}

describe("useScrollControl", () => {
  it("scrollToBottom sets scrollTop to scrollHeight", () => {
    const hostRef = document.createElement("div");
    Object.defineProperty(hostRef, "scrollHeight", { configurable: true, value: 1000 });
    Object.defineProperty(hostRef, "clientHeight", { configurable: true, value: 100 });
    hostRef.scrollTop = 0;

    const { state, Probe } = makeProbe();
    renderWithRouter(<Probe hostRef={{ current: hostRef }} />);

    expect(state.api).not.toBeNull();
    state.api!.scrollToBottom();
    expect(hostRef.scrollTop).toBe(1000);
  });

  it("isAtBottom returns true when at the bottom", () => {
    const hostRef = document.createElement("div");
    Object.defineProperty(hostRef, "scrollHeight", { configurable: true, value: 1000 });
    Object.defineProperty(hostRef, "clientHeight", { configurable: true, value: 100 });
    hostRef.scrollTop = 900; // distance = 1000 - 900 - 100 = 0 → at bottom

    const { state, Probe } = makeProbe();
    renderWithRouter(<Probe hostRef={{ current: hostRef }} />);
    expect(state.api!.isAtBottom()).toBe(true);
  });

  it("isAtBottom returns true at exactly 50px above bottom", () => {
    const hostRef = document.createElement("div");
    Object.defineProperty(hostRef, "scrollHeight", { configurable: true, value: 1000 });
    Object.defineProperty(hostRef, "clientHeight", { configurable: true, value: 100 });
    hostRef.scrollTop = 850; // distance = 1000 - 850 - 100 = 50 → within threshold

    const { state, Probe } = makeProbe();
    renderWithRouter(<Probe hostRef={{ current: hostRef }} />);
    expect(state.api!.isAtBottom()).toBe(true);
  });

  it("isAtBottom returns false when more than 50px from bottom", () => {
    const hostRef = document.createElement("div");
    Object.defineProperty(hostRef, "scrollHeight", { configurable: true, value: 1000 });
    Object.defineProperty(hostRef, "clientHeight", { configurable: true, value: 100 });
    hostRef.scrollTop = 0;

    const { state, Probe } = makeProbe();
    renderWithRouter(<Probe hostRef={{ current: hostRef }} />);
    expect(state.api!.isAtBottom()).toBe(false);
  });

  it("returns true for isAtBottom when ref is null", () => {
    const { state, Probe } = makeProbe();
    renderWithRouter(<Probe hostRef={{ current: null }} />);
    expect(state.api!.isAtBottom()).toBe(true);
  });

  it("fires onScroll callback when the host scrolls", () => {
    const hostRef = document.createElement("div");
    Object.defineProperty(hostRef, "scrollHeight", { configurable: true, value: 1000 });
    Object.defineProperty(hostRef, "clientHeight", { configurable: true, value: 100 });
    let fired = 0;
    let capturedApi: ReturnType<typeof useScrollControl> | null = null;

    function Listener(): JSX.Element {
      const ref = useRef<HTMLElement>(hostRef);
      const api = useScrollControl(ref);
      capturedApi = api;
      useEffect(() => {
        return api.onScroll(() => {
          fired++;
        });
      }, [api]);
      return null;
    }

    renderWithRouter(<Listener />);
    expect(capturedApi).not.toBeNull();

    hostRef.dispatchEvent(new Event("scroll"));
    expect(fired).toBeGreaterThanOrEqual(1);
  });
});
