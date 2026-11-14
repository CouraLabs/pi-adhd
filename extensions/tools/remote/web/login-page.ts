import { SHARED_STYLES } from "./shared-styles.ts";

const LOGIN_STYLES = `
body { display: grid; place-items: center; padding: 16px; }
form { width: min(360px, 100%); display: grid; gap: 14px; }
h1 { margin: 0; font-size: 18px; font-weight: 600; }
h1 span { color: var(--muted); font-weight: 400; }
p { margin: 0; color: var(--muted); }
input {
	font: inherit;
	color: var(--text);
	background: var(--panel);
	border: 1px solid var(--line);
	border-radius: 6px;
	padding: 10px 12px;
	width: 100%;
}
input:focus { outline: none; border-color: var(--accent); }
button[type="submit"] { padding: 10px; background: var(--accent); color: var(--bg); border: 0; font-weight: 600; }
#error { color: var(--bad); min-height: 1.4em; }
`;

const LOGIN_SCRIPT = `
(() => {
	const form = document.getElementById("login");
	const input = document.getElementById("password");
	const error = document.getElementById("error");
	const submit = async () => {
		error.textContent = "";
		const response = await fetch("/login", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ password: input.value }),
			credentials: "same-origin",
		});
		if (response.ok) {
			location.replace(location.pathname + location.search);
			return;
		}
		error.textContent = response.status === 429 ? "Too many attempts. Wait a few minutes." : "Wrong password.";
		input.select();
	};
	form.addEventListener("submit", (event) => {
		event.preventDefault();
		submit().catch(() => { error.textContent = "Could not reach pi."; });
	});
	const loginFromHash = () => {
		const fromLink = new URLSearchParams(location.hash.slice(1)).get("pass");
		if (!fromLink) return;
		history.replaceState(null, "", location.pathname + location.search);
		input.value = fromLink;
		submit().catch(() => {});
	};
	window.addEventListener("hashchange", loginFromHash);
	loginFromHash();
})();
`;

export function renderLoginPage(nonce: string): string {
	return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex">
<title>pi remote</title>
<style nonce="${nonce}">${SHARED_STYLES}${LOGIN_STYLES}</style>
</head>
<body>
<form id="login" autocomplete="on">
	<h1>pi <span>· remote</span></h1>
	<p>Enter the password shown by <code>/couralabs:pi-remote</code>.</p>
	<input id="password" name="password" type="password" autocomplete="current-password" autofocus required>
	<button type="submit">Connect</button>
	<div id="error" role="alert"></div>
</form>
<script nonce="${nonce}">${LOGIN_SCRIPT}</script>
</body>
</html>`;
}
