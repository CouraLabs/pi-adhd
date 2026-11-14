import { describe, expect, it } from "vitest";
import { RemoteAuth } from "../../extensions/tools/remote/auth.ts";
import { DEFAULT_REMOTE_PORT, parsePort, parseTunnels, readRemoteConfig } from "../../extensions/tools/remote/config.ts";
import { formatRemoteSnapshot, oneTapLink, type RemoteSnapshot } from "../../extensions/tools/remote/link-status.ts";
import { parseClientMessage } from "../../extensions/tools/remote/terminal-socket.ts";
import { stripTerminalReplies, TerminalModeTracker } from "../../extensions/tools/remote/terminal-modes.ts";
import { extractQuickTunnelUrl } from "../../extensions/tools/remote/tunnels/cloudflare.ts";
import { cloudflaredAssetName } from "../../extensions/tools/remote/tunnels/cloudflared-binary.ts";
import { parseTailscaleStatus } from "../../extensions/tools/remote/tunnels/tailscale.ts";
import { acceptKey, encodeFrame, parseFrame } from "../../extensions/tools/remote/websocket.ts";
import type { IncomingMessage } from "node:http";

function maskedFrame(opcode: number, payload: Buffer): Buffer {
	const mask = Buffer.from([1, 2, 3, 4]);
	const masked = Buffer.from(payload.map((byte, index) => byte ^ mask[index % 4]!));
	const header = payload.length < 126 ? Buffer.from([0x80 | opcode, 0x80 | payload.length]) : Buffer.from([0x80 | opcode, 0x80 | 126, payload.length >> 8, payload.length & 0xff]);
	return Buffer.concat([header, mask, masked]);
}

describe("remote config", () => {
	it("uses PI_ADHD_REMOTE_PASS when set", () => {
		const config = readRemoteConfig({ PI_ADHD_REMOTE_PASS: "secret" }, () => "random");
		expect(config.password).toBe("secret");
		expect(config.passwordGenerated).toBe(false);
	});

	it("falls back to a generated password", () => {
		const config = readRemoteConfig({}, () => "random");
		expect(config.password).toBe("random");
		expect(config.passwordGenerated).toBe(true);
	});

	it("parses ports and tunnels", () => {
		expect(parsePort("8080")).toBe(8080);
		expect(parsePort("nope")).toBe(DEFAULT_REMOTE_PORT);
		expect([...parseTunnels(undefined)]).toEqual(["cloudflare", "tailscale"]);
		expect([...parseTunnels("none")]).toEqual([]);
		expect([...parseTunnels("tailscale")]).toEqual(["tailscale"]);
	});
});

describe("remote auth", () => {
	const request = (cookie?: string) => ({ headers: { cookie } }) as IncomingMessage;

	it("issues a session for the right password only", () => {
		const auth = new RemoteAuth("pw");
		expect(auth.login("bad")).toBeUndefined();
		const token = auth.login("pw");
		expect(token).toBeTruthy();
		expect(auth.isAuthorized(request(`pi_remote=${token}`))).toBe(true);
		expect(auth.isAuthorized(request("pi_remote=forged"))).toBe(false);
	});

	it("locks out after repeated failures", () => {
		const auth = new RemoteAuth("pw");
		for (let i = 0; i < 10; i++) auth.login("bad");
		expect(auth.isLockedOut).toBe(true);
		expect(auth.login("pw")).toBeUndefined();
	});
});

describe("websocket framing", () => {
	it("computes the RFC 6455 accept key", () => {
		expect(acceptKey("dGhlIHNhbXBsZSBub25jZQ==")).toBe("s3pPLMBiTxaQ9kYGzzhZRbK+xOo=");
	});

	it("parses masked client frames", () => {
		const frame = parseFrame(maskedFrame(1, Buffer.from("hello")));
		expect(frame).not.toBe("incomplete");
		expect(frame).not.toBe("invalid");
		if (typeof frame === "object") expect(frame.payload.toString()).toBe("hello");
	});

	it("handles extended lengths and partial buffers", () => {
		const payload = Buffer.alloc(300, 97);
		const full = maskedFrame(2, payload);
		expect(parseFrame(full.subarray(0, 10))).toBe("incomplete");
		const frame = parseFrame(full);
		if (typeof frame === "object") expect(frame.payload.length).toBe(300);
	});

	it("rejects unmasked client frames", () => {
		expect(parseFrame(encodeFrame(1, Buffer.from("x")))).toBe("invalid");
	});
});

describe("terminal modes", () => {
	it("replays the latest private modes", () => {
		const tracker = new TerminalModeTracker();
		tracker.observe("\x1b[?2004h\x1b[?25l");
		tracker.observe("\x1b[?25h");
		expect(tracker.prelude()).toBe("\x1b[?25h\x1b[?2004h");
	});

	it("strips terminal replies from browser input", () => {
		expect(stripTerminalReplies("a\x1b[?1;2cb\x1b]11;rgb:0/0/0\x07c\x1b[A")).toBe("abc\x1b[A");
	});
});

describe("client messages", () => {
	it("accepts known messages only", () => {
		expect(parseClientMessage('{"type":"input","data":"x"}')).toEqual({ type: "input", data: "x" });
		expect(parseClientMessage('{"type":"resize","cols":80,"rows":24}')).toEqual({ type: "resize", cols: 80, rows: 24 });
		expect(parseClientMessage('{"type":"input","data":1}')).toBeUndefined();
		expect(parseClientMessage("nope")).toBeUndefined();
	});
});

describe("tunnels", () => {
	it("finds the quick tunnel URL in cloudflared logs", () => {
		expect(extractQuickTunnelUrl("INF |  https://brave-cat-12.trycloudflare.com  |")).toBe("https://brave-cat-12.trycloudflare.com");
	});

	it("maps platforms to cloudflared assets", () => {
		expect(cloudflaredAssetName("darwin", "arm64")).toBe("cloudflared-darwin-arm64.tgz");
		expect(cloudflaredAssetName("linux", "x64")).toBe("cloudflared-linux-amd64");
		expect(cloudflaredAssetName("aix", "ppc")).toBeUndefined();
	});

	it("reads the tailnet address from tailscale status", () => {
		const ok = parseTailscaleStatus(JSON.stringify({ BackendState: "Running", Self: { TailscaleIPs: ["100.1.2.3", "fd7a::1"], DNSName: "box.tail1.ts.net." } }));
		expect(ok).toEqual({ ok: true, node: { ipv4: "100.1.2.3", dnsName: "box.tail1.ts.net" } });
		expect(parseTailscaleStatus(JSON.stringify({ BackendState: "NeedsLogin" })).ok).toBe(false);
	});
});

describe("status formatting", () => {
	const snapshot: RemoteSnapshot = {
		running: true,
		password: "p w",
		passwordGenerated: true,
		local: { state: "ready", url: "http://127.0.0.1:53520" },
		tailscale: { state: "unavailable", reason: "Tailscale is not installed" },
		cloudflare: { state: "ready", url: "https://x.trycloudflare.com" },
		clients: 0,
	};

	it("prefers the public link for one-tap access", () => {
		expect(oneTapLink(snapshot)).toBe("https://x.trycloudflare.com/#pass=p%20w");
		expect(formatRemoteSnapshot(snapshot)).toContain("random — set PI_ADHD_REMOTE_PASS");
	});
});
