import type { SyncRecord } from "./session-sync.ts";

export interface SessionHost {
	readonly cwd: string;
	readonly interactive: boolean;
	readonly persistRecord: (record: SyncRecord) => void;
}

const hostsBySession = new Map<string, SessionHost>();
const restoredRecordsBySession = new Map<string, SyncRecord>();

export function registerSessionHost(sessionKey: string, host: SessionHost, restored: SyncRecord | undefined): void {
	hostsBySession.set(sessionKey, host);
	if (restored) restoredRecordsBySession.set(sessionKey, restored);
	else restoredRecordsBySession.delete(sessionKey);
}

export function getSessionHost(sessionKey: string): SessionHost | undefined {
	return hostsBySession.get(sessionKey);
}

export function takeRestoredRecord(sessionKey: string): SyncRecord | undefined {
	const record = restoredRecordsBySession.get(sessionKey);
	restoredRecordsBySession.delete(sessionKey);
	return record;
}
