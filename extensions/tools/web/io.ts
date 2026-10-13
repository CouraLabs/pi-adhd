/**
 * io.ts — Network timeout signal for web requests.
 */

const IO_TIMEOUT_MS = 30_000;

/**
 * A signal that fires when either the caller's signal or the 30s network
 * timeout expires, so a hung connection cannot stall a tool call forever.
 */
export function ioTimeoutSignal(signal?: AbortSignal): AbortSignal {
	const timeout = AbortSignal.timeout(IO_TIMEOUT_MS);
	return signal ? AbortSignal.any([signal, timeout]) : timeout;
}
