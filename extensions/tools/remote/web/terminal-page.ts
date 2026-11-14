import { XTERM_SCRIPTS, XTERM_STYLESHEET } from "./assets.ts";
import { SHARED_STYLES } from "./shared-styles.ts";
import { TERMINAL_CLIENT_SCRIPT } from "./terminal-client.ts";

const TERMINAL_STYLES = `
body {
	display: grid;
	grid-template-rows: auto minmax(0, 1fr) auto;
	grid-template-columns: minmax(0, 1fr);
	height: 100dvh;
	width: 100vw;
	padding: env(safe-area-inset-top, 0px) env(safe-area-inset-right, 0px) env(safe-area-inset-bottom, 0px) env(safe-area-inset-left, 0px);
	overflow: hidden;
}
.bar {
	display: flex;
	align-items: center;
	gap: 10px;
	padding: 6px 12px;
	border-bottom: 1px solid var(--line);
	background: var(--panel);
	font-size: 12px;
	white-space: nowrap;
	min-width: 0;
}
.bar .title { font-weight: 600; }
.bar .meta { color: var(--muted); }
.bar .spacer { flex: 1; }
.dot { width: 8px; height: 8px; border-radius: 50%; background: var(--muted); }
.dot[data-state="live"] { background: var(--ok); }
.dot[data-state="connecting"] { background: var(--warn); }
.dot[data-state="offline"], .dot[data-state="closed"] { background: var(--bad); }
#stage { position: relative; min-height: 0; min-width: 0; overflow: hidden; padding: 4px; }
#term { height: 100%; width: 100%; overflow: hidden; display: flex; justify-content: center; }
#term .xterm { height: 100%; }
.keys {
	display: none;
	align-items: center;
	gap: 6px;
	padding: 6px 8px;
	border-top: 1px solid var(--line);
	background: var(--panel);
}
.keys .scroll { display: flex; gap: 6px; overflow-x: auto; flex: 1; min-width: 0; }
.keys button { flex: 0 0 auto; padding: 8px 12px; }
.keys .send { background: var(--accent); color: var(--bg); border: 0; font-weight: 600; padding: 8px 16px; }
@media (pointer: coarse) {
	.keys { display: flex; }
	.bar .meta.optional { display: none; }
}
`;

const KEY_BUTTONS: readonly (readonly [string, string])[] = [
	["esc", "Esc"],
	["ctrl", "Ctrl"],
	["tab", "Tab"],
	["stab", "⇧Tab"],
	["up", "↑"],
	["down", "↓"],
	["left", "←"],
	["right", "→"],
	["ctrlc", "^C"],
	["pgup", "PgUp"],
	["pgdn", "PgDn"],
];

function scriptTag(asset: { url: string; integrity: string }): string {
	return `<script src="${asset.url}" integrity="${asset.integrity}" crossorigin="anonymous"></script>`;
}

export function renderTerminalPage(nonce: string): string {
	const keys = KEY_BUTTONS.map(([key, label]) => `<button type="button" data-key="${key}" aria-pressed="false">${label}</button>`).join("");
	return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover, interactive-widget=resizes-content">
<meta name="robots" content="noindex">
<title>pi remote</title>
<link rel="stylesheet" href="${XTERM_STYLESHEET.url}" integrity="${XTERM_STYLESHEET.integrity}" crossorigin="anonymous">
<style>${SHARED_STYLES}${TERMINAL_STYLES}</style>
</head>
<body>
<header class="bar">
	<span id="status" class="dot" data-state="connecting"></span>
	<span class="title">pi</span>
	<span id="size" class="meta"></span>
	<span id="renderer" class="meta optional"></span>
	<span class="spacer"></span>
	<button id="fit" type="button" aria-pressed="false" title="Resize pi to this window instead of mirroring the local terminal">Fit</button>
	<button id="lock" type="button" title="Sign out">Lock</button>
</header>
<main id="stage"><div id="term"></div></main>
<nav class="keys" aria-label="Terminal keys"><div class="scroll">${keys}</div><button type="button" class="send" data-key="send" aria-pressed="false">Send</button></nav>
${XTERM_SCRIPTS.map(scriptTag).join("\n")}
<script nonce="${nonce}">${TERMINAL_CLIENT_SCRIPT}</script>
</body>
</html>`;
}
