import { randomBytes } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { Duplex } from "node:stream";
import { RemoteAuth, SESSION_COOKIE } from "./auth.ts";
import type { TerminalBridge } from "./terminal-bridge.ts";
import { attachTerminalSocket } from "./terminal-socket.ts";
import { CDN_ORIGIN } from "./web/assets.ts";
import { renderLoginPage } from "./web/login-page.ts";
import { renderTerminalPage } from "./web/terminal-page.ts";
import { acceptWebSocket, type WebSocketConnection } from "./websocket.ts";

const MAX_BODY_BYTES = 4096;
const SESSION_MAX_AGE_SECONDS = 7 * 24 * 60 * 60;

export interface RemoteHttpHandler {

	readonly auth: RemoteAuth;

	addTrustedHost(host: string): void;

	closeConnections(): void;

	listen(port: number, address: string): Promise<Server>;
}

function isHttps(request: IncomingMessage): boolean {
	return request.headers["x-forwarded-proto"] === "https" || /"scheme":"https"/.test(String(request.headers["cf-visitor"] ?? ""));
}

function securityHeaders(nonce: string): Record<string, string> {
	return {
		"content-security-policy": [
			"default-src 'none'",
			`script-src 'nonce-${nonce}' ${CDN_ORIGIN}`,
			`style-src 'unsafe-inline' ${CDN_ORIGIN}`,
			"connect-src 'self'",
			"img-src 'self' data:",
			"font-src 'self' data:",
			"base-uri 'none'",
			"form-action 'self'",
			"frame-ancestors 'none'",
		].join("; "),
		"x-frame-options": "DENY",
		"x-content-type-options": "nosniff",
		"referrer-policy": "no-referrer",
		"cache-control": "no-store",
	};
}

function sendHtml(response: ServerResponse, render: (nonce: string) => string): void {
	const nonce = randomBytes(16).toString("base64");
	response.writeHead(200, { "content-type": "text/html; charset=utf-8", ...securityHeaders(nonce) });
	response.end(render(nonce));
}

function sendStatus(response: ServerResponse, status: number, body = ""): void {
	response.writeHead(status, { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" });
	response.end(body);
}

function readBody(request: IncomingMessage): Promise<string> {
	return new Promise((resolve, reject) => {
		let body = "";
		request.setEncoding("utf8");
		request.on("data", (chunk: string) => {
			body += chunk;
			if (body.length > MAX_BODY_BYTES) {
				reject(new Error("body too large"));
				request.destroy();
			}
		});
		request.on("end", () => resolve(body));
		request.on("error", reject);
	});
}

function extractPassword(body: string, contentType: string | undefined): string {
	if (contentType?.includes("application/json")) {
		const parsed: unknown = JSON.parse(body);
		const password = (parsed as { password?: unknown }).password;
		return typeof password === "string" ? password : "";
	}
	return new URLSearchParams(body).get("password") ?? "";
}

function sessionCookie(token: string, secure: boolean, maxAge: number): string {
	return [`${SESSION_COOKIE}=${token}`, "Path=/", "HttpOnly", "SameSite=Strict", `Max-Age=${maxAge}`, ...(secure ? ["Secure"] : [])].join("; ");
}

function originHost(request: IncomingMessage): string | undefined {
	const origin = request.headers.origin;
	if (!origin) return undefined;
	try {
		return new URL(origin).host;
	} catch {
		return undefined;
	}
}

export function createRemoteHttpHandler(password: string, bridge: TerminalBridge): RemoteHttpHandler {
	const auth = new RemoteAuth(password);
	const trustedHosts = new Set<string>();
	const connections = new Set<WebSocketConnection>();

	const isSameOrigin = (request: IncomingMessage): boolean => {
		const host = originHost(request);
		if (!host) return false;
		const forwarded = request.headers["x-forwarded-host"];
		return host === request.headers.host || host === forwarded || trustedHosts.has(host);
	};

	const handleLogin = async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
		if (auth.isLockedOut) {
			sendStatus(response, 429, "locked");
			return;
		}
		let password = "";
		try {
			password = extractPassword(await readBody(request), request.headers["content-type"]);
		} catch {
			sendStatus(response, 400, "bad request");
			return;
		}
		const token = auth.login(password);
		if (!token) {
			sendStatus(response, auth.isLockedOut ? 429 : 401, "denied");
			return;
		}
		response.writeHead(204, { "set-cookie": sessionCookie(token, isHttps(request), SESSION_MAX_AGE_SECONDS), "cache-control": "no-store" });
		response.end();
	};

	const onRequest = (request: IncomingMessage, response: ServerResponse): void => {
		const path = new URL(request.url ?? "/", "http://localhost").pathname;
		if (request.method === "GET" && path === "/healthz") return sendStatus(response, 200, "ok");
		if (request.method === "POST" && path === "/login") {
			handleLogin(request, response).catch(() => sendStatus(response, 500));
			return;
		}
		if (request.method === "POST" && path === "/logout") {
			auth.logout(request);
			response.writeHead(204, { "set-cookie": sessionCookie("", isHttps(request), 0) });
			response.end();
			return;
		}
		if (request.method === "GET" && path === "/api/session") {
			return sendStatus(response, auth.isAuthorized(request) ? 200 : 401);
		}
		if (request.method === "GET" && path === "/") {
			sendHtml(response, auth.isAuthorized(request) ? renderTerminalPage : renderLoginPage);
			return;
		}
		sendStatus(response, 404, "not found");
	};

	const onUpgrade = (request: IncomingMessage, socket: Duplex, head: Buffer): void => {
		const path = new URL(request.url ?? "/", "http://localhost").pathname;
		if (path !== "/ws" || !auth.isAuthorized(request) || !isSameOrigin(request)) {
			socket.end("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
			return;
		}
		const connection = acceptWebSocket(request, socket, head);
		if (!connection) {
			socket.end("HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n");
			return;
		}
		connections.add(connection);
		connection.onClose(() => connections.delete(connection));
		attachTerminalSocket(connection, bridge);
	};

	return {
		auth,
		addTrustedHost: (host) => trustedHosts.add(host),
		closeConnections: () => {
			for (const connection of [...connections]) {
				connection.sendText(JSON.stringify({ type: "closed" }));
				connection.close();
			}
		},
		listen: (port, address) =>
			new Promise((resolve, reject) => {
				const server = createServer(onRequest);
				server.on("upgrade", onUpgrade);
				server.once("error", reject);
				server.listen(port, address, () => {
					server.off("error", reject);
					resolve(server);
				});
			}),
	};
}
