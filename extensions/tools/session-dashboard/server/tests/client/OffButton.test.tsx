// @vitest-environment happy-dom
// tests/client/OffButton.test.tsx
//
// Verify the Off button: it renders in both views, calls POST /api/shutdown
// when clicked, and that the standalone `showShutdownScreen()` helper
// replaces the body with a "stopped" message.
//
// IMPORTANT: `showShutdownScreen()` does `document.body.innerHTML = ...`,
// which detaches the original `document.body` element. `@testing-library`
// caches `screen` queries against the body at module-import time, so
// queries against `screen` after the swap don't see newly-rendered
// components. To avoid this, we never let the click handler reach
// `showShutdownScreen` in the Off-button tests — we intercept the fetch
// and check it was called. `showShutdownScreen` has its own isolated
// test below.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { SessionListView } from "../../src/views/SessionListView";
import { SessionView } from "../../src/views/SessionView";
import { showShutdownScreen } from "../../src/lib/killDashboard";
import { renderWithRouter } from "./helpers/renderWithRouter";
import type { SessionDetail } from "../../src/types";
import type { Theme } from "../../src/lib/useTheme";

const listSessionsMock = vi.fn();
const listChildrenMock = vi.fn();
const getSessionMock = vi.fn();

vi.mock("../../src/api", async () => {
    const actual =
        await vi.importActual<typeof import("../../src/api")>("../../src/api");
    return {
        ...actual,
        listSessions: (...args: unknown[]) =>
            listSessionsMock(...args) as Promise<never[]>,
        listChildren: (...args: unknown[]) =>
            listChildrenMock(...args) as Promise<string[]>,
        getSession: (...args: unknown[]) =>
            getSessionMock(...args) as Promise<SessionDetail>,
    };
});

const theme: Theme = "dark";
const noTheme = (): void => {};

function fetchSpy(): ReturnType<typeof vi.fn> {
    // Default fetch returns 200 for /api/shutdown. The Off button tests
    // assert on this — the response is irrelevant; what matters is that
    // POST /api/shutdown was called.
    return vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ ok: true }), {
            status: 200,
            headers: { "content-type": "application/json" },
        }),
    );
}

beforeEach(() => {
    listSessionsMock.mockReset();
    listChildrenMock.mockReset();
    listChildrenMock.mockResolvedValue([]);
    getSessionMock.mockReset();
    vi.stubGlobal("fetch", fetchSpy());
});

afterEach(() => {
    // Reset the body so the next render starts clean. (RTL's `screen`
    // caches against the body at module-import time, but a fresh render
    // creates a new container div appended to `document.body`, so
    // queries against `screen` still find it as long as we don't swap
    // `document.body` itself. See file header.)
    cleanup();
    document.body.innerHTML = "";
    vi.unstubAllGlobals();
});

describe("Off button — SessionListView", () => {
    it("renders an Off button in the topbar", () => {
        listSessionsMock.mockResolvedValue([]);
        renderWithRouter(
            <SessionListView
                onNavigate={vi.fn()}
                theme={theme}
                onThemeChange={noTheme}
            />,
        );
        const btn = screen.getByRole("button", { name: /stop the dashboard server/i });
        expect(btn.textContent).toBe("Off");
    });

    it("POSTs /api/shutdown when clicked", () => {
        listSessionsMock.mockResolvedValue([]);
        renderWithRouter(
            <SessionListView
                onNavigate={vi.fn()}
                theme={theme}
                onThemeChange={noTheme}
            />,
        );
        const btn = screen.getByRole("button", { name: /stop the dashboard server/i });
        // Stub fetch with a never-resolving promise so the click
        // handler never reaches `showShutdownScreen`. We just want to
        // verify the POST was fired.
        vi.stubGlobal(
            "fetch",
            vi.fn().mockImplementation(
                () => new Promise<Response>(() => {
                    /* never resolves */
                }),
            ),
        );
        fireEvent.click(btn);
        expect(fetch).toHaveBeenCalledWith("/api/shutdown", { method: "POST" });
    });

    it("disables itself while the shutdown request is in flight", () => {
        listSessionsMock.mockResolvedValue([]);
        vi.stubGlobal(
            "fetch",
            vi.fn().mockImplementation(
                () => new Promise<Response>(() => {
                    /* never resolves */
                }),
            ),
        );
        renderWithRouter(
            <SessionListView
                onNavigate={vi.fn()}
                theme={theme}
                onThemeChange={noTheme}
            />,
        );
        const btn = screen.getByRole("button", { name: /stop the dashboard server/i });
        fireEvent.click(btn);
        expect(btn.disabled).toBe(true);
        expect(btn.textContent).toBe("Killing…");
    });
});

describe("Off button — SessionView", () => {
    const sessionDetail = (): SessionDetail => ({
        header: { id: "abc", timestamp: "2024-01-01T00:00:00.000Z", cwd: "/Users/test/proj" },
        branch: [
            {
                type: "message",
                id: "u-1",
                parentId: null,
                timestamp: "2024-01-01T00:00:00.000Z",
                message: { role: "user", content: [{ type: "text", text: "hi" }], timestamp: 0 },
            },
        ],
        totalEntries: 1,
    });

    it("renders an Off button even before the session loads", () => {
        // getSession hangs — topbar still mounts with the button.
        getSessionMock.mockReturnValue(new Promise(() => {}));
        renderWithRouter(
            <SessionView
                sessionId="abc"
                onBack={vi.fn()}
                onNavigate={vi.fn()}
                theme={theme}
                onThemeChange={noTheme}
            />,
        );
        expect(
            screen.getByRole("button", { name: /stop the dashboard server/i }),
        ).toBeTruthy();
    });

    it("renders an Off button alongside the cwd once loaded", async () => {
        getSessionMock.mockResolvedValue(sessionDetail());
        renderWithRouter(
            <SessionView
                sessionId="abc"
                onBack={vi.fn()}
                onNavigate={vi.fn()}
                theme={theme}
                onThemeChange={noTheme}
            />,
        );
        // The cwd renders split across <span> segments; match by class
        // instead of by text to avoid the "text broken up by multiple
        // elements" error from testing-library.
        await waitFor(() => {
            expect(document.querySelector(".top-bar-cwd")).toBeTruthy();
        });
        expect(
            screen.getByRole("button", { name: /stop the dashboard server/i }),
        ).toBeTruthy();
    });

    it("POSTs /api/shutdown when clicked", () => {
        getSessionMock.mockResolvedValue(sessionDetail());
        renderWithRouter(
            <SessionView
                sessionId="abc"
                onBack={vi.fn()}
                onNavigate={vi.fn()}
                theme={theme}
                onThemeChange={noTheme}
            />,
        );
        vi.stubGlobal(
            "fetch",
            vi.fn().mockImplementation(
                () => new Promise<Response>(() => {
                    /* never resolves */
                }),
            ),
        );
        const btn = screen.getByRole("button", { name: /stop the dashboard server/i });
        fireEvent.click(btn);
        expect(fetch).toHaveBeenCalledWith("/api/shutdown", { method: "POST" });
    });
});

describe("showShutdownScreen", () => {
    it("replaces document.body with a stopped message and tries to close the window", () => {
        // Stub window.close — happy-dom may not allow it.
        const closeSpy = vi.spyOn(window, "close").mockImplementation(() => undefined);
        // Stub document.title so we can verify it's set.
        const titleBefore = document.title;

        showShutdownScreen();

        expect(document.body.innerHTML).toContain("Dashboard stopped");
        expect(document.title).toBe("Session Dashboard — stopped");
        expect(closeSpy).toHaveBeenCalledTimes(1);

        // Restore for other tests in this file.
        closeSpy.mockRestore();
        document.title = titleBefore;
    });
});
