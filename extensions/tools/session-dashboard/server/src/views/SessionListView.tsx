// src/views/SessionListView.tsx
import { useEffect, useRef, useState } from "react";
import { listSessions, listChildren, ApiError } from "../api";
import type { SessionListItem } from "../types";
import { SearchBar } from "../components/SearchBar";
import { SettingsPanel } from "../components/SettingsPanel";
import type { Theme } from "../lib/useTheme";
import { killDashboard } from "../lib/killDashboard";

export interface SessionListViewProps {
  onNavigate: (sessionId: string) => void;
  theme: Theme;
  onThemeChange: (next: Theme) => void;
  fontSize: number;
  onFontSizeChange: (next: number) => void;
}

/** Format ISO timestamp to a coarse "ago" string. */
function formatRelative(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return iso;
  const now = Date.now();
  const diff = Math.max(0, now - then);
  const seconds = Math.floor(diff / 1000);
  if (seconds < 30) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  const d = new Date(iso);
  return d.toLocaleDateString();
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function lastTwoSegments(p: string): { prefix: string; last: string } {
  if (!p) return { prefix: "", last: "" };
  const parts = p.split("/").filter(Boolean);
  if (parts.length === 0) return { prefix: "", last: "" };
  // Preserve any leading "/" so the rendered text matches the source path
  // (the prefix span is never highlighted, but it should still look like a path).
  const leading = p.startsWith("/") ? "/" : "";
  if (parts.length <= 2) {
    // For short paths, the whole display string is the "last segment" —
    // the whole thing is the workspace folder the user cares about.
    return { prefix: leading, last: parts.join("/") };
  }
  return {
    prefix: `${leading}…/${parts.slice(-2, -1).join("/")}/`,
    last: parts[parts.length - 1],
  };
}

function matchesFilter(item: SessionListItem, q: string): boolean {
  if (!q) return true;
  const needle = q.toLowerCase();
  return (
    item.cwd.toLowerCase().includes(needle) ||
    (item.name?.toLowerCase().includes(needle) ?? false) ||
    item.preview.toLowerCase().includes(needle)
  );
}

export function SessionListView({
  onNavigate,
  theme,
  onThemeChange,
  fontSize,
  onFontSizeChange,
}: SessionListViewProps): JSX.Element {
  const [sessions, setSessions] = useState<SessionListItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  /** sessionId -> number of child sessions (populated async; absent = unknown/0). */
  const [childCounts, setChildCounts] = useState<Map<string, number>>(new Map());
  /** Ref to the topbar "Off" button. Passed to `killDashboard` so it can
   * disable itself and update its label before firing `/api/shutdown`. */
  const offButtonRef = useRef<HTMLButtonElement>(null);

  const load = async (): Promise<void> => {
    setSessions(null);
    setError(null);
    try {
      const items = await listSessions();
      setSessions(items);
    } catch (err) {
      const msg =
        err instanceof ApiError
          ? `${err.status}: ${err.message}`
          : err instanceof Error
            ? err.message
            : String(err);
      setError(msg);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  // After the session list loads, fetch the child count for each session
  // that has a parent. Sessions without a parent never need a call (their
  // count is 0, and an absent count is treated the same on the card).
  // Individual failures are ignored — the parent link is the primary
  // affordance and the children badge is supplementary.
  useEffect(() => {
    if (!sessions || sessions.length === 0) {
      setChildCounts(new Map());
      return;
    }
    const parentIds = sessions
      .filter((s) => s.parentSession)
      .map((s) => s.id);
    if (parentIds.length === 0) {
      setChildCounts(new Map());
      return;
    }
    let aborted = false;
    const results = parentIds.map(async (id) => {
      try {
        const children = await listChildren(id);
        return { id, count: children.length };
      } catch {
        return null;
      }
    });
    void Promise.all(results).then((settled) => {
      if (aborted) return;
      setChildCounts((prev) => {
        const next = new Map(prev);
        for (const r of settled) {
          if (r !== null) next.set(r.id, r.count);
        }
        return next;
      });
    });
    return () => {
      aborted = true;
    };
  }, [sessions]);

  const filtered = sessions?.filter((s) => matchesFilter(s, filter)) ?? null;

  return (
    <div className="session-list-view">
      <header className="top-bar">
        <span className="top-bar-title">Sessions</span>
        <span className="top-bar-spacer" />
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
      <div className="session-list-controls">
        <SearchBar value={filter} onChange={setFilter} />
        <button
          className="reload-button"
          type="button"
          onClick={() => void load()}
          aria-label="reload"
        >
          ↻
        </button>
      </div>
      <div className="session-list-body">
        {error ? (
          <div className="session-list-error">
            <p>Failed to load sessions: {error}</p>
            <button type="button" onClick={() => void load()}>
              Retry
            </button>
          </div>
        ) : filtered === null ? (
          <div className="session-list-loading">Loading…</div>
        ) : filtered.length === 0 ? (
          <div className="session-list-empty">
            {sessions && sessions.length === 0
              ? "No sessions yet."
              : "No sessions match your filter."}
          </div>
        ) : (
          <ul className="session-list">
            {filtered.map((s) => {
              const parentId = s.parentSession;
              const childCount = childCounts.get(s.id);
              return (
                <li
                  key={s.id}
                  className="session-card"
                  onClick={() => onNavigate(s.id)}
                  onKeyDown={(e) => {
                    // Only treat the card itself as the activation target;
                    // key presses on nested controls (e.g. the parent link)
                    // are handled by those controls.
                    if (e.target !== e.currentTarget) return;
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      onNavigate(s.id);
                    }
                  }}
                  role="button"
                  tabIndex={0}
                  title={s.cwd}
                >
                  <div className="session-card-row session-card-row-top">
                    <span
                      className="session-card-cwd"
                      title={s.cwd}
                    >
                      {(() => {
                        const seg = lastTwoSegments(s.cwd);
                        return (
                          <>
                            {seg.prefix}
                            {seg.last ? (
                              <span className="session-card-cwd-last">{seg.last}</span>
                            ) : null}
                          </>
                        );
                      })()}
                    </span>
                    <span className="session-card-time">
                      {formatRelative(s.lastActivity)}
                    </span>
                  </div>
                  {s.name ? (
                    <div className="session-card-name">{s.name}</div>
                  ) : null}
                  {s.preview ? (
                    <div className="session-card-preview">{s.preview.length > 80 ? s.preview.slice(0, 80) + "…" : s.preview}</div>
                  ) : null}
                  <div className="session-card-row session-card-row-bottom">
                    <span className="session-card-meta">
                      {s.messageCount} message{s.messageCount === 1 ? "" : "s"}
                    </span>
                    <span className="session-card-meta">{formatBytes(s.sizeBytes)}</span>
                  </div>
                  {parentId || (childCount !== undefined && childCount > 0) ? (
                    <div className="session-card-row session-card-row-relations">
                      {parentId ? (
                        <button
                          type="button"
                          className="session-card-parent-link"
                          aria-label={`Open parent session ${parentId}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            onNavigate(parentId);
                          }}
                        >
                          ↑ parent
                        </button>
                      ) : null}
                      {childCount !== undefined && childCount > 0 ? (
                        <span className="session-card-children-badge">
                          Children: {childCount}
                        </span>
                      ) : null}
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </div>
      <SettingsPanel
        streamingEnabled={false}
        onStreamingChange={() => {
          // The session list doesn't subscribe to SSE; this toggle is a
          // no-op on this view. The popover is rendered uniformly so the
          // Theme row is reachable from the landing page.
        }}
        autoScrollEnabled={false}
        onAutoScrollChange={() => {
          // No scrollable session list — see above.
        }}
        theme={theme}
        onThemeChange={onThemeChange}
        fontSize={fontSize}
        onFontSizeChange={onFontSizeChange}
      />
    </div>
  );
}
