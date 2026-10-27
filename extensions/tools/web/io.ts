const IO_TIMEOUT_MS = 30_000;

export function ioTimeoutSignal(signal?: AbortSignal): AbortSignal {
	const timeout = AbortSignal.timeout(IO_TIMEOUT_MS);
	return signal ? AbortSignal.any([signal, timeout]) : timeout;
}
