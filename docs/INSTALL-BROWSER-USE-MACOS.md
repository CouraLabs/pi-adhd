# Installing and connecting `browser-use` on macOS

Steps used to install `browser-use` with `uv` (Python 3.12), register its agent
skill, and connect it to the local Google Chrome on this Mac.

This machine:

| Item | Value |
| --- | --- |
| macOS | 27.0.1 (build 26A434), Darwin 27.0.0, arm64 |
| Google Chrome | 154.0.8037.98 (`/Applications/Google Chrome.app`) |
| Terminal | iTerm.app (`com.googlecode.iterm2`) |
| `uv` | 0.10.9 (`~/.local/bin/uv`) |
| Python used | 3.12.13 (managed by uv) |
| `browser-use` | 0.13.11 (latest stable) |
| `browser-harness` CLI | 0.1.13 (bundled; this is the string `browser-use --version` prints) |

> `browser-use --version` prints `0.1.13` (the bundled harness CLI version), not
> the PyPI package version. Confirm the package with `uv tool list`.

---

## 1. Install `browser-use` with uv on Python 3.12

```bash
uv tool install "browser-use" --python 3.12 --upgrade
```

`--python 3.12` prevents uv from resolving an old release that still supports
older Pythons. This installs five executables into `~/.local/bin`:

`browser-use`, `browser`, `browser-use-tui`, `browseruse`, `bu`

Verify:

```bash
export PATH="$HOME/.local/bin:$PATH"
uv tool list                 # -> browser-use v0.13.11
~/.local/share/uv/tools/browser-use/bin/python3.12 --version   # -> Python 3.12.13
```

## 2. Register the agent skill

```bash
browser-use skill install --target agents
```

Installs to `~/.agents/skills/browser-use/SKILL.md`.

- The default target is `all`, which writes `SKILL.md` into **every** assistant
  directory (`~/.claude`, `~/.codex`, `~/.copilot`, `~/.cursor`, `~/.gemini`,
  `~/.openclaw`, `~/.config/opencode`). Use `--target agents` when the agent
  reads `~/.agents/skills/` (pi does) to avoid polluting unused directories.
- `skill install` also runs `uv tool install --python 3.12 --upgrade --force
  browser-use` itself. Pass `--no-install` to skip that re-install.
- Agents scan skills at startup, so restart the agent for the skill to appear.

## 3. Enable Chrome remote debugging (one-time, manual)

Chrome will not expose CDP to other tools until this checkbox is ticked. It is
intentionally a manual step and cannot be automated (CDP is not available until
it is enabled, so the harness cannot click it).

1. Open `chrome://inspect/#remote-debugging`.
2. Tick **"Allow remote debugging for this browser instance"**.

```bash
open -a "Google Chrome" "chrome://inspect/#remote-debugging"
```

After ticking it, Chrome writes its endpoint to:

```
~/Library/Application Support/Google/Chrome/DevToolsActivePort
```

which looks like:

```
9222
/devtools/browser/41101360-25b0-4636-ab9d-6dbe295a5872
```

## 4. Fix the macOS 26+ TCC blocker (the step that actually mattered here)

The harness initially failed with:

```
fatal: [Errno 1] Operation not permitted:
'/Users/<you>/Library/Application Support/Google/Chrome/DevToolsActivePort'
```

This is **not** a `browser-use` bug. On macOS 26+, the OS protects another app's
data via `kTCCServiceSystemPolicyAppData`. The responsible app here is the
terminal (iTerm), and it is denied read access to Chrome's profile directory.
Confirm with the system log:

```bash
log show --last 15m --style compact --predicate 'subsystem == "com.apple.TCC"' \
  | grep -i -E "iTerm|SystemPolicyAppData"
```

You will see a prompt for access to `Google Chrome.app` by `iTerm.app`.

Why this also breaks `browser-use mac-approve`: `mac-approve` reads Chrome's
`Local State` file to check the toggle, so it fails for the same TCC reason and
reports `setup-required`.

Why the harness needs the file at all: Chrome 147+ disables the `/json/*` HTTP
discovery endpoints on the default profile (they return `404`), so the harness
reads the websocket path from `DevToolsActivePort`.

### Fix

Grant the **app that launches `browser-use`** (iTerm here) Full Disk Access:

1. Open **System Settings → Privacy & Security → Full Disk Access**:

   ```bash
   open "x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles"
   ```

2. Click **+**, add `/Applications/iTerm.app`, and turn its toggle **ON**.

On this machine the grant took effect immediately (no iTerm restart needed).
If it does not for you, quit and reopen the terminal — then re-run step 5.

> If you invoke `browser-use` from a different terminal or IDE (VS Code,
> Ghostty, Terminal, etc.), that app needs the same grant.

## 5. Connect to the running browser

```bash
export PATH="$HOME/.local/bin:$PATH"
browser-use <<'PY'
print(page_info())
PY
```

If Chrome shows a per-connection **"Allow remote debugging?"** sheet, either
click **Allow** or, without bringing Chrome forward:

```bash
browser-use mac-approve
```

`mac-approve` also requires the launching app to have **Accessibility**
permission (System Settings → Privacy & Security → Accessibility) and is
macOS-only.

## 6. Verify

```bash
browser-use --doctor
```

Expected (healthy) output:

```
  platform          Darwin 27.0.0
  python            3.12.13
  version           0.1.13 (pypi)
  latest release    0.1.13
  [ok  ] chrome running
  [ok  ] daemon alive
  [ok  ] active browser connections — 1
        default — active page: <your page>
  [FAIL] Browser Use cloud auth — optional: browser-harness auth login
```

The cloud-auth `FAIL` is expected and harmless for local Chrome; it only
matters if you want remote/cloud browsers.

## 7. Recording consent (optional)

`browser-use` can save local screenshots and action traces, which may include
sensitive page content.

```bash
browser-use recordings            # show state
browser-use recordings disable    # persist "off" (chosen here)
browser-use recordings enable     # opt in
```

This machine is set to `auto-recording: off (config)`.

---

## Quick reference

```bash
# install / upgrade
uv tool install "browser-use" --python 3.12 --upgrade

# register skill for agents reading ~/.agents/skills/
browser-use skill install --target agents

# one-time Chrome opt-in
open -a "Google Chrome" "chrome://inspect/#remote-debugging"   # tick the checkbox

# one-time macOS permission
open "x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles"
# add + enable iTerm (or your terminal/IDE)

# connect + verify
browser-use <<'PY'
print(page_info())
PY
browser-use --doctor
```

## Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| `Operation not permitted` reading `DevToolsActivePort` | macOS TCC app-data protection | Grant the launching app Full Disk Access (step 4) |
| `mac-approve` says `setup-required` | Toggle not ticked, or TCC blocks reading `Local State` | Tick the `chrome://inspect` checkbox; fix Full Disk Access |
| `mac-approve` says `accessibility-required` | Launching app lacks Accessibility permission | Grant it in Privacy & Security → Accessibility |
| `chrome-not-running` | No Chromium-family browser is running | Start Chrome and retry |
| `permission-blocked` | Chrome's per-session Allow sheet is pending | Click Allow, or run `browser-use mac-approve` |
| `daemon alive` FAIL | Remote debugging not enabled / CDP unreachable | Retry steps 3–5 |
| `/json/version` returns `404` | Expected on Chrome 147+ default profile | Not an error; harness falls back to `DevToolsActivePort` |

Useful paths and commands:

```bash
~/.agents/skills/browser-use/SKILL.md                 # registered skill
~/.config/browser-harness/tmp/bu-default.log          # daemon log
~/.config/browser-harness/                            # auth, state, screenshots
browser-use --reload                                  # restart daemon
browser-use --update -y                               # upgrade
```

Reference: <https://github.com/browser-use/browser-harness/blob/main/install.md>
