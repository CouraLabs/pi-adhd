import type {
	Workspace,
	WorkspaceDisposeOutcome,
	WorkspacePrepareContext,
	WorkspaceProvider,
} from "./workspace.ts";

export class WorkspaceBracket {
	private prepared?: Workspace;
	private disposedWorkspace = false;

	constructor(private readonly resolveProvider: () => WorkspaceProvider | undefined) {}

	wasDisposed(): boolean {
		return this.disposedWorkspace;
	}

	hasProvider(): boolean {
		return this.resolveProvider() !== undefined;
	}

	async prepare(ctx: WorkspacePrepareContext): Promise<string | undefined> {
		const provider = this.resolveProvider();
		if (!provider) return undefined;
		this.prepared = await provider.prepare(ctx);
		return this.prepared?.cwd;
	}

	dispose(outcome: WorkspaceDisposeOutcome): string {
		const workspace = this.prepared;
		if (!workspace) return "";
		this.prepared = undefined;
		this.disposedWorkspace = true;
		return workspace.dispose(outcome)?.resultAddendum ?? "";
	}
}
