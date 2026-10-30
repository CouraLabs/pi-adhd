/**
 * Server-shutdown helper used by the topbar "Off" button.
 *
 * POSTs `/api/shutdown` (a server route that calls `server.close()` and
 * `closeAllConnections?.()`) and renders a minimal "stopped" screen so the
 * user has a clear way out even if `window.close()` is blocked by the
 * browser (tabs opened programmatically are usually not closeable).
 *
 * The fetch is best-effort: the server races to close the socket as soon
 * as it queues the 200 response, so the response often doesn't arrive.
 * We swallow network errors and proceed to the stopped screen regardless.
 *
 * Mirrors the task-manager pattern.
 */

const SHUTDOWN_ENDPOINT = "/api/shutdown";

/**
 * Replace the page contents with a minimal "Dashboard stopped" message
 * and try (best-effort) to close the tab.
 */
export function showShutdownScreen(): void {
    document.body.innerHTML = `
        <main class="container">
            <article>
                <header><h1>Dashboard stopped</h1></header>
                <p>The dashboard server has been shut down.</p>
                <p>Restart it from pi with <code>/session-dashboard</code>.</p>
                <p><small>You can close this tab.</small></p>
            </article>
        </main>
    `;
    document.title = "Session Dashboard — stopped";

    // Best-effort: most browsers no-op when the tab was opened from
    // another app (the extension). The message above is the fallback.
    try {
        window.close();
    } catch {
        /* ignore */
    }
}

/**
 * Fire the shutdown request and render the stopped screen. Returns a
 * promise that resolves once the response (or network error) is in;
 * the caller doesn't need to await it — UI state changes synchronously.
 *
 * Idempotent: if the button is disabled, no-ops.
 */
export async function killDashboard(button: HTMLButtonElement | null): Promise<void> {
    if (button && button.disabled) return;
    if (button) {
        button.disabled = true;
        const original = button.textContent ?? "Off";
        button.textContent = "Killing…";
        // Restore the label only if the screen hasn't already been
        // replaced by `showShutdownScreen()` — that wipes the body, so
        // the node may be detached. The guard avoids a no-op throw.
        queueMicrotask(() => {
            if (button.isConnected) button.textContent = original;
        });
    }

    // Best-effort POST. Swallow network errors: the server may race to
    // close the socket before the response arrives, which surfaces as a
    // fetch rejection rather than a successful 200.
    try {
        await fetch(SHUTDOWN_ENDPOINT, { method: "POST" });
    } catch {
        /* ignore */
    }

    showShutdownScreen();
}
