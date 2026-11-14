export const TERMINAL_CLIENT_SCRIPT = `
(() => {
	const stage = document.getElementById("stage");
	const host = document.getElementById("term");
	const statusDot = document.getElementById("status");
	const sizeLabel = document.getElementById("size");
	const rendererLabel = document.getElementById("renderer");
	const fitButton = document.getElementById("fit");
	const lockButton = document.getElementById("lock");
	const ctrlButton = document.querySelector('[data-key="ctrl"]');

	const KEYS = {
		esc: "\\x1b", tab: "\\t", stab: "\\x1b[Z", send: "\\r", ctrlc: "\\x03",
		up: "\\x1b[A", down: "\\x1b[B", right: "\\x1b[C", left: "\\x1b[D",
		pgup: "\\x1b[5~", pgdn: "\\x1b[6~",
	};
	const TOUCH = matchMedia("(pointer: coarse)").matches;
	const BASE_FONT = TOUCH ? 13 : 14;
	const storage = {
		get(key) { try { return localStorage.getItem(key); } catch { return null; } },
		set(key, value) { try { localStorage.setItem(key, value); } catch {} },
	};

	const term = new Terminal({
		allowProposedApi: true,
		cursorBlink: true,
		fontFamily: getComputedStyle(document.documentElement).getPropertyValue("--mono"),
		fontSize: BASE_FONT,
		lineHeight: 1,
		scrollback: 10000,
		macOptionIsMeta: true,
		theme: { background: "#0b0e12", foreground: "#d7dae0", cursor: "#d7dae0", selectionBackground: "#2d3f5f" },
	});
	const unicode = new Unicode11Addon.Unicode11Addon();
	term.loadAddon(unicode);
	term.unicode.activeVersion = "11";
	const fitAddon = new FitAddon.FitAddon();
	term.loadAddon(fitAddon);
	term.open(host);

	const useDomRenderer = () => { rendererLabel.textContent = "dom"; };
	const wantsDom = new URLSearchParams(location.search).get("renderer") === "dom";
	if (wantsDom) useDomRenderer();
	else try {
		const webgl = new WebglAddon.WebglAddon();
		webgl.onContextLoss(() => { webgl.dispose(); useDomRenderer(); });
		term.loadAddon(webgl);
		rendererLabel.textContent = "webgl";
	} catch {
		useDomRenderer();
	}

	let mode = storage.get("pi-remote-mode") === "fit" ? "fit" : "mirror";
	let serverSize = { cols: term.cols, rows: term.rows };
	let remoteControlled = false;
	let socket;
	let retry = 0;
	let ctrlArmed = false;

	const send = (message) => {
		if (socket && socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
	};

	const setStatus = (state) => {
		statusDot.dataset.state = state;
		statusDot.title = state;
	};

	const renderSizeLabel = () => {
		sizeLabel.textContent = serverSize.cols + "×" + serverSize.rows + (remoteControlled ? " · web-sized" : "");
	};

	const scaleToMirror = () => {
		if (mode !== "mirror") return;
		const screen = host.querySelector(".xterm-screen");
		if (!screen) return;
		const availableWidth = stage.clientWidth - 8;
		const availableHeight = stage.clientHeight - 8;
		const width = screen.offsetWidth;
		const height = screen.offsetHeight;
		if (!width || !height || availableWidth <= 0 || availableHeight <= 0) return;
		const current = term.options.fontSize;
		const scale = Math.min(availableWidth / width, availableHeight / height);
		const next = Math.max(4, Math.min(24, Math.floor(current * scale * 4) / 4));
		if (Math.abs(next - current) >= 0.25) {
			term.options.fontSize = next;
			requestAnimationFrame(scaleToMirror);
		}
	};

	const proposeFit = () => {
		if (mode !== "fit") return;
		const dimensions = fitAddon.proposeDimensions();
		if (dimensions && dimensions.cols > 0 && dimensions.rows > 0) {
			send({ type: "resize", cols: dimensions.cols, rows: dimensions.rows });
		}
	};

	const scheduleFit = () => requestAnimationFrame(() => requestAnimationFrame(proposeFit));

	const applyServerSize = (message) => {
		serverSize = { cols: message.cols, rows: message.rows };
		remoteControlled = message.remoteControlled;
		if (term.cols !== serverSize.cols || term.rows !== serverSize.rows) term.resize(serverSize.cols, serverSize.rows);
		renderSizeLabel();
		requestAnimationFrame(scaleToMirror);
	};

	const setMode = (next) => {
		mode = next;
		storage.set("pi-remote-mode", mode);
		fitButton.setAttribute("aria-pressed", String(mode === "fit"));
		if (mode === "fit") {
			term.options.fontSize = BASE_FONT;
			scheduleFit();
		} else {
			send({ type: "release" });
			requestAnimationFrame(scaleToMirror);
		}
		term.focus();
	};

	const withCtrl = (data) => {
		if (!ctrlArmed || data.length !== 1) return data;
		ctrlArmed = false;
		ctrlButton.setAttribute("aria-pressed", "false");
		const code = data.toUpperCase().charCodeAt(0);
		return code >= 64 && code <= 95 ? String.fromCharCode(code - 64) : data;
	};

	const enterAsNewline = (data) => (TOUCH ? data.replace(/\\r/g, "\\n") : data);

	const sendInput = (data) => send({ type: "input", data: enterAsNewline(withCtrl(data)) });

	const checkSession = async () => {
		try {
			const response = await fetch("/api/session", { credentials: "same-origin", cache: "no-store" });
			if (response.status === 401) location.replace("/");
		} catch {}
	};

	const connect = () => {
		setStatus("connecting");
		const scheme = location.protocol === "https:" ? "wss://" : "ws://";
		socket = new WebSocket(scheme + location.host + "/ws");
		socket.binaryType = "arraybuffer";
		socket.onopen = () => {
			retry = 0;
			setStatus("live");
			scheduleFit();
		};
		socket.onmessage = (event) => {
			if (typeof event.data !== "string") {
				term.write(new Uint8Array(event.data));
				return;
			}
			const message = JSON.parse(event.data);
			if (message.type === "size") applyServerSize(message);
			if (message.type === "closed") setStatus("closed");
		};
		socket.onclose = () => {
			if (statusDot.dataset.state === "closed") return;
			setStatus("offline");
			checkSession();
			setTimeout(connect, Math.min(10000, 500 * 2 ** retry++));
		};
	};

	term.onData(sendInput);
	term.onBinary((data) => send({ type: "input", data }));

	fitButton.addEventListener("click", () => setMode(mode === "fit" ? "mirror" : "fit"));
	lockButton.addEventListener("click", async () => {
		await fetch("/logout", { method: "POST", credentials: "same-origin" }).catch(() => {});
		location.replace("/");
	});

	for (const button of document.querySelectorAll("[data-key]")) {
		button.addEventListener("pointerdown", (event) => event.preventDefault());
		button.addEventListener("click", () => {
			const key = button.dataset.key;
			if (key === "ctrl") {
				ctrlArmed = !ctrlArmed;
				button.setAttribute("aria-pressed", String(ctrlArmed));
				term.focus();
				return;
			}
			send({ type: "input", data: KEYS[key] });
			term.focus();
		});
	}

	stage.addEventListener("click", () => term.focus());
	new ResizeObserver(() => {
		if (mode === "fit") scheduleFit();
		else scaleToMirror();
	}).observe(stage);

	setMode(mode);
	connect();
})();
`;
