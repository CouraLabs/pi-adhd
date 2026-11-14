export type LinkStatus =
	| { readonly state: "disabled" }
	| { readonly state: "starting" }
	| { readonly state: "ready"; readonly url: string }
	| { readonly state: "unavailable"; readonly reason: string };

export interface RemoteSnapshot {

	readonly running: boolean;

	readonly password: string;

	readonly passwordGenerated: boolean;

	readonly local: LinkStatus;

	readonly tailscale: LinkStatus;

	readonly cloudflare: LinkStatus;

	readonly clients: number;
}

function describeLink(status: LinkStatus): string {
	switch (status.state) {
		case "disabled":
			return "off (PI_ADHD_REMOTE_TUNNEL)";
		case "starting":
			return "starting…";
		case "ready":
			return status.url;
		case "unavailable":
			return `unavailable — ${status.reason}`;
	}
}

export function oneTapLink(snapshot: RemoteSnapshot): string | undefined {
	const preferred = [snapshot.cloudflare, snapshot.tailscale, snapshot.local].find((status) => status.state === "ready");
	if (preferred?.state !== "ready") return undefined;
	return `${preferred.url}/#pass=${encodeURIComponent(snapshot.password)}`;
}

export function formatRemoteSnapshot(snapshot: RemoteSnapshot): string {
	if (!snapshot.running) return "pi remote is stopped. Run /couralabs:pi-remote start";
	const passwordNote = snapshot.passwordGenerated ? "  (random — set PI_ADHD_REMOTE_PASS to pin it)" : "  (from PI_ADHD_REMOTE_PASS)";
	const oneTap = oneTapLink(snapshot);
	return [
		"pi remote",
		`  password    ${snapshot.password}${passwordNote}`,
		`  cloudflare  ${describeLink(snapshot.cloudflare)}`,
		`  tailscale   ${describeLink(snapshot.tailscale)}`,
		`  local       ${describeLink(snapshot.local)}`,
		...(oneTap ? [`  one-tap     ${oneTap}`] : []),
		`  clients     ${snapshot.clients} connected`,
	].join("\n");
}
