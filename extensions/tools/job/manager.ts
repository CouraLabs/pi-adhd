/**
 * job/manager — in-memory registry of background terminal commands.
 *
 * A job is a shell command started with `spawn(..., { shell: true })` whose
 * stdout and stderr are captured line by line while it runs. Nothing is
 * persisted: the registry lives in the extension factory's closure and is
 * emptied by `disposeAll()` from the idempotent `session_shutdown` handler, so
 * a reload or a session replacement never leaks a running process.
 *
 * The registry is deliberately small: a bounded number of jobs and a bounded
 * number of captured lines per job. `job-read` returns the tail, so the model
 * sees recent output without the extension growing without limit.
 */

import { spawn, type ChildProcess } from "node:child_process";
import { clamp } from "../../../shared/util.ts";

/** Lifecycle state of a job. */
export type JobStatus = "running" | "exited" | "failed" | "killed" | "timeout";

/** A job as the tools and commands see it (no live process handle). */
export interface JobView {
	id: string;
	name: string;
	command: string;
	cwd: string;
	status: JobStatus;
	exitCode: number | null;
	signal: NodeJS.Signals | null;
	startedAt: number;
	endedAt?: number;
	error?: string;
	/** Number of captured lines, including an unterminated trailing line. */
	lineCount: number;
	/** Most recent captured line, or "" before the command writes anything. */
	lastLine: string;
}

interface Job extends JobView {
	child: ChildProcess;
	lines: string[];
	/** Bytes after the last newline, not yet a complete line. */
	partial: string;
	timeoutHandle?: NodeJS.Timeout;
}

/** Arguments accepted by {@link JobManager.start}. */
export interface StartJobInput {
	name: string;
	command: string;
	/** Working directory the command runs in. */
	cwd: string;
	/** Kill the job after this many seconds. */
	timeoutSeconds?: number;
}

/** Cap on live entries in the registry. Finished jobs are pruned first. */
const MAX_JOBS = 100;
/** Cap on captured lines per job; older lines are dropped. */
const MAX_LINES = 2000;
/** Lines returned by `job-read` when the caller does not ask for a count. */
export const DEFAULT_READ_LINES = 50;
/** Upper bound on the `lines` argument of `job-read`. */
export const MAX_READ_LINES = 500;

function now(): number {
	return Date.now();
}

export class JobManager {
	private readonly jobs = new Map<string, Job>();
	private counter = 0;

	/**
	 * Start a command and resolve once the process has actually spawned. A
	 * spawn failure (missing cwd, no shell) rejects and leaves no entry behind;
	 * a command that exits immediately still resolves, because it did start.
	 */
	async start(input: StartJobInput): Promise<JobView> {
		this.prune();
		if (this.jobs.size >= MAX_JOBS) {
			throw new Error(
				`Job limit reached (${MAX_JOBS}). Kill a job with job-kill before starting another.`,
			);
		}

		const id = `job-${++this.counter}`;
		// Validate the timeout before spawning: a rejected value must not leave a
		// process running with no registry entry to reach it through.
		const timeoutMs =
			input.timeoutSeconds !== undefined ? Math.round(input.timeoutSeconds * 1000) : undefined;
		if (timeoutMs !== undefined && (!Number.isFinite(timeoutMs) || timeoutMs <= 0)) {
			throw new Error("Invalid timeout: must be a positive number of seconds");
		}
		// A detached process is its own process-group leader, so the whole
		// command tree can be signalled with a negative pid. Windows has no
		// process groups, so taskkill /T is used there instead.
		const detached = process.platform !== "win32";
		const child = spawn(input.command, {
			shell: true,
			cwd: input.cwd,
			env: process.env,
			detached,
			windowsHide: true,
		});

		const job: Job = {
			id,
			name: input.name,
			command: input.command,
			cwd: input.cwd,
			status: "running",
			exitCode: null,
			signal: null,
			startedAt: now(),
			lineCount: 0,
			lastLine: "",
			child,
			lines: [],
			partial: "",
		};
		this.jobs.set(id, job);

		child.stdout?.setEncoding("utf8");
		child.stderr?.setEncoding("utf8");
		child.stdout?.on("data", (chunk: string) => this.append(job, chunk));
		child.stderr?.on("data", (chunk: string) => this.append(job, chunk));
		child.on("error", (error: Error) => {
			job.status = "failed";
			job.error = error.message;
			this.finalize(job, null, null);
		});
		child.on("close", (code: number | null, signal: NodeJS.Signals | null) => this.finalize(job, code, signal));

		if (timeoutMs !== undefined) {
			job.timeoutHandle = setTimeout(() => {
				job.status = "timeout";
				this.killProcess(job);
			}, timeoutMs);
			// A pending job timeout must never keep the host process alive.
			job.timeoutHandle.unref?.();
		}

		try {
			await new Promise<void>((resolve, reject) => {
				child.once("spawn", () => resolve());
				child.once("error", (error: Error) => reject(error));
			});
		} catch (error) {
			// Disarm the timeout before forgetting the entry: an orphaned handle
			// would later fire `killProcess` on a job object nothing tracks.
			if (job.timeoutHandle) clearTimeout(job.timeoutHandle);
			this.jobs.delete(id);
			throw error;
		}

		return this.view(job);
	}

	/** Stop a job, close its process, and remove it from the registry. */
	kill(jobId: string): JobView {
		const job = this.jobs.get(jobId);
		if (!job) throw new Error(this.unknownJobMessage(jobId));
		if (job.status === "running") {
			job.status = "killed";
			this.killProcess(job);
		}
		// Disarm the timeout: the entry leaves the registry, so the pending
		// callback would fire on a dead object and signal a possibly recycled pid.
		if (job.timeoutHandle) {
			clearTimeout(job.timeoutHandle);
			job.timeoutHandle = undefined;
		}
		const view = this.view(job);
		this.jobs.delete(jobId);
		return view;
	}

	/** The last `lines` captured lines of a job, plus its current state. */
	read(jobId: string, lines?: number): { job: JobView; lines: string[] } {
		const job = this.jobs.get(jobId);
		if (!job) throw new Error(this.unknownJobMessage(jobId));
		const count = clamp(Math.trunc(lines ?? DEFAULT_READ_LINES), 1, MAX_READ_LINES);
		const all = job.partial.length > 0 ? [...job.lines, job.partial] : job.lines;
		return { job: this.view(job), lines: all.slice(-count) };
	}

	/** Every job in the registry, oldest first. */
	list(): JobView[] {
		return [...this.jobs.values()].map((job) => this.view(job));
	}

	/** Kill every running job and forget them all. Idempotent. */
	disposeAll(): void {
		for (const job of this.jobs.values()) {
			if (job.timeoutHandle) clearTimeout(job.timeoutHandle);
			if (job.status === "running") {
				job.status = "killed";
				this.killProcess(job);
			}
		}
		this.jobs.clear();
	}

	// ── internals ──────────────────────────────────────────────────────────

	private append(job: Job, chunk: string): void {
		const text = job.partial + chunk;
		const parts = text.split("\n");
		job.partial = parts.pop() ?? "";
		for (const raw of parts) {
			const line = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
			job.lines.push(line);
		}
		if (job.lines.length > MAX_LINES) job.lines.splice(0, job.lines.length - MAX_LINES);
		this.refresh(job);
	}

	/** Freeze a job's terminal state. Idempotent: the first event wins. */
	private finalize(job: Job, code: number | null, signal: NodeJS.Signals | null): void {
		if (job.endedAt !== undefined) return;
		if (job.timeoutHandle) {
			clearTimeout(job.timeoutHandle);
			job.timeoutHandle = undefined;
		}
		if (job.partial.length > 0) {
			job.lines.push(job.partial);
			job.partial = "";
			if (job.lines.length > MAX_LINES) job.lines.splice(0, job.lines.length - MAX_LINES);
		}
		job.endedAt = now();
		job.exitCode = code;
		job.signal = signal;
		if (job.status === "running") job.status = code === 0 ? "exited" : "failed";
		this.refresh(job);
	}

	/**
	 * Signal the process group. SIGTERM first, then SIGKILL if the process is
	 * still alive shortly after. A job that already exited makes the signal
	 * throw ESRCH, which is the success case here.
	 */
	private killProcess(job: Job): void {
		const pid = job.child.pid;
		if (pid === undefined) return;
		if (process.platform === "win32") {
			const killer = spawn("taskkill", ["/pid", String(pid), "/T", "/F"], {
				stdio: "ignore",
				windowsHide: true,
			});
			killer.on("error", () => {});
			return;
		}
		try {
			process.kill(-pid, "SIGTERM");
		} catch {
			// Already gone.
			return;
		}
		const escalation = setTimeout(() => {
			try {
				process.kill(-pid, "SIGKILL");
			} catch {
				// Already gone.
			}
		}, 2000);
		escalation.unref?.();
	}

	private refresh(job: Job): void {
		job.lineCount = job.lines.length + (job.partial.length > 0 ? 1 : 0);
		job.lastLine = job.partial.length > 0 ? job.partial : (job.lines[job.lines.length - 1] ?? "");
	}

	private view(job: Job): JobView {
		return {
			id: job.id,
			name: job.name,
			command: job.command,
			cwd: job.cwd,
			status: job.status,
			exitCode: job.exitCode,
			signal: job.signal,
			startedAt: job.startedAt,
			endedAt: job.endedAt,
			error: job.error,
			lineCount: job.lineCount,
			lastLine: job.lastLine,
		};
	}

	/** Drop finished jobs, oldest first, to keep room under the cap. */
	private prune(): void {
		if (this.jobs.size < MAX_JOBS) return;
		for (const [id, job] of this.jobs) {
			if (job.status === "running") continue;
			this.jobs.delete(id);
			if (this.jobs.size < MAX_JOBS) return;
		}
	}

	private unknownJobMessage(jobId: string): string {
		const known = this.list().map((job) => job.id);
		const suffix = known.length > 0 ? ` Known jobs: ${known.join(", ")}.` : " There are no jobs.";
		return `No job "${jobId}".${suffix}`;
	}
}
