// server.ts — session-dashboard backend
// Single-file Node.js + TypeScript HTTP server. Run with `tsx`.
// Reads pi session JSONL files from ~/.pi/agent/sessions/ and serves them
// via a REST + SSE API.

import * as http from "node:http";
import * as fs from "node:fs";
import * as fsp from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import * as readline from "node:readline";
import { randomUUID } from "node:crypto";

import { computeSessionStats } from "./lib/stats";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const SESSIONS_DIR = path.join(
  process.env.PI_CODING_AGENT_DIR ?? path.join(os.homedir(), ".pi/agent"),
  "sessions",
);

export const PORT = parseInt(process.env.PORT ?? "53510", 10);

const LIST_CONCURRENCY = 16;
const SSE_POLL_INTERVAL_MS = 500;
const SSE_POLL_FALLBACK_MS = 1500;

/**
 * Module-scoped callback that the `/api/shutdown` route invokes to
 * actually stop the HTTP server. Wired in the `isMain` block so the
 * shutdown route has a way to reach the listening socket it lives on.
 * Stays `null` for tests / imports that don't start a real server, so
 * dispatching a shutdown request in those contexts is a no-op (the route
 * still returns 200 — the client just won't see the port freed).
 */
let shutdownHandler: (() => void) | null = null;

/**
 * Disconnect the module-scoped shutdown handler. Called by the extension
 * after a manual `/session-dashboard --stop` so a subsequent restart can
 * re-wire a new handler. The extension's manual stop already kills the
 * child process — this just keeps the module state consistent.
 */
export function clearShutdownHandler(): void {
  shutdownHandler = null;
}

/**
 * Test-only: install a custom shutdown handler. Used by the test suite to
 * exercise the `/api/shutdown` route's handler-wiring path without
 * spinning up a real `isMain` process. Not used at runtime — the entry
 * block wires its own closure.
 */
export function setShutdownHandler(handler: () => void): void {
  shutdownHandler = handler;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ContentBlock = { type: "text"; text: string } | { type: string; [k: string]: unknown };

export type MessageBody =
  | { role: "user"; content: ContentBlock[]; timestamp: number }
  | {
      role: "assistant";
      content: ContentBlock[];
      timestamp: number;
      api?: string;
      provider?: string;
      model?: string;
      usage?: unknown;
      stopReason?: string;
      rawStopReason?: string;
      errorMessage?: string;
      responseId?: string;
      responseModel?: string;
      details?: unknown;
    }
  | {
      role: "toolResult";
      toolCallId: string;
      toolName: string;
      content: ContentBlock[];
      isError: boolean;
      timestamp: number;
      details?: unknown;
      errorMessage?: string;
    }
  | {
      role: "bashExecution";
      command: string;
      output: string;
      exitCode: number;
      cancelled: boolean;
      truncated: boolean;
      timestamp: number;
      excludeFromContext?: boolean;
    };

export type SessionEntry =
  | {
      type: "session";
      version: number;
      id: string;
      timestamp: string;
      cwd: string;
      parentSession?: string;
    }
  | { type: "message"; id: string; parentId: string | null; timestamp: string; message: MessageBody }
  | {
      type: "model_change";
      id: string;
      parentId: string | null;
      timestamp: string;
      provider: string;
      modelId: string;
    }
  | {
      type: "thinking_level_change";
      id: string;
      parentId: string | null;
      timestamp: string;
      thinkingLevel: string;
    }
  | {
      type: "compaction";
      id: string;
      parentId: string | null;
      timestamp: string;
      summary: string;
      firstKeptEntryId: string;
      tokensBefore: number;
      details?: { readFiles?: string[]; modifiedFiles?: string[] };
      fromHook?: boolean;
      usage?: unknown;
    }
  | {
      type: "branch_summary";
      id: string;
      parentId: string | null;
      timestamp: string;
      summary: string;
      fromHook?: boolean;
    }
  | {
      type: "session_info";
      id: string;
      parentId: string | null;
      timestamp: string;
      name?: string;
    }
  | { type: "label"; id: string; parentId: string | null; timestamp: string; label: string }
  | {
      type: "custom";
      id: string;
      parentId: string | null;
      timestamp: string;
      customType: string;
      data: unknown;
    }
  | {
      type: "custom_message";
      id: string;
      parentId: string | null;
      timestamp: string;
      customType: string;
      content: string;
      display: boolean;
    };

export interface SessionListItem {
  id: string;
  cwd: string;
  name: string | null;
  createdAt: string;
  lastActivity: string;
  messageCount: number;
  sizeBytes: number;
  preview: string;
  /** Parent session id recorded by an `agent-xpto-parent` custom marker, if any. */
  parentSession?: string;
}

export interface SessionStats {
  /** Tokens reported in the most recent assistant message's `usage`. */
  latestContextTokens: number;
  /** Sum of `usage.input` across all assistant messages on the branch. */
  totalInputTokens: number;
  /** Sum of `usage.output` across all assistant messages on the branch. */
  totalOutputTokens: number;
  /** Count of assistant messages on the branch. */
  turns: number;
  /** Count of `toolResult` messages on the branch (all tool names, including `bash`, `read`, `call`, etc.). */
  toolCalls: number;
  /** Count of `toolResult` messages on the branch whose `message.toolName === "call"` (Pi's built-in agent-delegation tool). Always `<= toolCalls`. */
  agentCalls: number;
  /** Count of `compaction` entries on the branch. */
  compactions: number;
  /** Newest entry's ISO timestamp on the branch, or `null` if branch is empty. Same value as `branch[0]?.timestamp`. */
  lastTimestamp: string | null;
  /** Oldest entry's ISO timestamp on the branch, or `null` if branch is empty. Same value as `branch[branch.length - 1]?.timestamp`. */
  firstTimestamp: string | null;
  /** Model string of the most recent assistant message on the branch, plus the count of assistant messages that used it consecutively from the leaf backwards (a different model in between breaks the run). `null` if no assistant message with a model string is on the branch. */
  latestModel: { model: string; turns: number } | null;
  /** Cache hit rate as an integer 0..100: `round(100 * totalCacheRead / (totalInputTokens + totalCacheRead))`. `0` when neither input nor cacheRead were seen on the branch. */
  cacheHitPercent: number;
}

export interface SessionDetail {
  header: { id: string; version: number; timestamp: string; cwd: string; parentSession?: string };
  branch: SessionEntry[];
  totalEntries: number;
  /** Absolute path of the session's JSONL file on disk. */
  filePath: string;
  stats?: SessionStats;
}

// ---------------------------------------------------------------------------
// Path utilities (exported for testing)
// ---------------------------------------------------------------------------

/**
 * Encode a cwd path as a directory name used under the sessions dir.
 * Examples:
 *   /Users/foo/bar -> --Users-foo-bar--
 *   /              -> --
 *   /tmp           -> --tmp--
 */
export function cwdToDirName(cwd: string): string {
  if (cwd === "/" || cwd === "") return "--";
  let p = cwd;
  if (p.startsWith("/")) p = p.slice(1);
  if (p.endsWith("/")) p = p.slice(0, -1);
  if (p.length === 0) return "--";
  return "--" + p.replace(/\//g, "-") + "--";
}

/**
 * Decode a directory name back into a cwd path.
 */
export function dirNameToCwd(name: string): string {
  let n = name;
  if (n.startsWith("--")) n = n.slice(2);
  if (n.endsWith("--")) n = n.slice(0, -2);
  return "/" + n.replace(/-/g, "/");
}

// ---------------------------------------------------------------------------
// JSONL parser
// ---------------------------------------------------------------------------

/**
 * Stream a session JSONL file as an async iterable of parsed entries.
 * Per-line parse errors are logged and skipped — never crash the stream.
 */
export async function* iterateSession(filepath: string): AsyncGenerator<SessionEntry> {
  const stream = fs.createReadStream(filepath, { encoding: "utf8" });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
  let lineNo = 0;
  try {
    for await (const raw of rl) {
      lineNo++;
      const line = raw.trim();
      if (line.length === 0) continue;
      try {
        const obj = JSON.parse(line) as SessionEntry;
        if (obj && typeof obj === "object" && typeof (obj as { type?: unknown }).type === "string") {
          yield obj;
        } else {
          console.error(`[iterateSession] ${filepath}:${lineNo}: missing 'type' field, skipping`);
        }
      } catch (err) {
        console.error(`[iterateSession] ${filepath}:${lineNo}: parse error:`, err);
      }
    }
  } finally {
    rl.close();
    stream.destroy();
  }
}

// ---------------------------------------------------------------------------
// Session metadata
// ---------------------------------------------------------------------------

const PREVIEW_MAX = 200;

function textFromContent(blocks: unknown): string {
  if (!Array.isArray(blocks)) return "";
  let out = "";
  for (const b of blocks) {
    if (b && typeof b === "object" && (b as { type?: unknown }).type === "text") {
      const t = (b as { text?: unknown }).text;
      if (typeof t === "string") out += t;
    }
  }
  return out;
}

/**
 * Read the first line of a session file (the header). Throws on invalid input.
 */
export async function parseSessionHeader(filepath: string): Promise<{
  type: "session";
  version: number;
  id: string;
  timestamp: string;
  cwd: string;
  parentSession?: string;
}> {
  const fh = await fsp.open(filepath, "r");
  try {
    const buf = Buffer.alloc(8192);
    const { bytesRead } = await fh.read(buf, 0, buf.length, 0);
    const text = buf.subarray(0, bytesRead).toString("utf8");
    const nl = text.indexOf("\n");
    const firstLine = (nl === -1 ? text : text.slice(0, nl)).trim();
    if (firstLine.length === 0) throw new Error(`empty session file: ${filepath}`);
    const parsed = JSON.parse(firstLine);
    if (parsed?.type !== "session") {
      throw new Error(`first line is not a session header in ${filepath}`);
    }
    return parsed;
  } finally {
    await fh.close();
  }
}

const PARENT_MARKER_CUSTOM_TYPE = "agent-xpto-parent";
const PARENT_MARKER_PEEK_LIMIT = 50;

/**
 * Peek the first `PARENT_MARKER_PEEK_LIMIT` entries of a session file for an
 * `agent-xpto-parent` custom marker. Returns the marker's `data.parentSessionId`
 * when found, otherwise null.
 *
 * This is a cheap metadata-only pass: it opens the file once and reads at most
 * `PARENT_MARKER_PEEK_LIMIT` lines (never the whole file). Parse errors are
 * logged and skipped, mirroring iterateSession's tolerance.
 */
export async function peekParentMarker(filepath: string): Promise<string | null> {
  const fh = await fsp.open(filepath, "r");
  try {
    const rl = readline.createInterface({
      input: fh.createReadStream({ encoding: "utf8" }),
      crlfDelay: Infinity,
    });
    let lineNo = 0;
    let count = 0;
    try {
      for await (const raw of rl) {
        lineNo++;
        const line = raw.trim();
        if (line.length === 0) continue;
        count++;
        if (count > PARENT_MARKER_PEEK_LIMIT) break;
        try {
          const parsed = JSON.parse(line) as { type?: unknown; customType?: unknown; data?: unknown };
          if (
            parsed &&
            typeof parsed === "object" &&
            parsed.type === "custom" &&
            parsed.customType === PARENT_MARKER_CUSTOM_TYPE
          ) {
            const data = parsed.data;
            if (data && typeof data === "object") {
              const parentSessionId = (data as { parentSessionId?: unknown }).parentSessionId;
              if (typeof parentSessionId === "string") return parentSessionId;
            }
          }
        } catch (err) {
          console.error(`[peekParentMarker] ${filepath}:${lineNo}: parse error:`, err);
        }
      }
    } finally {
      rl.close();
    }
    return null;
  } finally {
    await fh.close();
  }
}

/**
 * Lightweight metadata for list endpoint: parses the header, then streams the
 * file counting messages and remembering the first user-text preview and the
 * last session_info.name. Also peeks for an agent-xpto-parent marker and
 * surfaces its parent session id on the returned item when present.
 */
export async function getSessionMetadata(filepath: string): Promise<SessionListItem> {
  const header = await parseSessionHeader(filepath);
  const stat = await fsp.stat(filepath);
  let messageCount = 0;
  let preview = "";
  let previewDone = false;
  let name: string | null = null;
  for await (const entry of iterateSession(filepath)) {
    if (entry.type === "message") {
      messageCount++;
      if (!previewDone && entry.message.role === "user") {
        const txt = textFromContent(entry.message.content);
        if (txt.trim().length > 0) {
          preview = txt.length > PREVIEW_MAX ? txt.slice(0, PREVIEW_MAX) : txt;
          previewDone = true;
        }
      }
    } else if (entry.type === "session_info") {
      if (typeof entry.name === "string") name = entry.name;
    }
  }
  const parentSession = await peekParentMarker(filepath);
  const item: SessionListItem = {
    id: header.id,
    cwd: header.cwd,
    name,
    createdAt: header.timestamp,
    lastActivity: stat.mtime.toISOString(),
    messageCount,
    sizeBytes: stat.size,
    preview,
  };
  if (parentSession !== null) item.parentSession = parentSession;
  return item;
}

// ---------------------------------------------------------------------------
// Chain walking
// ---------------------------------------------------------------------------

/**
 * Walk the active branch from the chosen leaf down to the root.
 * - Excludes the session header entry.
 * - Picks the highest-id leaf deterministically (8-char hex ids sort lexically).
 * - Excludes orphaned entries (unreachable from any leaf).
 * - Drops everything older than a compaction on the branch (the compaction
 *   represents summarized history).
 *
 * Result is leaf-first: index 0 is the leaf, last index is the deepest
 * reachable ancestor that we kept.
 */
export function walkActiveBranch(entries: SessionEntry[]): SessionEntry[] {
  const chainEntries = entries.filter((e) => e.type !== "session");
  if (chainEntries.length === 0) return [];

  // Index entries by id.
  const byId = new Map<string, SessionEntry>();
  // Index by parentId for leaf detection.
  const childrenByParent = new Map<string, SessionEntry[]>();
  for (const e of chainEntries) {
    byId.set(e.id, e);
    if (e.parentId != null) {
      let arr = childrenByParent.get(e.parentId);
      if (!arr) {
        arr = [];
        childrenByParent.set(e.parentId, arr);
      }
      arr.push(e);
    }
  }

  // Leaves = entries whose id is not referenced by any other entry's parentId
  // AND whose ancestry is complete (the walk back to parentId:null resolves
  // without hitting an unknown id). Entries that point to a non-existent parent
  // are orphans and excluded.
  const parentIds = new Set<string>();
  for (const e of chainEntries) {
    if (e.parentId != null) parentIds.add(e.parentId);
  }
  const candidateLeaves = chainEntries.filter((e) => !parentIds.has(e.id));
  const leaves: SessionEntry[] = [];
  for (const candidate of candidateLeaves) {
    // Walk back to root; only count it as a leaf if every parentId resolves.
    let cur: SessionEntry | undefined = candidate;
    const seenHere = new Set<string>();
    let reachable = true;
    while (cur && !seenHere.has(cur.id)) {
      seenHere.add(cur.id);
      if (cur.type === "session") break;
      if (cur.parentId == null) break;
      const next: SessionEntry | undefined = byId.get(cur.parentId);
      if (!next) {
        reachable = false;
        break;
      }
      cur = next;
    }
    if (reachable) leaves.push(candidate);
  }

  if (leaves.length === 0) return [];
  // Deterministic leaf pick: highest id.
  leaves.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const leaf = leaves[leaves.length - 1];

  // Walk from leaf to root. The leaf and all entries reachable via parentId
  // are guaranteed non-session (we filtered those out above), so they have
  // parentId available.
  const path: SessionEntry[] = [];
  const seen = new Set<string>();
  let cur: SessionEntry | undefined = leaf;
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id);
    path.push(cur);
    if (cur.type === "session") break;
    if (cur.parentId == null) break;
    cur = byId.get(cur.parentId);
  }

  // Compaction handling: if a compaction is on the branch, drop everything
  // older than it (ancestors of the compaction are summarized).
  // path is leaf-first, so the compaction will appear somewhere in the middle
  // if it exists; everything after it (older entries) should be dropped.
  const compactIdx = path.findIndex((e) => e.type === "compaction");
  if (compactIdx !== -1) {
    return path.slice(0, compactIdx + 1);
  }
  return path;
}

// ---------------------------------------------------------------------------
// Discovery
// ---------------------------------------------------------------------------

async function* walkJsonl(dir: string): AsyncGenerator<string> {
  let dirents: fs.Dirent[];
  try {
    dirents = await fsp.readdir(dir, { withFileTypes: true });
  } catch (err: unknown) {
    if (err && typeof err === "object" && "code" in err && (err as { code?: string }).code === "ENOENT") {
      return;
    }
    throw err;
  }
  for (const d of dirents) {
    const full = path.join(dir, d.name);
    if (d.isDirectory()) {
      yield* walkJsonl(full);
    } else if (d.isFile() && d.name.endsWith(".jsonl")) {
      yield full;
    }
  }
}

/**
 * List all sessions in `dir` (defaults to SESSIONS_DIR), sorted by
 * lastActivity descending. Missing dir → [].
 */
export async function listSessions(dir: string = SESSIONS_DIR): Promise<SessionListItem[]> {
  const files: string[] = [];
  for await (const f of walkJsonl(dir)) files.push(f);

  const out: SessionListItem[] = [];
  // Simple bounded concurrency: process in chunks of LIST_CONCURRENCY.
  let i = 0;
  while (i < files.length) {
    const slice = files.slice(i, i + LIST_CONCURRENCY);
    i += slice.length;
    const results = await Promise.all(slice.map((f) => getSessionMetadata(f).catch((err) => {
      console.error(`[listSessions] failed to read ${f}:`, err);
      return null;
    })));
    for (const r of results) if (r) out.push(r);
  }
  out.sort((a, b) => (a.lastActivity < b.lastActivity ? 1 : a.lastActivity > b.lastActivity ? -1 : 0));
  return out;
}

// ---------------------------------------------------------------------------
// Session index (id -> filepath, refreshed when listing)
// ---------------------------------------------------------------------------

export class SessionIndex {
  private byId = new Map<string, string>(); // sessionId -> filepath
  private byMtime = new Map<string, number>(); // filepath -> mtimeMs
  private byParent = new Map<string, string[]>(); // parentSessionId -> child sessionIds
  private lastBuild = 0;
  private currentDir: string;

  constructor(dir: string) {
    this.currentDir = dir;
  }

  setDir(dir: string) {
    if (dir !== this.currentDir) {
      this.currentDir = dir;
      this.byId.clear();
      this.byMtime.clear();
      this.byParent.clear();
      this.lastBuild = 0;
    }
  }

  async rebuild(): Promise<void> {
    this.byId.clear();
    this.byMtime.clear();
    this.byParent.clear();
    const files: string[] = [];
    for await (const f of walkJsonl(this.currentDir)) files.push(f);

    const tasks = files.map(async (filepath) => {
      try {
        const stat = await fsp.stat(filepath);
        const header = await parseSessionHeader(filepath);
        const parentSessionId = await peekParentMarker(filepath);
        return { filepath, mtime: stat.mtimeMs, id: header.id, parentSessionId };
      } catch (err) {
        console.error(`[SessionIndex] skipping ${filepath}:`, err);
        return null;
      }
    });
    const results = await Promise.all(tasks);
    for (const r of results) {
      if (!r) continue;
      this.byId.set(r.id, r.filepath);
      this.byMtime.set(r.filepath, r.mtime);
      if (r.parentSessionId !== null) {
        let arr = this.byParent.get(r.parentSessionId);
        if (!arr) {
          arr = [];
          this.byParent.set(r.parentSessionId, arr);
        }
        arr.push(r.id);
      }
    }
    this.lastBuild = Date.now();
  }

  async getChildren(parentId: string): Promise<string[]> {
    return this.byParent.get(parentId) ?? [];
  }

  async getFilepath(sessionId: string): Promise<string | null> {
    const cached = this.byId.get(sessionId);
    if (cached) {
      // Verify file hasn't disappeared; if mtime changed, rebuild on next miss.
      try {
        const stat = await fsp.stat(cached);
        const knownMtime = this.byMtime.get(cached);
        if (knownMtime !== stat.mtimeMs) {
          // mtime changed; rebuild before serving.
          await this.rebuild();
          return this.byId.get(sessionId) ?? null;
        }
        return cached;
      } catch {
        await this.rebuild();
        return this.byId.get(sessionId) ?? null;
      }
    }
    await this.rebuild();
    return this.byId.get(sessionId) ?? null;
  }
}

// ---------------------------------------------------------------------------
// HTTP request handling
// ---------------------------------------------------------------------------

function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(text),
    "cache-control": "no-store",
  });
  res.end(text);
}

function sendText(res: http.ServerResponse, status: number, body: string): void {
  res.writeHead(status, {
    "content-type": "text/plain; charset=utf-8",
    "content-length": Buffer.byteLength(body),
  });
  res.end(body);
}

function parseUrl(req: http.IncomingMessage): URL {
  const host = req.headers.host ?? `127.0.0.1:${PORT}`;
  return new URL(req.url ?? "/", `http://${host}`);
}

export async function readBody(filepath: string): Promise<SessionDetail> {
  const headerObj = await parseSessionHeader(filepath);
  const entries: SessionEntry[] = [];
  for await (const e of iterateSession(filepath)) entries.push(e);
  const branch = walkActiveBranch(entries);
  const stats = computeSessionStats(branch);
  return {
    header: {
      id: headerObj.id,
      version: headerObj.version,
      timestamp: headerObj.timestamp,
      cwd: headerObj.cwd,
      parentSession: headerObj.parentSession,
    },
    branch,
    totalEntries: entries.length,
    filePath: filepath,
    stats,
  };
}

// ---------------------------------------------------------------------------
// SSE streaming
// ---------------------------------------------------------------------------

interface SseClient {
  res: http.ServerResponse;
  filepath: string;
  offset: number;
  /** All entries parsed so far (byte 0 through `offset`). Used to recompute the active branch + stats on each new entry. */
  entries: SessionEntry[];
  watcher?: fs.FSWatcher;
  pollTimer?: NodeJS.Timeout;
  fallbackTimer?: NodeJS.Timeout;
  stopped: boolean;
}

function sseSend(res: http.ServerResponse, event: string, data: unknown): void {
  const payload = typeof data === "string" ? data : JSON.stringify(data);
  res.write(`event: ${event}\n`);
  // Split data on newlines (SSE requires each line prefixed with "data: ")
  for (const line of payload.split("\n")) {
    res.write(`data: ${line}\n`);
  }
  res.write("\n");
}

function startSse(client: SseClient): void {
  const { res, filepath } = client;

  // Open file handle for reading new bytes from offset.
  let fd: number | null = null;
  try {
    fd = fs.openSync(filepath, "r");
  } catch (err) {
    sseSend(res, "error", { message: `cannot open file: ${String(err)}` });
    res.end();
    return;
  }

  // Populate client.entries with every entry from byte 0 up to client.offset
  // so stats recomputation always sees the full known history.
  if (client.offset > 0) {
    try {
      const buf = Buffer.alloc(client.offset);
      const n = fs.readSync(fd, buf, 0, buf.length, 0);
      for (const line of buf.subarray(0, n).toString("utf8").split("\n")) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const obj = JSON.parse(trimmed) as SessionEntry;
          if (obj && typeof obj === "object" && typeof (obj as { type?: unknown }).type === "string") {
            client.entries.push(obj);
          }
        } catch {
          // Skip malformed lines, mirroring iterateSession's tolerance.
        }
      }
    } catch (err) {
      console.error("[sse] failed to read initial entries:", err);
    }
  }

  // Read available bytes from offset; returns updated offset and any new lines.
  const readNewLines = (): void => {
    if (client.stopped) return;
    let stat: fs.Stats;
    try {
      stat = fs.fstatSync(fd!);
    } catch (err) {
      sseSend(res, "error", { message: `stat failed: ${String(err)}` });
      return;
    }
    if (stat.size < client.offset) {
      // File truncated; reset to 0.
      client.offset = 0;
    }
    if (stat.size === client.offset) return;
    const buf = Buffer.alloc(stat.size - client.offset);
    let n = 0;
    try {
      n = fs.readSync(fd!, buf, 0, buf.length, client.offset);
    } catch (err) {
      sseSend(res, "error", { message: `read failed: ${String(err)}` });
      return;
    }
    client.offset += n;
    const text = buf.subarray(0, n).toString("utf8");
    // Track last incomplete line — only parse complete lines.
    const lastNl = text.lastIndexOf("\n");
    const complete = lastNl === -1 ? "" : text.slice(0, lastNl);
    if (complete.length > 0) {
      for (const line of complete.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const obj = JSON.parse(trimmed) as SessionEntry;
          if (obj && typeof obj === "object" && typeof (obj as { type?: unknown }).type === "string") {
            client.entries.push(obj);
            const branch = walkActiveBranch(client.entries);
            const stats = computeSessionStats(branch);
            sseSend(res, "entry", { entry: obj, stats });
          }
        } catch (err) {
          console.error("[sse] parse error:", err, "line:", trimmed.slice(0, 200));
        }
      }
    }
    // Reset fallback timer since we saw activity.
    resetFallback();
  };

  const resetFallback = (): void => {
    if (client.fallbackTimer) clearTimeout(client.fallbackTimer);
    client.fallbackTimer = setTimeout(() => {
      // No fs.watch event in 1.5s — switch to polling.
      startPolling();
    }, SSE_POLL_FALLBACK_MS);
  };

  const startPolling = (): void => {
    if (client.pollTimer || client.stopped) return;
    client.pollTimer = setInterval(() => {
      readNewLines();
    }, SSE_POLL_INTERVAL_MS);
  };

  // fs.watch is unreliable on macOS — use it but fall back to polling.
  try {
    client.watcher = fs.watch(filepath, { persistent: false }, () => {
      readNewLines();
    });
    client.watcher.on("error", (err) => {
      console.error("[sse] watcher error:", err);
    });
  } catch (err) {
    console.error("[sse] failed to watch:", err);
  }

  // Polling fallback (always on as a safety net on top of fs.watch).
  startPolling();

  // Emit ready event.
  sseSend(res, "ready", { fromOffset: client.offset });
  // Try once in case there's already data waiting (e.g. resume from offset).
  readNewLines();
  resetFallback();

  // Close handler.
  res.on("close", () => {
    client.stopped = true;
    if (client.watcher) {
      try {
        client.watcher.close();
      } catch {
        /* ignore */
      }
    }
    if (client.pollTimer) clearInterval(client.pollTimer);
    if (client.fallbackTimer) clearTimeout(client.fallbackTimer);
    if (fd != null) {
      try {
        fs.closeSync(fd);
      } catch {
        /* ignore */
      }
    }
  });
}

// ---------------------------------------------------------------------------
// Handler factory
// ---------------------------------------------------------------------------

export interface HandlerOptions {
  sessionsDir?: string;
  index?: SessionIndex;
  serveStatic?: boolean;
  staticRoot?: string;
}

export function createHandler(opts: HandlerOptions = {}): (req: http.IncomingMessage, res: http.ServerResponse) => void {
  const sessionsDir = opts.sessionsDir ?? SESSIONS_DIR;
  const index = opts.index ?? new SessionIndex(sessionsDir);
  if (opts.sessionsDir) index.setDir(opts.sessionsDir);
  const serveStatic = opts.serveStatic ?? false;
  const staticRoot = opts.staticRoot ?? path.join(import.meta.dirname ?? process.cwd(), "dist");

  return async (req: http.IncomingMessage, res: http.ServerResponse) => {
    const url = parseUrl(req);
    const method = req.method ?? "GET";

    // CORS (for local dev convenience).
    res.setHeader("access-control-allow-origin", "*");

    try {
      // --- API routes -------------------------------------------------------
      if (url.pathname === "/api/sessions" && method === "GET") {
        const list = await listSessions(sessionsDir);
        // Refresh index opportunistically.
        void index.rebuild().catch(() => {});
        return sendJson(res, 200, list);
      }

      const childrenMatch = url.pathname.match(/^\/api\/sessions\/([^/]+)\/children$/);
      if (childrenMatch && method === "GET") {
        const id = decodeURIComponent(childrenMatch[1]);
        const filepath = await index.getFilepath(id);
        if (!filepath) return sendJson(res, 404, { error: "session not found" });
        const children = await index.getChildren(id);
        return sendJson(res, 200, { parent: id, children });
      }

      const detailMatch = url.pathname.match(/^\/api\/sessions\/([^/]+)$/);
      if (detailMatch && method === "GET") {
        const id = decodeURIComponent(detailMatch[1]);
        const filepath = await index.getFilepath(id);
        if (!filepath) return sendJson(res, 404, { error: "session not found" });
        const detail = await readBody(filepath);
        return sendJson(res, 200, detail);
      }

      const streamMatch = url.pathname.match(/^\/api\/sessions\/([^/]+)\/stream$/);
      if (streamMatch && method === "GET") {
        const id = decodeURIComponent(streamMatch[1]);
        const filepath = await index.getFilepath(id);
        if (!filepath) return sendJson(res, 404, { error: "session not found" });
        let stat: fs.Stats;
        try {
          stat = await fsp.stat(filepath);
        } catch {
          return sendJson(res, 404, { error: "session file missing" });
        }
        const fromParam = url.searchParams.get("from");
        let offset = stat.size;
        if (fromParam != null) {
          const n = parseInt(fromParam, 10);
          if (!Number.isNaN(n) && n >= 0) offset = n;
        }
        res.writeHead(200, {
          "content-type": "text/event-stream; charset=utf-8",
          "cache-control": "no-store",
          connection: "keep-alive",
          "x-accel-buffering": "no",
        });
        res.write(": ok\n\n");
        const client: SseClient = { res, filepath, offset, entries: [], stopped: false };
        startSse(client);
        return;
      }

      // --- Health -----------------------------------------------------------
      if (url.pathname === "/api/health" && method === "GET") {
        return sendJson(res, 200, { ok: true, sessionsDir });
      }

      // --- Shutdown ---------------------------------------------------------
      // POST /api/shutdown — stops the HTTP server. Used by the dashboard's
      // Off button to terminate the server from the browser. Only POST is
      // accepted. Mirrors the task-manager pattern.
      if (url.pathname === "/api/shutdown" && method === "POST") {
        if (shutdownHandler) {
          // Schedule the close AFTER we send the response so the client
          // gets a clean 200 before the socket goes away. The handler
          // itself does `server.close()` + `closeAllConnections?.()`.
          shutdownHandler();
        }
        return sendJson(res, 200, { ok: true });
      }

      // --- Static -----------------------------------------------------------
      if (serveStatic && !url.pathname.startsWith("/api/")) {
        return serveStaticFile(res, url.pathname, staticRoot);
      }

      // Default: 404 for non-API in dev, plain text.
      return sendJson(res, 404, { error: "not found" });
    } catch (err) {
      console.error("[handler] error:", err);
      if (!res.headersSent) sendJson(res, 500, { error: String(err) });
      else {
        try {
          res.end();
        } catch {
          /* ignore */
        }
      }
    }
  };
}

async function serveStaticFile(res: http.ServerResponse, pathname: string, root: string): Promise<void> {
  // Resolve a safe path under root.
  let rel = pathname === "/" ? "/index.html" : pathname;
  const target = path.normalize(path.join(root, rel));
  if (!target.startsWith(path.normalize(root) + path.sep) && target !== path.normalize(root)) {
    return sendText(res, 403, "forbidden");
  }
  try {
    const stat = await fsp.stat(target);
    if (!stat.isFile()) return sendText(res, 404, "not found");
    const buf = await fsp.readFile(target);
    const ext = path.extname(target).toLowerCase();
    const ct =
      ext === ".html"
        ? "text/html; charset=utf-8"
        : ext === ".js"
          ? "application/javascript; charset=utf-8"
          : ext === ".css"
            ? "text/css; charset=utf-8"
            : ext === ".json"
              ? "application/json; charset=utf-8"
              : ext === ".svg"
                ? "image/svg+xml"
                : "application/octet-stream";
    res.writeHead(200, { "content-type": ct, "content-length": buf.length });
    res.end(buf);
  } catch {
    sendText(res, 404, "not found");
  }
}

// ---------------------------------------------------------------------------
// Server factory
// ---------------------------------------------------------------------------

export function createServer(opts: HandlerOptions = {}): http.Server {
  return http.createServer(createHandler(opts));
}

// ---------------------------------------------------------------------------
// Entry point (only when run directly, not when imported by tests)
// ---------------------------------------------------------------------------

const isMain = (() => {
  try {
    if (typeof import.meta.url !== "string") return false;
    const url = new URL(import.meta.url);
    const argv1 = process.argv[1] ? path.resolve(process.argv[1]) : "";
    return url.pathname === argv1 || url.pathname.endsWith(path.basename(argv1));
  } catch {
    return false;
  }
})();

if (isMain) {
  const hasDist = fs.existsSync(path.join(import.meta.dirname ?? process.cwd(), "dist"));
  const serveStatic = process.env.NODE_ENV === "production" || hasDist;
  const server = createServer({ serveStatic });

  // Wire the `/api/shutdown` route to actually close this server. The
  // route returns 200 first; this fires synchronously after the response
  // is queued. `closeAllConnections?.()` forces keep-alive sockets shut
  // immediately so the port is freed without waiting for idle timeouts.
  shutdownHandler = () => {
    server.close((err) => {
      if (err) {
        // eslint-disable-next-line no-console
        console.error(`[session-dashboard] shutdown error on :${PORT}:`, err);
      }
    });
    server.closeAllConnections?.();
  };

  server.listen(PORT, "127.0.0.1", () => {
    console.log(`session-dashboard backend listening on http://127.0.0.1:${PORT}`);
    console.log(`Reading sessions from ${SESSIONS_DIR}`);
    if (serveStatic) {
      console.log(`Serving static files from dist/`);
    } else {
      console.log(`(dev mode: no static files; set NODE_ENV=production or build dist/ to serve UI)`);
    }
  });
}

// Suppress unused-import warning for randomUUID (kept for future use).
void randomUUID;
