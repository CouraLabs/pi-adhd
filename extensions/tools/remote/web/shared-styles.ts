export const SHARED_STYLES = `
:root {
	color-scheme: dark;
	--bg: #0b0e12;
	--panel: #12161c;
	--line: #232a33;
	--text: #d7dae0;
	--muted: #7d8590;
	--accent: #7aa2f7;
	--ok: #9ece6a;
	--warn: #e0af68;
	--bad: #f7768e;
	--mono: "JetBrains Mono", "SF Mono", Menlo, Consolas, "DejaVu Sans Mono", monospace;
}
* { box-sizing: border-box; }
html, body { margin: 0; height: 100%; background: var(--bg); color: var(--text); font: 14px/1.4 var(--mono); }
button {
	font: inherit;
	color: var(--text);
	background: var(--panel);
	border: 1px solid var(--line);
	border-radius: 6px;
	padding: 4px 10px;
	cursor: pointer;
	touch-action: manipulation;
}
button:hover { border-color: var(--muted); }
button[aria-pressed="true"] { border-color: var(--accent); color: var(--accent); }
`;
