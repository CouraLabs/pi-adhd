// Task Dashboard frontend — vanilla JS module.
// Fetches from the local Node HTTP server on the same origin it was
// loaded from, so the port follows whatever the server actually bound
// to (default 7254, or `TASK_DASHBOARD_PORT` if set).

const API_BASE = window.location.origin;

/** Currently-selected workspace id. "all" is the synthetic union view. */
let currentWorkspace = "all";

/** Real workspace list (from GET /api/workspaces, minus the "all" entry). */
let workspacesList = [];

/** Modal mode: "view" (rendered markdown) | "edit" (form) | "create" (form). */
let modalMode = "view";

/** Task being edited: { workspace, lane, filename, data } — data is the fetched task payload. */
let editingTask = null;

/** Drag-and-drop state. */
let draggedCard = null;      // The .task-card DOM element being dragged.
let draggedTask = null;      // { workspace, lane, filename } of the dragged card.
let isDragging = false;      // Suppresses the click-after-drag event.
let laneExistsMap = null;    // Map<workspace, Set<laneName>> from the last "all" payload.

/** Current search query (raw input value, untrimmed). */
let searchQuery = "";
/** Pending debounce timer id; null when no timer is scheduled. */
let searchDebounceTimer = null;
/** Debounce delay in ms. */
const SEARCH_DEBOUNCE_MS = 1000;

/** Cached DOM references. */
const els = {
    banner: document.getElementById("server-banner"),
    select: document.getElementById("workspace-select"),
    searchInput: document.getElementById("search-input"),
    searchStatus: document.getElementById("search-status"),
    newTaskBtn: document.getElementById("new-task-btn"),
    refreshBtn: document.getElementById("refresh-btn"),
    killBtn: document.getElementById("kill-btn"),
    emptyState: document.getElementById("empty-state"),
    lanesContainer: document.getElementById("lanes-container"),
    taskModal: document.getElementById("task-modal"),
    modalClose: document.getElementById("modal-close"),
    modalTitle: document.getElementById("modal-title"),
    modalMeta: document.getElementById("modal-meta"),
    modalView: document.getElementById("modal-view"),
    modalViewBody: document.getElementById("modal-view-body"),
    modalViewClose: document.getElementById("modal-view-close"),
    modalEditBtn: document.getElementById("modal-edit-btn"),
    taskForm: document.getElementById("task-form"),
    fieldTitle: document.getElementById("field-title"),
    fieldPriority: document.getElementById("field-priority"),
    fieldTags: document.getElementById("field-tags"),
    fieldWorkspace: document.getElementById("field-workspace"),
    fieldLane: document.getElementById("field-lane"),
    fieldBody: document.getElementById("field-body"),
    createFields: document.getElementById("create-fields"),
    modalError: document.getElementById("modal-error"),
    modalCancel: document.getElementById("modal-cancel"),
    modalSave: document.getElementById("modal-save"),
};

/* ---------- Lane collapse state ---------- */
const COLLAPSED_STORAGE_KEY = "taskDashboard.collapsedLanes.v1";
const DEFAULT_COLLAPSED_LANES = ["Closed"];

/** Map<workspaceId, Set<laneName>>. Module-level so it survives re-renders. */
let collapsedByWorkspace = new Map();

/** Read persisted state from localStorage. Safe if storage is unavailable. */
function loadCollapsed() {
    try {
        const raw = localStorage.getItem(COLLAPSED_STORAGE_KEY);
        if (!raw) return;
        const obj = JSON.parse(raw);
        if (obj && typeof obj === "object") {
            for (const [ws, lanes] of Object.entries(obj)) {
                if (Array.isArray(lanes)) {
                    collapsedByWorkspace.set(ws, new Set(lanes));
                }
            }
        }
    } catch { /* corrupt JSON or storage disabled — start fresh */ }
}

/** Write current state to localStorage. Best-effort. */
function persistCollapsed() {
    try {
        const obj = {};
        for (const [ws, set] of collapsedByWorkspace) {
            obj[ws] = Array.from(set);
        }
        localStorage.setItem(COLLAPSED_STORAGE_KEY, JSON.stringify(obj));
    } catch { /* quota / disabled — ignore, in-memory still works */ }
}

/** Reflect the collapsed state on a lane DOM node. */
function applyCollapseToLane(laneEl, collapsed) {
    laneEl.classList.toggle("collapsed", collapsed);
    const header = laneEl.querySelector(".lane-header");
    if (header) header.setAttribute("aria-expanded", String(!collapsed));
}

/** Toggle collapse state for a lane in the current workspace, persist,
 *  and reflect in the DOM. */
function toggleLaneCollapse(laneName) {
    let set = collapsedByWorkspace.get(currentWorkspace);
    if (!set) {
        set = new Set();
        collapsedByWorkspace.set(currentWorkspace, set);
    }
    if (set.has(laneName)) set.delete(laneName);
    else set.add(laneName);
    persistCollapsed();
    const lane = els.lanesContainer.querySelector(
        `.lane[data-lane="${CSS.escape(laneName)}"]`,
    );
    if (lane) applyCollapseToLane(lane, set.has(laneName));
}

/* ---------- Utilities ---------- */

/** Escape user-derived strings before inserting via innerHTML. */
function escapeHtml(s) {
    if (s === null || s === undefined) return "";
    return String(s)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

/** Show or hide the server-unreachable banner. */
function showBanner(show) {
    els.banner.hidden = !show;
}

/** Generic JSON fetcher that throws on non-2xx. */
async function fetchJson(path) {
    const res = await fetch(API_BASE + path, { headers: { Accept: "application/json" } });
    if (!res.ok) {
        let message = `Request failed (${res.status})`;
        try {
            const body = await res.json();
            if (body && typeof body.error === "string") message = body.error;
        } catch {
            /* swallow */
        }
        throw new Error(message);
    }
    return res.json();
}

/** Fire-and-forget POST. Used by the Kill button. Swallows network errors
 *  because the server is going away during/after this request. */
async function postJson(path) {
    try {
        await fetch(API_BASE + path, {
            method: "POST",
            headers: { Accept: "application/json" },
        });
    } catch {
        /* server is shutting down — ignore */
    }
}

/** POST/PUT JSON-body helper used by the create/edit save handlers. */
async function sendJson(method, path, payload) {
    const res = await fetch(API_BASE + path, {
        method,
        headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
    });
    let data = null;
    try {
        data = await res.json();
    } catch {
        /* no body */
    }
    if (!res.ok) {
        const message = data && typeof data.error === "string"
            ? data.error
            : `Request failed (${res.status})`;
        throw new Error(message);
    }
    return data;
}

/* ---------- Renderers ---------- */

/** Render a priority pill. Falls back to `priority-unknown` for invalid values. */
function renderPriorityBadge(priority) {
    const safe = priority || "unknown";
    const klass = ["critical", "high", "medium", "low"].includes(priority)
        ? `priority-${safe}`
        : "priority-unknown";
    const span = document.createElement("span");
    span.className = `priority-badge ${klass}`;
    span.textContent = safe;
    return span;
}

/** Render a single tag pill. */
function renderTag(tag) {
    const span = document.createElement("span");
    span.className = "tag-pill";
    span.textContent = tag;
    return span;
}

/** Render the tag row as a <div class="task-tags">. Returns null when tags are missing or empty. */
function renderTags(tags) {
    if (!Array.isArray(tags) || tags.length === 0) return null;
    const div = document.createElement("div");
    div.className = "task-tags";
    for (const tag of tags) div.appendChild(renderTag(tag));
    return div;
}

/** Render one task card as a DOM element. */
function renderCard(task, opts) {
    const card = document.createElement("div");
    card.className = "task-card";
    card.draggable = true;
    card.dataset.workspace = task.workspace || "";
    card.dataset.lane = task.lane || "";
    card.dataset.filename = task.filename || "";

    if (opts.showWorkspaceBadge && task.workspace) {
        const badge = document.createElement("span");
        badge.className = "workspace-badge";
        badge.title = task.workspace;
        badge.textContent = task.workspace;
        card.appendChild(badge);
    }

    const title = document.createElement("div");
    title.className = "task-title";
    title.textContent = task.title || task.filename || "(untitled)";
    card.appendChild(title);

    const meta = document.createElement("div");
    meta.appendChild(renderPriorityBadge(task.priority));
    const created = document.createElement("span");
    created.className = "task-created";
    created.textContent = task.created || "";
    meta.appendChild(created);
    card.appendChild(meta);

    const tags = renderTags(task.tags);
    if (tags) card.appendChild(tags);

    // Attach the task so the search filter can read priority/tags/created later.
    card.__task = task;
    return card;
}

/** Render a single lane as a <section> DOM element. */
function renderLane(lane, opts) {
    const section = document.createElement("section");
    section.className = "lane";
    section.dataset.lane = lane.name;

    const header = document.createElement("div");
    header.className = "lane-header";
    header.setAttribute("role", "button");
    header.setAttribute("tabindex", "0");
    header.setAttribute("aria-expanded", "true");
    const name = document.createElement("span");
    name.textContent = lane.name;
    const counter = document.createElement("small");
    counter.textContent = `(${lane.tasks.length})`;
    header.appendChild(name);
    header.appendChild(counter);
    section.appendChild(header);

    for (const task of lane.tasks) {
        section.appendChild(renderCard(task, opts));
    }
    return section;
}

/* ---------- Search filter ---------- */

/** Update the input placeholder based on the selected workspace. */
function updateSearchPlaceholder() {
    if (!els.searchInput) return;
    els.searchInput.placeholder = currentWorkspace === "all"
        ? "Search tasks across all projects…"
        : "Search tasks in this workspace…";
}

/** Schedule the filter to run after SEARCH_DEBOUNCE_MS, replacing any pending run. */
function scheduleSearch(value) {
    searchQuery = value;
    if (searchDebounceTimer !== null) {
        clearTimeout(searchDebounceTimer);
    }
    searchDebounceTimer = setTimeout(() => {
        searchDebounceTimer = null;
        applyFilter();
    }, SEARCH_DEBOUNCE_MS);
}

/** True when the task matches the user's query (case-insensitive substring). */
function taskMatchesQuery(task, query) {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    const haystack = [
        task.title || "",
        task.filename || "",
        task.priority || "",
        task.created || "",
        task.uuid || "",
        Array.isArray(task.tags) ? task.tags.join(" ") : "",
        task.body || "",
    ].join(" ").toLowerCase();
    return haystack.includes(q);
}

/**
 * Apply the current searchQuery to currently-rendered cards. Hides non-matching
 * cards via display: none so the existing handlers and DOM stay intact.
 * Updates each lane's "(N)" counter and the search-status indicator. When the
 * query is set and nothing matches, shows a search-specific empty-state.
 */
function applyFilter() {
    const trimmed = searchQuery.trim();
    const lanes = els.lanesContainer.querySelectorAll(".lane");
    let visibleTotal = 0;
    let allTotal = 0;

    for (const lane of lanes) {
        const cards = lane.querySelectorAll(".task-card");
        let visibleInLane = 0;
        for (const card of cards) {
            allTotal++;
            const task = card.__task;
            if (!task || taskMatchesQuery(task, searchQuery)) {
                card.style.display = "";
                visibleInLane++;
                visibleTotal++;
            } else {
                card.style.display = "none";
            }
        }
        const counter = lane.querySelector(".lane-header small");
        if (counter) counter.textContent = `(${visibleInLane})`;
    }

    if (trimmed) {
        els.searchStatus.hidden = false;
        els.searchStatus.textContent = `${visibleTotal} / ${allTotal} matches`;
    } else {
        els.searchStatus.hidden = true;
        els.searchStatus.textContent = "";
    }

    if (trimmed && allTotal > 0 && visibleTotal === 0) {
        els.emptyState.hidden = false;
        els.emptyState.innerHTML =
            `No tasks match <code>${escapeHtml(trimmed)}</code> in this view.`;
    } else if (allTotal > 0 && visibleTotal > 0) {
        els.emptyState.hidden = true;
    }
}

/* ---------- Data loading ---------- */

/** GET /api/health. Returns true on success, false otherwise. */
async function checkHealth() {
    try {
        await fetchJson("/api/health");
        showBanner(false);
        return true;
    } catch {
        showBanner(true);
        return false;
    }
}

/** GET /api/workspaces — populate the <select>. */
async function loadWorkspaces() {
    let workspaces;
    try {
        const body = await fetchJson("/api/workspaces");
        workspaces = body.workspaces || [];
    } catch {
        workspaces = [];
    }

    // Remember the real (non-"all") workspaces for the create modal.
    workspacesList = workspaces.filter(w => w.id !== "all");

    // Rebuild options.
    els.select.innerHTML = "";
    for (const ws of workspaces) {
        const opt = document.createElement("option");
        opt.value = ws.id;
        const countSuffix = ws.id === "all" ? "" : ` (${ws.taskCount})`;
        opt.textContent = `${ws.name}${countSuffix}`;
        els.select.appendChild(opt);
    }

    // If the previously-selected workspace is no longer present, fall back
    // to "all".
    const ids = new Set(workspaces.map(w => w.id));
    if (!ids.has(currentWorkspace)) {
        currentWorkspace = "all";
    }
    if (els.select.value !== currentWorkspace) {
        els.select.value = currentWorkspace;
    }

    // Creating a task requires at least one real workspace.
    els.newTaskBtn.disabled = workspacesList.length === 0;
    els.newTaskBtn.title = workspacesList.length === 0
        ? "No workspaces available — create a task in pi first"
        : "Create a new task";
}

/** GET /api/workspaces/:id — render lanes + cards. */
async function loadLanes(workspaceId) {
    try {
        const body = await fetchJson(
            `/api/workspaces/${encodeURIComponent(workspaceId)}`,
        );
        const lanes = body.lanes || [];
        // In "all" view each task carries its workspace, so we can compute
        // which lanes exist per workspace for drop validation.
        if (workspaceId === "all") computeLaneExistence(lanes);
        renderLanes(lanes, workspaceId);
    } catch (err) {
        // Render an empty board with the error message.
        renderLanes([], workspaceId);
        els.emptyState.hidden = false;
        els.emptyState.textContent = err && err.message
            ? `Error: ${err.message}`
            : "Failed to load lanes.";
    }
}

/**
 * Build laneExistsMap from a /api/workspaces/all payload: which lane names
 * exist for each workspace. A lane is recorded for a workspace when that
 * workspace has at least one task in it (tasks carry .workspace).
 */
function computeLaneExistence(lanes) {
    const map = new Map();
    for (const lane of lanes) {
        if (!Array.isArray(lane.tasks)) continue;
        for (const task of lane.tasks) {
            if (!task || !task.workspace || !lane.name) continue;
            if (!map.has(task.workspace)) map.set(task.workspace, new Set());
            map.get(task.workspace).add(lane.name);
        }
    }
    laneExistsMap = map;
}

/**
 * Whether a card may be dropped into a lane. In per-workspace views every
 * rendered lane exists for that workspace by construction. In "all" view we
 * check the card's own workspace against laneExistsMap. A card is always
 * valid in its own lane.
 */
function laneExistsForCard(card, laneName) {
    if (laneName === card.dataset.lane) return true;
    if (currentWorkspace === "all") {
        const ws = card.dataset.workspace;
        return !!(laneExistsMap && laneExistsMap.has(ws) && laneExistsMap.get(ws).has(laneName));
    }
    return true;
}

/** Render the lanes into the DOM. Toggles the empty state.
 *
 *  The empty-state banner is shown only when there are no lanes at all
 *  (no status folders exist). Lanes that exist but are empty render as
 *  columns with a "(0)" header — they're visible on purpose, so the user
 *  can drop new cards into them. */
function renderLanes(lanes, workspaceId) {
    const showWorkspaceBadge = workspaceId === "all";

    if (lanes.length === 0) {
        els.emptyState.hidden = false;
        // Restore the default message if we hadn't overwritten it with an error.
        if (!els.emptyState.querySelector("code")) {
            els.emptyState.innerHTML =
                'No tasks yet &mdash; create one with <code>/task-create</code> in pi or the <strong>New Task</strong> button.';
        }
        els.lanesContainer.innerHTML = "";
        return;
    }

    els.emptyState.hidden = true;
    els.lanesContainer.innerHTML = "";
    for (const lane of lanes) {
        els.lanesContainer.appendChild(renderLane(lane, { showWorkspaceBadge }));
    }

    // Re-apply persisted collapse state to each lane after every render.
    // This covers: initial load, workspace switch, drag-move, save.
    for (const section of els.lanesContainer.querySelectorAll(".lane")) {
        const name = section.dataset.lane;
        const stored = collapsedByWorkspace.get(currentWorkspace);
        const isCollapsed =
            (stored ? stored.has(name) : DEFAULT_COLLAPSED_LANES.includes(name));
        applyCollapseToLane(section, isCollapsed);
    }
}

/* ---------- Drag-and-drop move ---------- */

/**
 * True while the last dragover on a lane was rejected (lane does not exist
 * for the dragged card's workspace). Consumed by `dragend` to surface the
 * rejection as a toast — the `drop` event never fires on invalid lanes
 * (dragover deliberately skips preventDefault), so the toast must be shown
 * from dragend instead.
 */
let lastDropRejected = false;

/** POST the move, then refresh workspaces + lanes. */
async function performMove(task, targetLane) {
    try {
        await sendJson(
            "POST",
            `/api/tasks/${encodeURIComponent(task.workspace)}/${encodeURIComponent(task.lane)}/${encodeURIComponent(task.filename)}/move`,
            { lane: targetLane },
        );
        await loadWorkspaces();
        await loadLanes(currentWorkspace);
    } catch (err) {
        showDropError(err && err.message ? err.message : "Failed to move task.");
        // Re-load to restore the pre-drop state (source lane card comes back).
        await loadLanes(currentWorkspace);
    }
}

/** Show a transient, non-modal error toast for a failed/rejected drop. */
function showDropError(message) {
    const el = document.createElement("div");
    el.className = "drop-error";
    el.textContent = "Move failed: " + message;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 4000);
}

/**
 * Reset all drag state. `reportRejection` shows the rejection toast first
 * (used by dragend when the last dragover was rejected — the drop event
 * never fired, so the user would otherwise see only the red lane highlight
 * and no message).
 */
function clearDragState(reportRejection) {
    if (reportRejection && lastDropRejected) {
        showDropError(`Cannot move to that lane — it does not exist for this workspace.`);
    }
    lastDropRejected = false;
    if (draggedCard) draggedCard.classList.remove("dragging");
    draggedCard = null;
    draggedTask = null;
    // Clear isDragging on the next tick so the click event that browsers may
    // fire at the end of a drag gesture is still suppressed this tick.
    setTimeout(() => {
        isDragging = false;
    }, 0);
    document.querySelectorAll(".lane.drag-over, .lane.drag-rejected").forEach(lane => {
        lane.classList.remove("drag-over", "drag-rejected");
    });
}

/* ---------- Kill (server shutdown) ---------- */

/**
 * Replace the page contents with a "Dashboard stopped" message and try
 * (best-effort) to close the tab. Called from `killDashboard()` after the
 * shutdown request fires, regardless of whether the response came back.
 */
function showShutdownScreen() {
    // Clear the body and render a minimal "stopped" screen. Pico's
    // container class keeps the layout consistent with the live UI.
    document.body.innerHTML = `
        <main class="container-fluid">
            <article>
                <header><h1>Dashboard stopped</h1></header>
                <p>The dashboard server has been shut down.</p>
                <p>Restart it from pi with <code>/couralabs:task-dashboard</code>.</p>
                <p><small>You can close this tab.</small></p>
            </article>
        </main>
    `;
    document.title = "Task Dashboard — stopped";

    // Best-effort tab close. Most browsers will silently no-op when a
    // tab was opened from a bookmark, typed URL, or another app — that's
    // fine; the message above gives the user a clear way out.
    try {
        window.close();
    } catch {
        /* ignore */
    }
}

/**
 * Kill button handler. Disables the button to prevent double-clicks, fires
 * the shutdown request, and renders the "stopped" screen whether or not
 * the response came back (the server might race to close the socket).
 */
async function killDashboard() {
    if (!els.killBtn) return;
    els.killBtn.disabled = true;
    els.killBtn.textContent = "Killing…";
    // Kick off the shutdown, then immediately render the stopped screen.
    // The POST is best-effort: if the socket closes before the response
    // arrives (likely), the fetch rejects and `postJson` swallows it.
    await postJson("/api/shutdown");
    showShutdownScreen();
}

/* ---------- Task modal (create / edit) ---------- */

/** Today's date as YYYY-MM-DD (local time). */
function today() {
    const d = new Date();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${d.getFullYear()}-${m}-${day}`;
}

/** Parse a comma-separated tags string into a trimmed array. */
function parseTags(value) {
    return String(value || "")
        .split(",")
        .map(t => t.trim())
        .filter(Boolean);
}

/** Show an error message inside the modal. */
function showModalError(message) {
    els.modalError.textContent = message || "Unknown error.";
    els.modalError.hidden = false;
}

/** Clear the modal error. */
function clearModalError() {
    els.modalError.hidden = true;
    els.modalError.textContent = "";
}

/** Populate the create-mode workspace select. */
function populateWorkspaceSelect() {
    els.fieldWorkspace.innerHTML = "";
    for (const ws of workspacesList) {
        const opt = document.createElement("option");
        opt.value = ws.id;
        opt.textContent = ws.name;
        els.fieldWorkspace.appendChild(opt);
    }
    // Default to the currently-selected real workspace, else the first one.
    const defaultWs = workspacesList.some(w => w.id === currentWorkspace)
        ? currentWorkspace
        : (workspacesList[0] && workspacesList[0].id);
    if (defaultWs) els.fieldWorkspace.value = defaultWs;
}

/** Switch the modal to view mode (rendered markdown) using editingTask.data. */
function showViewMode() {
    modalMode = "view";
    renderViewMode();
    els.modalView.hidden = false;
    els.taskForm.hidden = true;
}

/** Render the view mode (title, meta, rendered markdown body) from editingTask.data. */
function renderViewMode() {
    const data = editingTask.data;
    const fm = data.frontmatter || {};

    els.modalTitle.textContent = fm.title || data.filename || "(untitled)";

    // Build the meta line with DOM elements — renderPriorityBadge and
    // renderTags return Elements now.
    const meta = document.createElement("div");

    const line1 = document.createElement("div");
    line1.appendChild(renderPriorityBadge(fm.priority));
    const created = document.createElement("span");
    created.textContent = fm.created || "";
    line1.appendChild(created);
    meta.appendChild(line1);

    const line2 = document.createElement("div");
    line2.textContent = `${data.workspace} / ${data.lane}`;
    meta.appendChild(line2);

    const tags = renderTags(fm.tags);
    if (tags) meta.appendChild(tags);
    const idHtml = renderIdChip(fm.id);
    if (idHtml) {
        const wrap = document.createElement("div");
        wrap.innerHTML = idHtml;
        meta.appendChild(wrap.firstChild);
    }

    els.modalMeta.innerHTML = "";
    els.modalMeta.appendChild(meta);

    // bodyHtml is sanitized server-side by DOMPurify; insert directly.
    els.modalViewBody.innerHTML = data.bodyHtml || "";
}

/**
 * Render the task id as a click-to-copy chip. The button text is the id
 * itself (already short enough to fit), and the visual style is set in
 * styles.css under `.copy-id-btn`. Returns an empty string when no id is
 * available so the caller can always include the snippet unconditionally.
 */
function renderIdChip(id) {
    if (!id) return "";
    return `<button type="button" class="copy-id-btn" title="Copy id to clipboard" data-id="${escapeHtml(id)}">${escapeHtml(id)}</button>`;
}

/** Open the modal in create mode with the header-style template pre-filled. */
function openNewTaskModal() {
    modalMode = "create";
    editingTask = null;

    els.modalTitle.textContent = "New Task";
    els.modalMeta.innerHTML = `<span>Created: ${escapeHtml(today())}</span>`;

    els.fieldTitle.value = "";
    els.fieldPriority.value = "medium";
    els.fieldTags.value = "";
    // Pre-populated with the header style (H1 + Notes section) and the
    // created date shown in the meta line above.
    els.fieldBody.value = "# Title\n\n## Notes\n";

    // Create-only fields: workspace + lane selects.
    els.createFields.hidden = false;
    populateWorkspaceSelect();
    els.fieldLane.value = "Backlog";

    els.modalView.hidden = true;
    els.taskForm.hidden = false;
    clearModalError();
    els.taskModal.showModal();
    els.fieldTitle.focus();
}

/** Open the task in view mode (rendered markdown). Clicking Edit turns it into a form. */
async function openTaskModal(workspace, lane, filename) {
    try {
        const body = await fetchJson(
            `/api/tasks/${encodeURIComponent(workspace)}/${encodeURIComponent(lane)}/${encodeURIComponent(filename)}`,
        );

        editingTask = { workspace, lane, filename, data: body };
        showViewMode();
        clearModalError();
        els.taskModal.showModal();
    } catch (err) {
        els.modalTitle.textContent = "Failed to load task";
        els.modalMeta.innerHTML = "";
        els.modalView.hidden = false;
        els.taskForm.hidden = true;
        els.modalViewBody.textContent = err && err.message ? err.message : "Unknown error.";
        els.taskModal.showModal();
    }
}

/** Switch the open task from view mode to the editable form. */
function enterEditMode() {
    const data = editingTask.data;
    const fm = data.frontmatter || {};

    modalMode = "edit";
    els.modalTitle.textContent = "Edit Task";
    els.modalMeta.innerHTML = `
        <span>${escapeHtml(fm.created || "")}</span>
        <span>${escapeHtml(data.workspace)} / ${escapeHtml(data.lane)}</span>
        ${renderIdChip(fm.id)}
    `;

    els.fieldTitle.value = fm.title || "";
    els.fieldPriority.value = fm.priority || "medium";
    els.fieldTags.value = Array.isArray(fm.tags) ? fm.tags.join(", ") : "";
    // The API's `body` may carry a leading newline from the frontmatter
    // separator; strip it so the textarea starts clean.
    els.fieldBody.value = String(data.body || "").replace(/^\n+/, "");

    // Create-only fields hidden in edit mode (location is read-only meta).
    els.createFields.hidden = true;
    els.modalView.hidden = true;
    els.taskForm.hidden = false;
    clearModalError();
    els.fieldTitle.focus();
}

/** Serialize the current form state into an API payload. */
function collectFormPayload() {
    const title = els.fieldTitle.value.trim();
    let body = els.fieldBody.value;
    // On create, the body is pre-filled with the `# Title` header-style
    // placeholder; swap in the real title if the placeholder is untouched.
    // The `m` flag makes `^`/`$` match line boundaries, so only the first
    // line (the placeholder heading) is replaced — the rest of the body
    // (e.g. `## Notes`) is left alone.
    if (modalMode === "create" && title && body.split("\n")[0] === "# Title") {
        body = body.replace(/^# Title\s*$/m, `# ${title}`);
    }
    return {
        title,
        priority: els.fieldPriority.value,
        tags: parseTags(els.fieldTags.value),
        body,
    };
}

/** Save the task: POST (create) or PUT (edit). */
async function saveTask() {
    const title = els.fieldTitle.value.trim();
    if (!title) {
        showModalError("Title is required.");
        return;
    }

    const payload = collectFormPayload();
    els.modalSave.disabled = true;
    els.modalSave.textContent = "Saving…";
    clearModalError();

    try {
        if (modalMode === "create") {
            const workspace = els.fieldWorkspace.value;
            const lane = els.fieldLane.value;
            await sendJson("POST", "/api/tasks", { ...payload, workspace, lane });
            els.taskModal.close();
            // Refresh: workspaces too (a create may have populated an empty one).
            await loadWorkspaces();
            await loadLanes(currentWorkspace);
            applyFilter();
        } else {
            // Edit mode: PUT, then re-fetch and show the updated view so the
            // user sees the rendered result right away.
            const { workspace, lane, filename } = editingTask;
            await sendJson(
                "PUT",
                `/api/tasks/${encodeURIComponent(workspace)}/${encodeURIComponent(lane)}/${encodeURIComponent(filename)}`,
                payload,
            );
            const updated = await fetchJson(
                `/api/tasks/${encodeURIComponent(workspace)}/${encodeURIComponent(lane)}/${encodeURIComponent(filename)}`,
            );
            editingTask.data = updated;
            showViewMode();
            await loadLanes(currentWorkspace);
            applyFilter();
        }
    } catch (err) {
        showModalError(err && err.message ? err.message : "Failed to save task.");
    } finally {
        els.modalSave.disabled = false;
        els.modalSave.textContent = "Save";
    }
}

/* ---------- Event wiring ---------- */

function wireEvents() {
    // Workspace dropdown.
    els.select.addEventListener("change", async () => {
        currentWorkspace = els.select.value;
        await loadLanes(currentWorkspace);
        updateSearchPlaceholder();
        applyFilter();
    });

    // Search input — debounced; re-applies the filter after the user pauses.
    if (els.searchInput) {
        els.searchInput.addEventListener("input", (e) => {
            scheduleSearch(e.target.value);
        });
    }

    // New Task button.
    els.newTaskBtn.addEventListener("click", openNewTaskModal);

    // Refresh button.
    els.refreshBtn.addEventListener("click", async () => {
        await loadWorkspaces();
        await loadLanes(currentWorkspace);
        applyFilter();
    });

    // Kill button. No confirmation per UX decision — the dashboard is
    // read-only and trivial to restart with `/couralabs:task-dashboard`.
    if (els.killBtn) {
        els.killBtn.addEventListener("click", killDashboard);
    }

    // `r` / `R` keyboard shortcut — refresh unless typing in an input or
    // a modal is open.
    document.addEventListener("keydown", (e) => {
        if (e.key !== "r" && e.key !== "R") return;
        if (els.taskModal.open) return;
        const tag = (e.target && e.target.tagName) || "";
        if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
        if (e.target && e.target.isContentEditable) return;
        e.preventDefault();
        loadLanes(currentWorkspace).then(() => applyFilter());
    });

    // Modal close via X button.
    els.modalClose.addEventListener("click", () => {
        els.taskModal.close();
    });

    // View mode: Close button closes the modal.
    els.modalViewClose.addEventListener("click", () => {
        els.taskModal.close();
    });

    // View mode: Edit button switches to the editable form.
    els.modalEditBtn.addEventListener("click", enterEditMode);

    // Click-to-copy on the task id chip. Delegated on #modal-meta so it
    // works for both the view-mode and edit-mode renderings without
    // re-binding on each re-render. Falls back silently if the
    // Clipboard API is unavailable (e.g. insecure context); the chip
    // text is still selectable.
    els.modalMeta.addEventListener("click", async (e) => {
        const btn = e.target.closest(".copy-id-btn");
        if (!btn) return;
        const id = btn.dataset.id;
        if (!id || !navigator.clipboard?.writeText) return;
        try {
            await navigator.clipboard.writeText(id);
            const orig = btn.textContent;
            btn.textContent = "Copied!";
            btn.classList.add("copy-id-btn--copied");
            setTimeout(() => {
                btn.textContent = orig;
                btn.classList.remove("copy-id-btn--copied");
            }, 900);
        } catch {
            /* clipboard write rejected (e.g. permission) — leave text alone */
        }
    });

    // Edit/create mode: Cancel returns to the rendered view (edit) or
    // closes the modal (create — there is nothing to go back to).
    els.modalCancel.addEventListener("click", () => {
        if (modalMode === "edit") {
            showViewMode();
        } else {
            els.taskModal.close();
        }
    });

    // Form submit → save.
    els.taskForm.addEventListener("submit", (e) => {
        e.preventDefault();
        saveTask();
    });

    // Modal close via backdrop click. Pico's <dialog> emits a click on the
    // dialog element itself with `target === dialog` when the backdrop is
    // clicked.
    els.taskModal.addEventListener("click", (e) => {
        if (e.target === els.taskModal) {
            els.taskModal.close();
        }
    });

    // Modal close via Escape. The native <dialog> closes on Escape when
    // opened via showModal(), but we wire an explicit handler as
    // defense-in-depth (and to keep escape close behavior consistent
    // even if the dialog is opened via show() instead).
    document.addEventListener("keydown", (e) => {
        if (e.key !== "Escape") return;
        if (!els.taskModal.open) return;
        e.preventDefault();
        els.taskModal.close();
    });

    // Event delegation: clicks on .task-card open the modal. The
    // isDragging guard suppresses the click that browsers fire at the end
    // of a drag gesture.
    els.lanesContainer.addEventListener("click", (e) => {
        if (isDragging) return;
        const card = e.target.closest(".task-card");
        if (!card) return;
        const { workspace, lane, filename } = card.dataset;
        if (!workspace || !lane || !filename) return;
        openTaskModal(workspace, lane, filename);
    });

    // Toggle lane collapse on header click. The isDragging guard mirrors
    // the .task-card click handler — browsers may fire a click at the end
    // of a drag gesture, and we don't want that to flip the lane state.
    els.lanesContainer.addEventListener("click", (e) => {
        if (isDragging) return;
        const header = e.target.closest(".lane-header");
        if (!header) return;
        const lane = header.closest(".lane");
        if (!lane) return;
        toggleLaneCollapse(lane.dataset.lane);
    });

    // Keyboard activation: Enter / Space on a focused .lane-header toggles.
    els.lanesContainer.addEventListener("keydown", (e) => {
        if (e.key !== "Enter" && e.key !== " ") return;
        const header = e.target.closest(".lane-header");
        if (!header) return;
        e.preventDefault(); // prevent page scroll on Space
        const lane = header.closest(".lane");
        if (!lane) return;
        toggleLaneCollapse(lane.dataset.lane);
    });

    // --- Drag-and-drop (HTML5 DnD, delegated on the lanes container) ---

    // dragstart: record what is being dragged.
    els.lanesContainer.addEventListener("dragstart", (e) => {
        const card = e.target.closest(".task-card");
        if (!card) return;
        draggedCard = card;
        draggedTask = {
            workspace: card.dataset.workspace,
            lane: card.dataset.lane,
            filename: card.dataset.filename,
        };
        isDragging = true;
        e.dataTransfer.setData("text/plain", card.dataset.filename || "");
        e.dataTransfer.effectAllowed = "move";
        card.classList.add("dragging");
    });

    // dragend: final cleanup. If the last dragover was a rejection (the
    // drop event never fires on invalid lanes), surface the toast so the
    // user gets an error message, not just a red highlight. The toast is
    // shown before isDragging is cleared on the next tick, so any click at
    // the end of the drag gesture is still suppressed.
    els.lanesContainer.addEventListener("dragend", () => {
        clearDragState(lastDropRejected);
    });

    // dragover on lanes: only allow the drop when the lane exists for the
    // card's workspace. preventDefault() is what permits the drop — omit it
    // for invalid targets so the browser shows the native no-drop cursor.
    els.lanesContainer.addEventListener("dragover", (e) => {
        if (!draggedCard) return;
        const lane = e.target.closest(".lane");
        if (!lane) return;
        if (lane.classList.contains("collapsed")) return;
        const laneName = lane.dataset.lane;
        if (laneExistsForCard(draggedCard, laneName)) {
            e.preventDefault();
            e.dataTransfer.dropEffect = "move";
            lane.classList.add("drag-over");
            lane.classList.remove("drag-rejected");
            lastDropRejected = false;
        } else {
            lane.classList.add("drag-rejected");
            lane.classList.remove("drag-over");
            lastDropRejected = true;
        }
    });

    // dragleave: clear lane highlight, but only once the pointer actually
    // leaves the lane (dragleave fires on child hover jitter).
    els.lanesContainer.addEventListener("dragleave", (e) => {
        const lane = e.target.closest(".lane");
        if (!lane) return;
        const related = e.relatedTarget;
        if (related instanceof Node && lane.contains(related)) return;
        lane.classList.remove("drag-over", "drag-rejected");
    });

    // drop: perform the move (or reject/cleanup). Only valid drops reach
    // here because invalid dragover targets never call preventDefault.
    els.lanesContainer.addEventListener("drop", (e) => {
        if (!draggedCard) return;
        e.preventDefault();
        const lane = e.target.closest(".lane");
        if (!lane) {
            clearDragState();
            return;
        }
        const targetLane = lane.dataset.lane;
        if (!targetLane || !draggedTask) {
            clearDragState();
            return;
        }
        // Defense-in-depth: reject drops onto lanes that don't exist for
        // this card's workspace (in "all" view).
        if (currentWorkspace === "all" && !laneExistsForCard(draggedCard, targetLane)) {
            showDropError(`Cannot move to "${targetLane}" — no such lane in this workspace.`);
            clearDragState();
            return;
        }
        // Dropping a card into the lane it already lives in is a no-op.
        if (targetLane === draggedTask.lane) {
            clearDragState();
            return;
        }
        const task = draggedTask;
        // Clean up BEFORE the async reload so no stale drag state lingers.
        clearDragState();
        performMove(task, targetLane);
    });
}

/* ---------- Boot ---------- */

async function boot() {
    // Seed currentWorkspace from the URL query string. The /couralabs:task-dashboard
    // slash command appends `?workspace=<id>` where <id> = getWorkspaceName
    // (ctx.cwd). `getWorkspaceName` produces characters in [A-Za-z0-9_-]
    // only, but we re-validate here so a hand-crafted URL can't smuggle
    // path separators, query injection, or other junk. If the value is
    // missing or invalid, currentWorkspace stays at its module-level
    // default ("all") and the dashboard behaves as before.
    {
        const params = new URLSearchParams(location.search);
        const initial = params.get("workspace");
        if (initial && /^[A-Za-z0-9_-]+$/.test(initial)) {
            currentWorkspace = initial;
        }
    }
    loadCollapsed();
    wireEvents();
    const healthy = await checkHealth();
    if (!healthy) return;
    await loadWorkspaces();
    updateSearchPlaceholder();
    await loadLanes(currentWorkspace);
}

document.addEventListener("DOMContentLoaded", boot);