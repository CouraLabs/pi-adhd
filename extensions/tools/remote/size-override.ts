export interface TerminalSize {

	readonly cols: number;

	readonly rows: number;
}

type SizedStream = NodeJS.WriteStream & { columns: number; rows: number };

const MIN_COLS = 20;
const MIN_ROWS = 6;
const MAX_COLS = 500;
const MAX_ROWS = 200;

function clampSize(size: TerminalSize): TerminalSize {
	return {
		cols: Math.min(MAX_COLS, Math.max(MIN_COLS, Math.floor(size.cols))),
		rows: Math.min(MAX_ROWS, Math.max(MIN_ROWS, Math.floor(size.rows))),
	};
}

export class StdoutSizeOverride {

	readonly #stream: SizedStream;

	#localCols: number;

	#localRows: number;

	#override: TerminalSize | undefined;

	#installed = false;

	constructor(stream: NodeJS.WriteStream = process.stdout) {
		this.#stream = stream as SizedStream;
		this.#localCols = this.#stream.columns || 80;
		this.#localRows = this.#stream.rows || 24;
	}

	get size(): TerminalSize {
		return this.#override ?? { cols: this.#localCols, rows: this.#localRows };
	}

	get isOverridden(): boolean {
		return this.#override !== undefined;
	}

	install(): void {
		if (this.#installed) return;
		this.#localCols = this.#stream.columns || this.#localCols;
		this.#localRows = this.#stream.rows || this.#localRows;
		Object.defineProperty(this.#stream, "columns", {
			configurable: true,
			enumerable: true,
			get: () => this.#override?.cols ?? this.#localCols,
			set: (value: number) => {
				this.#localCols = value;
			},
		});
		Object.defineProperty(this.#stream, "rows", {
			configurable: true,
			enumerable: true,
			get: () => this.#override?.rows ?? this.#localRows,
			set: (value: number) => {
				this.#localRows = value;
			},
		});
		this.#installed = true;
	}

	uninstall(): void {
		if (!this.#installed) return;
		this.#override = undefined;
		delete (this.#stream as Partial<SizedStream>).columns;
		delete (this.#stream as Partial<SizedStream>).rows;
		this.#stream.columns = this.#localCols;
		this.#stream.rows = this.#localRows;
		this.#installed = false;
		this.#stream.emit("resize");
	}

	set(size: TerminalSize): void {
		const next = clampSize(size);
		if (this.#override && this.#override.cols === next.cols && this.#override.rows === next.rows) return;
		this.#override = next;
		this.#stream.emit("resize");
	}

	clear(): void {
		if (!this.#override) return;
		this.#override = undefined;
		this.#stream.emit("resize");
	}
}
