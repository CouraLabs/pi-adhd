// src/views/SessionView.tsx
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getSession, listChildren, streamUrl, ApiError } from "../api";
import type { SessionDetail, SessionEntry, SessionStats } from "../types";
import { formatTokens, formatDuration } from "../lib/format";
import { Message } from "../components/Message";
import { SettingsPanel } from "../components/SettingsPanel";
import { FilterBar } from "../components/FilterBar";
import { useEventSource } from "../lib/useEventSource";
import { useScrollControl } from "../lib/useScrollControl";
import type { Theme } from "../lib/useTheme";
import {
  DEFAULT_FILTERS,
  passesFilter,
  type Filters,
} from "../lib/filters";
import { killDashboard } from "../lib/killDashboard";

const FILTERS_STORAGE_KEY = "session-dashboard.filters";

/**
 * Read the persisted filters from localStorage. Returns null on any
 * failure (missing key, malformed JSON, wrong shape). Never throws.
 * The result is merged with DEFAULT_FILTERS so missing fields inherit
 * from defaults — forward-compat for new fields added later.
 */
function loadStoredFilters(): Filters | null {
  try {
    if (typeof window === "undefined") return null;
    const raw = window.localStorage.getItem(FILTERS_STORAGE_KEY);
    if (raw === null) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return null;
    const p = parsed as Partial<Filters>;
    // Merge: defaults supply shape and missing fields; parsed overrides.
    return {
      showRoles: {
        ...DEFAULT_FILTERS.showRoles,
        ...(p.showRoles ?? {}),
      },
      hideDividers:
        typeof p.hideDividers === "boolean"
          ? p.hideDividers
          : DEFAULT_FILTERS.hideDividers,
      showThinking:
        typeof p.showThinking === "boolean"
          ? p.showThinking
          : DEFAULT_FILTERS.showThinking,
    };
  } catch {
    return null;
  }
}

/** Persist the current filters. Swallows localStorage errors. */
function persistFilters(filters: Filters): void {
  try {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(
      FILTERS_STORAGE_KEY,
      JSON.stringify(filters),
    );
  } catch {
    // localStorage can throw in private modes / when disabled — ignore.
  }
}

export interface SessionViewProps {
  sessionId: string;
  onBack: () => void;
  onNavigate: (sessionId: string) => void;
  theme: Theme;
  onThemeChange: (next: Theme) => void;
  fontSize: number;
  onFontSizeChange: (next: number) => void;
}

function findFirstUserText(branch: SessionEntry[]): string {
  for (const e of branch) {
    if (e.type === "message" && e.message.role === "user") {
      const m = e.message;
      for (const b of m.content) {
        if (b && typeof b === "object" && (b as { type?: unknown }).type === "text") {
          const t = (b as { text?: unknown }).text;
          if (typeof t === "string" && t.trim()) return t;
        }
      }
    }
  }
  return "";
}

function displayTitle(detail: SessionDetail | null, fallback: string): string {
  if (!detail) return fallback;
  // For v1 use cwd's last segment as the display title if no name exists.
  const cwd = detail.header.cwd || "";
  const parts = cwd.split("/").filter(Boolean);
  const last = parts[parts.length - 1] ?? "";
  return last || fallback;
}

/**
 * Resolve the parent session id for a session detail:
 *   1. Walk `branch` (leaf-first) for an `agent-xpto-parent` custom marker
 *      and read its `data.parentSessionId` (the agent-xpto mechanism).
 *   2. Fall back to `detail.header.parentSession` (the older header field).
 *
 * The marker is emitted near the start of a child session, so it sits at the
 * leaf end of the branch. SSE keeps growing the branch but the marker rarely
 * moves; recomputing on every branch change is cheap and means a marker that
 * streams in after the initial fetch is picked up automatically.
 */
const PARENT_MARKER_CUSTOM_TYPE = "agent-xpto-parent";

function resolveParentSessionId(
  branch: SessionEntry[],
  detail: SessionDetail | null,
): string | undefined {
  for (const e of branch) {
    if (e.type === "custom" && e.customType === PARENT_MARKER_CUSTOM_TYPE) {
      const data = e.data;
      if (data && typeof data === "object") {
        const parentSessionId = (data as { parentSessionId?: unknown })
          .parentSessionId;
        if (typeof parentSessionId === "string") return parentSessionId;
      }
    }
  }
  return detail?.header.parentSession;
}

/**
 * Copy `text` to the clipboard. Tries the async Clipboard API first and
 * falls back to a transient textarea + execCommand for non-secure
 * contexts (http:// origins without clipboard permission). Never throws.
 */
async function copyToClipboard(text: string): Promise<void> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return;
    }
  } catch {
    // fall through to the legacy path
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    ta.remove();
  } catch {
    // Best effort — the path is still visible on screen.
  }
}

export function SessionView({
  sessionId,
  onBack,
  onNavigate,
  theme,
  onThemeChange,
  fontSize,
  onFontSizeChange,
}: SessionViewProps): JSX.Element {
  const [detail, setDetail] = useState<SessionDetail | null>(null);
  const [branch, setBranch] = useState<SessionEntry[]>([]);
  const [stats, setStats] = useState<SessionStats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [streamingEnabled, setStreamingEnabled] = useState(true);
  const [autoScrollEnabled, setAutoScrollEnabled] = useState(true);
  const [offset, setOffset] = useState(0);
  const [title, setTitle] = useState<string>("");
  const [filters, setFilters] = useState<Filters>(() => loadStoredFilters() ?? DEFAULT_FILTERS);
  const [children, setChildren] = useState<string[]>([]);
  const [childrenError, setChildrenError] = useState<string | null>(null);
  const filtersRef = useRef<Filters>(filters);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const autoScrollEnabledRef = useRef(autoScrollEnabled);
  const { scrollToBottom, isAtBottom } = useScrollControl(scrollRef);
  /** Ref to the topbar "Off" button. Passed to `killDashboard` so it can
   * disable itself and update its label before firing `/api/shutdown`. */
  const offButtonRef = useRef<HTMLButtonElement>(null);
  const [pathCopied, setPathCopied] = useState(false);
  const pathCopyTimerRef = useRef<number | null>(null);

  const filePath = detail?.filePath;
  const handleCopyPath = useCallback((): void => {
    if (!filePath) return;
    void copyToClipboard(filePath).then(() => {
      setPathCopied(true);
      if (pathCopyTimerRef.current !== null) {
        window.clearTimeout(pathCopyTimerRef.current);
      }
      pathCopyTimerRef.current = window.setTimeout(() => {
        setPathCopied(false);
        pathCopyTimerRef.current = null;
      }, 1500);
    });
  }, [filePath]);

  // Clear the pending "Copied!" reset timer on unmount / session change.
  useEffect(() => {
    return () => {
      if (pathCopyTimerRef.current !== null) {
        window.clearTimeout(pathCopyTimerRef.current);
        pathCopyTimerRef.current = null;
      }
    };
  }, [sessionId]);

  // Keep the latest autoScrollEnabled reachable from the SSE callback.
  useEffect(() => {
    autoScrollEnabledRef.current = autoScrollEnabled;
  }, [autoScrollEnabled]);

  // Keep the latest filters reachable from the filter-change scroll effect.
  useEffect(() => {
    filtersRef.current = filters;
  }, [filters]);

  // Persist filter state so toggle preferences survive a page refresh.
  useEffect(() => {
    persistFilters(filters);
  }, [filters]);

  // Resolve the parent session id from the branch marker first, then the
  // header. Recomputed whenever `branch` changes (e.g. SSE prepends) so a
  // marker that streams in after the initial fetch is picked up. Keyed on
  // `detail` too so the header fallback is available once loaded.
  const parentSessionId = useMemo(
    () => resolveParentSessionId(branch, detail),
    [branch, detail],
  );

  // Compute the visible leaf-first indices. Each <Message> still receives
  // its ORIGINAL leaf-first index so the toolResult look-aheads in the
  // dispatcher keep operating on the same leaf-first layout.
  const visibleIndices = useMemo((): number[] => {
    const out: number[] = [];
    for (let i = 0; i < branch.length; i++) {
      if (passesFilter(branch[i], filters)) out.push(i);
    }
    return out;
  }, [branch, filters]);

  // Same indices as a Set — passed down to <Message> for filter-aware
  // dispatch (skip-hidden-toolResult in look-aheads, gate-absorb on
  // visible-preceding-assistant). Memoized separately so it remains
  // referentially stable when neither branch nor filters change.
  const visibleIndexSet = useMemo((): ReadonlySet<number> => {
    return new Set(visibleIndices);
  }, [visibleIndices]);

  // Initial fetch.
  useEffect(() => {
    let cancelled = false;
    setDetail(null);
    setBranch([]);
    setError(null);
    setOffset(0);
    setTitle("");
    (async () => {
      try {
        const d = await getSession(sessionId);
        if (cancelled) return;
        setDetail(d);
        setBranch(d.branch);
        setStats(d.stats ?? null);
        setTitle(findFirstUserText(d.branch) || displayTitle(d, sessionId));
      } catch (err) {
        if (cancelled) return;
        const msg =
          err instanceof ApiError
            ? `${err.status}: ${err.message}`
            : err instanceof Error
              ? err.message
              : String(err);
        setError(msg);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  // Fetch the child session ids once the session id is known. 404 from the
  // endpoint means the parent id is unknown to the index — treat it as "no
  // children" (not an error). Other failures surface as a muted line.
  // NOTE: this list does NOT auto-refresh on SSE — new children spawn while
  // viewing would only appear after navigating away and back. Acceptable for
  // v1 (refresh on full navigation away-and-back is sufficient).
  useEffect(() => {
    let aborted = false;
    setChildren([]);
    setChildrenError(null);
    (async () => {
      try {
        const ids = await listChildren(sessionId);
        if (aborted) return;
        setChildren(ids);
      } catch (err) {
        if (aborted) return;
        if (err instanceof ApiError && err.status === 404) {
          // Unknown parent — no children. Not an error.
          setChildren([]);
          return;
        }
        setChildrenError(
          err instanceof Error ? err.message : String(err),
        );
      }
    })();
    return () => {
      aborted = true;
    };
  }, [sessionId]);

  // Initial scroll-to-bottom after first render of content.
  useEffect(() => {
    if (branch.length === 0) return;
    // Wait one frame so layout has settled.
    const id = requestAnimationFrame(() => {
      scrollToBottom();
    });
    return () => cancelAnimationFrame(id);
    // Only on first paint, not on every branch update.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [branch.length > 0]);

  const handleEntry = useCallback((raw: unknown): void => {
    if (!raw || typeof raw !== "object") return;
    // SSE `entry` payloads are `{ entry, stats }` envelopes — the server
    // recomputes SessionStats over the active branch and ships them alongside
    // each new entry so the client never has to re-fetch the detail endpoint.
    const envelope = raw as { entry?: unknown; stats?: SessionStats };
    const entry = envelope.entry;
    if (
      !entry ||
      typeof entry !== "object" ||
      typeof (entry as { type?: unknown }).type !== "string"
    ) {
      return;
    }
    const obj = entry as SessionEntry;
    setBranch((prev) => {
      // Avoid duplicates by id.
      if ("id" in obj && typeof (obj as { id?: unknown }).id === "string") {
        const id = (obj as { id: string }).id;
        if (prev.some((p) => "id" in p && (p as { id: string }).id === id)) {
          return prev;
        }
      }
      // Server returns leaf-first (newest at index 0). We display with the
      // newest at the bottom of the viewport (standard chat convention), so
      // new entries — which are also the newest — must be PREPENDED to
      // branch state. See SessionView render block for the matching reverse.
      return [obj, ...prev];
    });
    if (envelope.stats) setStats(envelope.stats);
    if (autoScrollEnabledRef.current) {
      // Defer to next frame so the new node is in the DOM.
      requestAnimationFrame(() => scrollToBottom());
    }
  }, [scrollToBottom]);

  const handleReady = useCallback((raw: unknown): void => {
    if (raw && typeof raw === "object" && "fromOffset" in raw) {
      const n = (raw as { fromOffset: unknown }).fromOffset;
      if (typeof n === "number") setOffset(n);
    }
  }, []);

  // Subscribe to SSE.
  const url = streamingEnabled && detail ? streamUrl(sessionId, offset) : null;
  const es = useEventSource(url);
  useEffect(() => {
    es.on("entry", handleEntry);
    es.on("ready", handleReady);
    return () => {
      es.close();
    };
  }, [es, handleEntry, handleReady]);

  // If the user scrolls up, auto-disable auto-scroll; if they scroll back to
  // the bottom, re-enable it. This is the classic chat UX pattern.
  useEffect(() => {
    if (!scrollRef.current) return;
    const el = scrollRef.current;
    const handler = (): void => {
      if (!isAtBottom() && autoScrollEnabledRef.current) {
        setAutoScrollEnabled(false);
      } else if (isAtBottom() && !autoScrollEnabledRef.current) {
        setAutoScrollEnabled(true);
      }
    };
    el.addEventListener("scroll", handler, { passive: true });
    return () => {
      el.removeEventListener("scroll", handler);
    };
  }, [isAtBottom]);

  // When filters change, the visible bottom shifts. If the user is still
  // pinned to the bottom (auto-scroll on), follow the new bottom on the
  // next frame so the viewport stays in place visually.
  useEffect(() => {
    if (!autoScrollEnabledRef.current) return;
    const id = requestAnimationFrame(() => scrollToBottom());
    return () => cancelAnimationFrame(id);
    // Re-run whenever the filter state object identity changes.
  }, [filters, scrollToBottom]);

  const cwd = detail?.header.cwd ?? "";
  const cwdParts = cwd.split("/").filter(Boolean);

  return (
    <div className="session-view">
      <header className="top-bar">
        <button
          className="back-button"
          type="button"
          onClick={onBack}
          aria-label="back"
        >
          ← Sessions
        </button>
        <span className="top-bar-spacer" />
        {detail ? (
          <nav className="top-bar-cwd" title={cwd} aria-label="working directory">
            {cwdParts.length === 0
              ? "/"
              : cwdParts.map((seg, i) => (
                  <span key={i} className="cwd-segment">
                    {seg}
                    {i < cwdParts.length - 1 ? <span className="cwd-sep">/</span> : null}
                  </span>
                ))}
          </nav>
        ) : null}
        <button
          ref={offButtonRef}
          className="off-button"
          type="button"
          onClick={() => void killDashboard(offButtonRef.current)}
          aria-label="Stop the dashboard server"
          title="Stop the dashboard server"
        >
          Off
        </button>
      </header>
      {error ? (
        <div className="session-error">
          <p>{error}</p>
          <button type="button" onClick={onBack}>
            Back
          </button>
        </div>
      ) : !detail ? (
        <div className="session-loading">Loading…</div>
      ) : (
        <>
          <div className="session-title">
            {parentSessionId ? (
              <button
                type="button"
                className="session-parent-link"
                onClick={() => onNavigate(parentSessionId)}
                aria-label={`Open parent session ${parentSessionId}`}
              >
                ← Parent
              </button>
            ) : null}
            <span className="session-title-text" title={title}>
              {title.length > 80 ? title.slice(0, 80) + "…" : title}
            </span>
            <span className="session-meta">
              {visibleIndices.length} of {branch.length}{" "}
              {branch.length === 1 ? "entry" : "entries"} · {detail.totalEntries} total
            </span>
          </div>
          {detail.stats || stats ? (
            <section className="session-stats" aria-label="Session statistics" data-testid="session-stats">
              {(() => {
                const s = stats ?? detail.stats;
                // Type narrowing: at least one is non-null because of the conditional.
                if (!s) return null;
                const fmtMs = (ms: number) => formatDuration(ms);
                const durationMs =
                  s.firstTimestamp && s.lastTimestamp
                    ? new Date(s.lastTimestamp).getTime() - new Date(s.firstTimestamp).getTime()
                    : 0;
                return (
                  <>
                    <Stat label="context" value={`${formatTokens(s.latestContextTokens)} tokens`} titleValue={String(s.latestContextTokens)} />
                    <Stat label="in" value={formatTokens(s.totalInputTokens)} titleValue={String(s.totalInputTokens)} />
                    <Stat label="out" value={formatTokens(s.totalOutputTokens)} titleValue={String(s.totalOutputTokens)} />
                    <Stat
                      label="CH"
                      value={`${s.cacheHitPercent}%`}
                      titleValue={`Cache hit: ${s.cacheHitPercent}% of input-side tokens came from cache`}
                    />
                    <Stat label="turns" value={String(s.turns)} titleValue={String(s.turns)} />
                    <Stat label="tools" value={String(s.toolCalls)} titleValue={String(s.toolCalls)} />
                    <Stat label="agents" value={String(s.agentCalls)} titleValue={String(s.agentCalls)} />
                    <Stat label="compactions" value={String(s.compactions)} titleValue={String(s.compactions)} />
                    <Stat label="duration" value={fmtMs(durationMs)} titleValue={`${durationMs} ms`} />
                    <Stat
                      label="started"
                      value={new Date(detail.header.timestamp).toLocaleString()}
                      titleValue={detail.header.timestamp}
                    />
                    <Stat
                      label="last entry"
                      value={s.lastTimestamp ? new Date(s.lastTimestamp).toLocaleString() : "—"}
                      titleValue={s.lastTimestamp ?? "none"}
                    />
                    {s.latestModel ? (
                      <Stat
                        label="model"
                        value={`${s.latestModel.model} x${s.latestModel.turns}`}
                        titleValue={`${s.latestModel.model} (${s.latestModel.turns} consecutive turns)`}
                      />
                    ) : null}
                  </>
                );
              })()}
            </section>
          ) : null}
          {filePath ? (
            <div className="session-filepath-row">
              <code className="session-filepath" title={filePath}>
                {filePath}
              </code>
              <button
                type="button"
                className={
                  pathCopied
                    ? "session-filepath-copy copied"
                    : "session-filepath-copy"
                }
                onClick={handleCopyPath}
                aria-label="Copy session file path"
                title="Copy session file path"
              >
                {pathCopied ? "Copied!" : "Copy"}
              </button>
            </div>
          ) : null}
          <FilterBar filters={filters} onChange={setFilters} />
          {children.length > 0 ? (
            <section className="session-children-section" aria-label="Spawned subagent sessions">
              <h2 className="session-children-heading">Spawned subagent sessions</h2>
              <ul className="session-children-list">
                {children.map((childId) => (
                  <li key={childId}>
                    <button
                      type="button"
                      className="session-children-item"
                      onClick={() => onNavigate(childId)}
                      aria-label={`Open child session ${childId}`}
                    >
                      {childId.length > 8 ? childId.slice(0, 8) + "…" : childId}
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
          {childrenError ? (
            <div className="session-children-error">Could not load children</div>
          ) : null}
          <div className="session-scroll" ref={scrollRef}>
            {branch.length === 0 ? (
              <div className="session-empty">No entries on the active branch.</div>
            ) : visibleIndices.length === 0 ? (
              <div className="session-empty">
                All entries hidden — toggle a filter to show messages.
              </div>
            ) : (
              <div className="session-entries">
                {/*
                  branch is leaf-first (newest at index 0). We render in
                  reverse so the newest message ends up at the BOTTOM of the
                  viewport (standard chat convention). Each <Message> still
                  receives the ORIGINAL index into `branch` so its look-ups
                  (entries[index], entries[index + 1], entries[index - 1])
                  continue to operate on the same leaf-first layout. Filters
                  are applied at this level: visibleIndices holds the
                  leaf-first indices that pass the current filter predicate.
                */}
                {visibleIndices
                  .slice()
                  .reverse()
                  .map((originalIdx) => (
                    <Message
                      key={
                        (branch[originalIdx] as { id?: string }).id ?? originalIdx
                      }
                      entries={branch}
                      index={originalIdx}
                      visibleIndices={visibleIndexSet}
                      showThinking={filters.showThinking}
                    />
                  ))}
              </div>
            )}
          </div>
        </>
      )}
      <SettingsPanel
        streamingEnabled={streamingEnabled}
        onStreamingChange={setStreamingEnabled}
        autoScrollEnabled={autoScrollEnabled}
        onAutoScrollChange={setAutoScrollEnabled}
        theme={theme}
        onThemeChange={onThemeChange}
        fontSize={fontSize}
        onFontSizeChange={onFontSizeChange}
      />
    </div>
  );
}

/**
 * One chip in the session-stats strip. `titleValue` is the unformatted
 * underlying value shown in the hover tooltip (e.g. "52341" instead of
 * "52.3k").
 */
function Stat({
  label,
  value,
  titleValue,
}: {
  label: string;
  value: string;
  titleValue: string;
}): JSX.Element {
  return (
    <span className="session-stat" title={titleValue}>
      <span className="session-stat-label">{label}</span>
      <span className="session-stat-value">{value}</span>
    </span>
  );
}
