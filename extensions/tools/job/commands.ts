/**
 * job/commands — the `/job`, `/job-kill`, `/job-read`, and `/job-list`
 * commands. They are thin wrappers over the same {@link JobManager} the tools
 * use, so a job started from the prompt and one started from a command are
 * indistinguishable afterwards.
 *
 * `/job` takes the job name first and the command after it:
 *
 *   /job <name> <command...>
 *   /job --timeout <seconds> <name> <command...>
 *
 * `--timeout` is optional and only honored as the leading token, so a command
 * that itself begins with `--` is unaffected.
 */

import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import type { AutocompleteItem } from "@earendil-works/pi-tui";
import { DEFAULT_READ_LINES, MAX_READ_LINES, type JobManager } from "./manager.ts";

const USAGE = [
	"Usage:",
	"  /job <name> <command...>              Start a background job",
	"  /job --timeout <seconds> <name> <cmd> Start a job that is killed after the timeout",
	"  /job-kill <jobId>                     Stop a job and forget it",
	`  /job-read <jobId> [lines]             Show the last lines (default ${DEFAULT_READ_LINES}, max ${MAX_READ_LINES})`,
	"  /job-list                             List jobs in memory",
].join("\n");

/** Headless-safe output: notify in dialog-capable UIs, stderr text elsewhere. */
function emit(ctx: ExtensionCommandContext, text: string, severity: "info" | "warning" | "error" = "info"): void {
	if (ctx.hasUI) {
		ctx.ui.notify(text, severity);
		return;
	}
	console.error(text);
}

interface StartArgs {
	name: string;
	command: string;
	timeoutSeconds?: number;
}

/** Parse `/job [--timeout <sec>] <name> <command...>`. */
function parseStart(rest: string): StartArgs | { error: string } {
	let text = rest.trim();
	if (!text) return { error: USAGE };

	let timeoutSeconds: number | undefined;
	const timeout = text.match(/^--timeout\s+(\S+)\s+/);
	if (timeout) {
		timeoutSeconds = Number(timeout[1]);
		if (!Number.isFinite(timeoutSeconds) || timeoutSeconds <= 0) {
			return { error: `Invalid --timeout "${timeout[1]}": expected a positive number of seconds.` };
		}
		text = text.slice(timeout[0].length).trim();
	}

	const split = text.search(/\s/);
	if (split === -1) {
		return { error: `Missing command. ${USAGE}` };
	}
	const name = text.slice(0, split);
	const command = text.slice(split + 1).trim();
	if (!command) return { error: `Missing command. ${USAGE}` };
	return { name, command, timeoutSeconds };
}

/** Complete job ids for the commands that take one. */
function jobIdCompletions(manager: JobManager): (prefix: string) => AutocompleteItem[] {
	return (prefix: string) => {
		const needle = prefix.trim();
		return manager
			.list()
			.filter((job) => job.id.startsWith(needle))
			.map((job) => ({ value: job.id, label: job.id, description: `${job.status} · ${job.name}` }));
	};
}

export function registerJobCommands(pi: ExtensionAPI, manager: JobManager): void {
	pi.registerCommand("job", {
		description: "Start a background job (usage: /job <name> <command...>)",
		handler: async (args: string, ctx: ExtensionCommandContext): Promise<void> => {
			const parsed = parseStart(args);
			if ("error" in parsed) {
				emit(ctx, parsed.error, "error");
				return;
			}
			try {
				const job = await manager.start({
					name: parsed.name,
					command: parsed.command,
					cwd: ctx.cwd,
					timeoutSeconds: parsed.timeoutSeconds,
				});
				const suffix = parsed.timeoutSeconds !== undefined ? ` (timeout ${parsed.timeoutSeconds}s)` : "";
				emit(ctx, `Started ${job.id} "${job.name}"${suffix}: ${job.command}`);
			} catch (error) {
				emit(ctx, `Failed to start job: ${error instanceof Error ? error.message : String(error)}`, "error");
			}
		},
	});

	pi.registerCommand("job-kill", {
		description: "Stop a background job by id",
		getArgumentCompletions: jobIdCompletions(manager),
		handler: async (args: string, ctx: ExtensionCommandContext): Promise<void> => {
			const jobId = args.trim();
			if (!jobId) {
				emit(ctx, "Usage: /job-kill <jobId>", "error");
				return;
			}
			try {
				const job = manager.kill(jobId);
				emit(ctx, `Killed ${job.id} "${job.name}".`);
			} catch (error) {
				emit(ctx, error instanceof Error ? error.message : String(error), "error");
			}
		},
	});

	pi.registerCommand("job-read", {
		description: "Read the latest output of a background job",
		getArgumentCompletions: jobIdCompletions(manager),
		handler: async (args: string, ctx: ExtensionCommandContext): Promise<void> => {
			const tokens = args.trim().split(/\s+/).filter(Boolean);
			const jobId = tokens[0];
			if (!jobId) {
				emit(ctx, `Usage: /job-read <jobId> [lines] (default ${DEFAULT_READ_LINES}, max ${MAX_READ_LINES})`, "error");
				return;
			}
			const requested = tokens[1] !== undefined ? Number(tokens[1]) : undefined;
			if (requested !== undefined && (!Number.isFinite(requested) || requested <= 0)) {
				emit(ctx, `Invalid line count "${tokens[1]}".`, "error");
				return;
			}
			try {
				const { job, lines } = manager.read(jobId, requested);
				const header = `${job.id} "${job.name}" · ${job.status}${
					job.exitCode !== null ? ` · exit ${job.exitCode}` : ""
				}`;
				const body = lines.length > 0 ? lines.join("\n") : "(no output yet)";
				emit(ctx, `${header}\n${body}`);
			} catch (error) {
				emit(ctx, error instanceof Error ? error.message : String(error), "error");
			}
		},
	});

	pi.registerCommand("job-list", {
		description: "List background jobs held in memory",
		handler: async (_args: string, ctx: ExtensionCommandContext): Promise<void> => {
			const jobs = manager.list();
			if (jobs.length === 0) {
				emit(ctx, "No jobs.");
				return;
			}
			const rows = jobs
				.map((job) => `${job.id}  ${job.status.padEnd(8)}  ${job.name}  ${job.lastLine}`)
				.join("\n");
			emit(ctx, rows);
		},
	});
}
