import { spawn, type ChildProcess } from "node:child_process";
import { clamp } from "../../../shared/util.ts";

export type JobStatus = "running" | "exited" | "failed" | "killed" | "timeout";

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

	lineCount: number;

	lastLine: string;
}

interface Job extends JobView {
	child: ChildProcess;
	lines: string[];

	partial: string;
	timeoutHandle?: NodeJS.Timeout;
}

export interface StartJobInput {
	name: string;
	command: string;

	cwd: string;

	timeoutSeconds?: number;
}

const MAX_JOBS = 100;

const MAX_LINES = 2000;

export const DEFAULT_READ_LINES = 50;

export const MAX_READ_LINES = 500;

function now(): number {
	return Date.now();
}

export class JobManager {
	private readonly jobs = new Map<string, Job>();
	private counter = 0;

	async start(input: StartJobInput): Promise<JobView> {
		this.prune();
		if (this.jobs.size >= MAX_JOBS) {
			throw new Error(
				`Job limit reached (${MAX_JOBS}). Kill a job with job-kill before starting another.`,
			);
		}

		const id = `job-${++this.counter}`;

		const timeoutMs =
			input.timeoutSeconds !== undefined ? Math.round(input.timeoutSeconds * 1000) : undefined;
		if (timeoutMs !== undefined && (!Number.isFinite(timeoutMs) || timeoutMs <= 0)) {
			throw new Error("Invalid timeout: must be a positive number of seconds");
		}

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

			job.timeoutHandle.unref?.();
		}

		try {
			await new Promise<void>((resolve, reject) => {
				child.once("spawn", () => resolve());
				child.once("error", (error: Error) => reject(error));
			});
		} catch (error) {

			if (job.timeoutHandle) clearTimeout(job.timeoutHandle);
			this.jobs.delete(id);
			throw error;
		}

		return this.view(job);
	}

	kill(jobId: string): JobView {
		const job = this.jobs.get(jobId);
		if (!job) throw new Error(this.unknownJobMessage(jobId));
		if (job.status === "running") {
			job.status = "killed";
			this.killProcess(job);
		}

		if (job.timeoutHandle) {
			clearTimeout(job.timeoutHandle);
			job.timeoutHandle = undefined;
		}
		const view = this.view(job);
		this.jobs.delete(jobId);
		return view;
	}

	read(jobId: string, lines?: number): { job: JobView; lines: string[] } {
		const job = this.jobs.get(jobId);
		if (!job) throw new Error(this.unknownJobMessage(jobId));
		const count = clamp(Math.trunc(lines ?? DEFAULT_READ_LINES), 1, MAX_READ_LINES);
		const all = job.partial.length > 0 ? [...job.lines, job.partial] : job.lines;
		return { job: this.view(job), lines: all.slice(-count) };
	}

	list(): JobView[] {
		return [...this.jobs.values()].map((job) => this.view(job));
	}

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

			return;
		}
		const escalation = setTimeout(() => {
			try {
				process.kill(-pid, "SIGKILL");
			} catch {

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
