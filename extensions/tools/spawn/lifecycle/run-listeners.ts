export class RunListeners {
	private unsub?: () => void;
	private detach?: () => void;

	wireSignal(signal: AbortSignal | undefined, onAbort: () => void): void {
		if (!signal) return;
		if (signal.aborted) {
			onAbort();
			return;
		}
		const listener = () => onAbort();
		signal.addEventListener("abort", listener, { once: true });
		this.detach = () => signal.removeEventListener("abort", listener);
	}

	attachObserver(unsub: () => void): void {
		this.unsub = unsub;
	}

	release(): void {
		this.unsub?.();
		this.unsub = undefined;
		this.detach?.();
		this.detach = undefined;
	}
}
