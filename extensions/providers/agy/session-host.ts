import type { AgySyncRecord } from "./identity.ts";

export interface AgySessionHost {
	readonly cwd: string;
	readonly persistRecord: (record: AgySyncRecord) => void;
}

const hostsBySession = new Map<string, AgySessionHost>();
const restoredRecordsBySession = new Map<string, AgySyncRecord>();

export function registerAgySessionHost(sessionKey: string, host: AgySessionHost, restored: AgySyncRecord | undefined): void {
	hostsBySession.set(sessionKey, host);
	if (restored) restoredRecordsBySession.set(sessionKey, restored);
	else restoredRecordsBySession.delete(sessionKey);
}

export function getAgySessionHost(sessionKey: string): AgySessionHost | undefined {
	return hostsBySession.get(sessionKey);
}

export function takeAgyRestoredRecord(sessionKey: string): AgySyncRecord | undefined {
	const record = restoredRecordsBySession.get(sessionKey);
	restoredRecordsBySession.delete(sessionKey);
	return record;
}
