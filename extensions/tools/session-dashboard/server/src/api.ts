// src/api.ts
// Fetch wrappers for the backend. The Vite dev server proxies /api to 53510;
// in production the backend serves both API and static dist/.

import type { SessionChildrenResponse, SessionDetail, SessionListItem } from "./types";

const BASE = "/api";

export class ApiError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
    this.name = "ApiError";
  }
}

async function jsonFetch<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: { accept: "application/json" } });
  if (!res.ok) {
    let msg = `${res.status} ${res.statusText}`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body && typeof body.error === "string") msg = body.error;
    } catch {
      /* ignore */
    }
    if (res.status === 404) msg = `Not found: ${msg}`;
    throw new ApiError(msg, res.status);
  }
  return (await res.json()) as T;
}

export async function listSessions(): Promise<SessionListItem[]> {
  return jsonFetch<SessionListItem[]>(`${BASE}/sessions`);
}

export async function getSession(id: string): Promise<SessionDetail> {
  return jsonFetch<SessionDetail>(
    `${BASE}/sessions/${encodeURIComponent(id)}`,
  );
}

/**
 * List the subagent sessions spawned by a given parent session.
 * Returns the list of child session ids. The endpoint returns 404 when
 * the parent id is unknown, which `jsonFetch` already converts to an
 * `ApiError`.
 */
export async function listChildren(id: string): Promise<string[]> {
  const res = await jsonFetch<SessionChildrenResponse>(
    `${BASE}/sessions/${encodeURIComponent(id)}/children`,
  );
  return res.children;
}

/**
 * Build the SSE URL for streaming a session from a given byte offset.
 * Returns null when offset is 0 and caller doesn't want SSE (helper).
 */
export function streamUrl(id: string, from: number): string {
  const u = new URL(`${BASE}/sessions/${encodeURIComponent(id)}/stream`, window.location.origin);
  if (from > 0) u.searchParams.set("from", String(from));
  return u.toString();
}
