import type { AgentToolResult } from "@earendil-works/pi-agent-core";
import type { ExtensionAPI, Theme, ToolDefinition, ToolRenderResultOptions } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { Type, type Static } from "typebox";
import { DEFAULT_READ_LINES, MAX_READ_LINES, type JobManager, type JobStatus } from "./manager.ts";

const StartSchema = Type.Object({
	name: Type.String({ description: "Short label for the job, shown by job-list" }),
	command: Type.String({ description: "Shell command to run in the background" }),
	timeout: Type.Optional(Type.Number({ description: "Kill the job after this many seconds (optional)" })),
});

const KillSchema = Type.Object({
	jobId: Type.String({ description: "Job id returned by the job tool" }),
});

const ReadSchema = Type.Object({
	jobId: Type.String({ description: "Job id returned by the job tool" }),
	lines: Type.Optional(
		Type.Number({
			description: `How many trailing lines to return (default ${DEFAULT_READ_LINES}, max ${MAX_READ_LINES})`,
		}),
	),
});

const ListSchema = Type.Object({});

const StartOutputSchema = Type.Object({
	jobId: Type.String(),
	name: Type.String(),
	status: Type.String(),
	timeoutSeconds: Type.Optional(Type.Number()),
});

const KillOutputSchema = Type.Object({
	jobId: Type.String(),
	name: Type.String(),
	status: Type.String(),
});

const ReadOutputSchema = Type.Object({
	jobId: Type.String(),
	name: Type.String(),
	status: Type.String(),
	exitCode: Type.Union([Type.Number(), Type.Null()]),
	lines: Type.Array(Type.String()),
});

const ListOutputSchema = Type.Object({
	jobs: Type.Array(
		Type.Object({
			jobId: Type.String(),
			name: Type.String(),
			status: Type.String(),
			lastLine: Type.String(),
		}),
	),
});

type StartParams = Static<typeof StartSchema>;
type KillParams = Static<typeof KillSchema>;
type ReadParams = Static<typeof ReadSchema>;

interface JobDetails {
	jobId?: string;
	status: JobStatus | "error";

	line: string;
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function textOf(result: AgentToolResult<JobDetails>): string {
	return result.content
		.map((block) => (block.type === "text" ? block.text : ""))
		.join("\n")
		.trim();
}

function failure(message: string, details?: Partial<JobDetails>): AgentToolResult<JobDetails> {
	return {
		content: [{ type: "text", text: message }],
		details: { status: "error", line: message, ...details },
		isError: true,
	};
}

function renderJobResult(
	result: AgentToolResult<JobDetails>,
	theme: Theme,
	successPrefix: string,
): Text {
	if (result.isError) return new Text(theme.fg("error", `✗ ${textOf(result)}`), 0, 0);
	const line = result.details?.line ?? textOf(result);
	return new Text(theme.fg("success", `✓ ${successPrefix} ${line}`), 0, 0);
}

function startTool(manager: JobManager): ToolDefinition<typeof StartSchema, JobDetails> {
	return {
		name: "job",
		label: "Job",
		description:
			"Start a shell command in the background and return its job id immediately. " +
			"Use job-read to inspect its output, job-list to list jobs, and job-kill to stop it. " +
			"Pass `timeout` (seconds) to kill the job automatically.",
		parameters: StartSchema,
		outputSchema: StartOutputSchema,
		executionMode: "sequential",
		renderCall(args: StartParams, theme: Theme): Text {
			const head = theme.fg("toolTitle", theme.bold("Job")) + `  ${theme.fg("muted", args.name)}`;
			return new Text(`${head}\n  ${theme.fg("dim", args.command)}`, 0, 0);
		},
		renderResult(result: AgentToolResult<JobDetails>, _options: ToolRenderResultOptions, theme: Theme): Text {
			return renderJobResult(result, theme, "job");
		},
		async execute(_id, params, _signal, _onUpdate, ctx): Promise<AgentToolResult<JobDetails>> {
			try {
				const job = await manager.start({
					name: params.name,
					command: params.command,
					cwd: ctx.cwd,
					timeoutSeconds: params.timeout,
				});
				const suffix = params.timeout !== undefined ? ` (timeout ${params.timeout}s)` : "";
				return {
					content: [
						{
							type: "text",
							text: `Started ${job.id} "${job.name}"${suffix}: ${job.command}`,
						},
					],
					details: { jobId: job.id, status: job.status, line: `${job.id} "${job.name}"${suffix}` },
					structuredContent: {
						jobId: job.id,
						name: job.name,
						status: job.status,
						...(params.timeout !== undefined ? { timeoutSeconds: params.timeout } : {}),
					},
				};
			} catch (error) {
				return failure(`Failed to start job: ${errorMessage(error)}`);
			}
		},
	};
}

function killTool(manager: JobManager): ToolDefinition<typeof KillSchema, JobDetails> {
	return {
		name: "job-kill",
		label: "JobKill",
		description: "Stop a background job by id, close its process, and remove it from memory.",
		parameters: KillSchema,
		outputSchema: KillOutputSchema,
		executionMode: "sequential",
		renderCall(args: KillParams, theme: Theme): Text {
			return new Text(theme.fg("toolTitle", theme.bold("JobKill")) + `  ${theme.fg("muted", args.jobId)}`, 0, 0);
		},
		renderResult(result: AgentToolResult<JobDetails>, _options: ToolRenderResultOptions, theme: Theme): Text {
			return renderJobResult(result, theme, "job-kill");
		},
		async execute(_id, params): Promise<AgentToolResult<JobDetails>> {
			try {
				const job = manager.kill(params.jobId);
				return {
					content: [{ type: "text", text: `Killed ${job.id} "${job.name}".` }],
					details: { jobId: job.id, status: job.status, line: `${job.id} "${job.name}"` },
					structuredContent: { jobId: job.id, name: job.name, status: job.status },
				};
			} catch (error) {
				return failure(errorMessage(error), { jobId: params.jobId });
			}
		},
	};
}

function readTool(manager: JobManager): ToolDefinition<typeof ReadSchema, JobDetails> {
	return {
		name: "job-read",
		label: "JobRead",
		description:
			"Read the most recent output lines of a background job by id. " +
			`Returns up to ${MAX_READ_LINES} trailing lines (default ${DEFAULT_READ_LINES}) and the job's current status.`,
		parameters: ReadSchema,
		outputSchema: ReadOutputSchema,
		executionMode: "sequential",
		renderCall(args: ReadParams, theme: Theme): Text {
			const count = args.lines !== undefined ? `  ${theme.fg("dim", `${args.lines} lines`)}` : "";
			return new Text(theme.fg("toolTitle", theme.bold("JobRead")) + `  ${theme.fg("muted", args.jobId)}${count}`, 0, 0);
		},
		renderResult(result: AgentToolResult<JobDetails>, _options: ToolRenderResultOptions, theme: Theme): Text {
			return renderJobResult(result, theme, "job-read");
		},
		async execute(_id, params): Promise<AgentToolResult<JobDetails>> {
			try {
				const { job, lines } = manager.read(params.jobId, params.lines);
				const header = `${job.id} "${job.name}" · ${job.status}${
					job.exitCode !== null ? ` · exit ${job.exitCode}` : ""
				}`;
				const body = lines.length > 0 ? lines.join("\n") : "(no output yet)";
				return {
					content: [{ type: "text", text: `${header}\n${body}` }],
					details: {
						jobId: job.id,
						status: job.status,
						line: `${job.id} · ${lines.length} line${lines.length === 1 ? "" : "s"}`,
					},
					structuredContent: {
						jobId: job.id,
						name: job.name,
						status: job.status,
						exitCode: job.exitCode,
						lines,
					},
				};
			} catch (error) {
				return failure(errorMessage(error), { jobId: params.jobId });
			}
		},
	};
}

function listTool(manager: JobManager): ToolDefinition<typeof ListSchema, JobDetails> {
	return {
		name: "job-list",
		label: "JobList",
		description:
			"List the jobs currently held in memory, running and finished, with each job's status and latest output line.",
		parameters: ListSchema,
		outputSchema: ListOutputSchema,
		executionMode: "sequential",
		renderCall(_args: object, theme: Theme): Text {
			return new Text(theme.fg("toolTitle", theme.bold("JobList")), 0, 0);
		},
		renderResult(result: AgentToolResult<JobDetails>, _options: ToolRenderResultOptions, theme: Theme): Text {
			return renderJobResult(result, theme, "job-list");
		},
		async execute(): Promise<AgentToolResult<JobDetails>> {
			const jobs = manager.list();
			const structuredContent = {
				jobs: jobs.map((job) => ({
					jobId: job.id,
					name: job.name,
					status: job.status,
					lastLine: job.lastLine,
				})),
			};
			if (jobs.length === 0) {
				return {
					content: [{ type: "text", text: "No jobs." }],
					details: { status: "exited", line: "0 jobs" },
					structuredContent,
				};
			}
			const rows = jobs
				.map((job) => `${job.id}  ${job.status.padEnd(8)}  ${job.name}  ${job.lastLine}`)
				.join("\n");
			return {
				content: [{ type: "text", text: rows }],
				details: { status: "exited", line: `${jobs.length} job${jobs.length === 1 ? "" : "s"}` },
				structuredContent,
			};
		},
	};
}

export function registerJobTools(pi: ExtensionAPI, manager: JobManager): void {
	pi.registerTool(startTool(manager));
	pi.registerTool(killTool(manager));
	pi.registerTool(readTool(manager));
	pi.registerTool(listTool(manager));
}
