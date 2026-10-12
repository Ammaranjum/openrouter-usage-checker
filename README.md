# OpenRouter Usage Checker

A GNOME Shell panel indicator (top-right) that shows how much OpenRouter credit
is left on one API key.

## Installation

```bash
git clone https://github.com/Ammaranjum/openrouter-usage-checker
cd openrouter-usage-checker
./install.sh                    # installs without a key
./install.sh sk-or-v1-...       # installs and saves your API key
```

Then log out and back in — the panel indicator appears automatically.

To remove:
```bash
./uninstall.sh
```

```
OR $1.42          # credits remaining (amber ≤30 %, red ≤10 %)
OR $3.58 used     # key has no credit cap, so total spend is shown
```

Works on GNOME 45–48. Verified on GNOME Shell 46.0 (Ubuntu 24.04, Wayland).

## Install

```bash
git clone https://github.com/Ammaranjum/openrouter-usage-checker.git
cd openrouter-usage-checker
./install.sh sk-or-v1-your-key-here
```

Then **log out and log back in.** That is required, not optional: GNOME Shell
imports the extension's code and its environment only once per session, and on
Wayland there is no way to hot-reload them.

No git? Use the release zip instead:

```bash
unzip openrouter-usage-checker.zip
cd openrouter-usage-checker
./install.sh sk-or-v1-your-key-here
```

### Requirements

- GNOME Shell 45, 46, 47 or 48
- An OpenRouter API key ([create one](https://openrouter.ai/settings/keys))
- `gnome-extensions` (ships with GNOME)

## How the key is read

The extension reads **only** the `OPENROUTER_API_KEY` environment variable.
There is no keyring, no config file, no GUI prompt, and no import from other
apps.

`install.sh` writes the key to `~/.config/environment.d/openrouter.conf`:

```bash
OPENROUTER_API_KEY=sk-or-v1-...
```

This is the only place that reliably reaches GNOME Shell. Adding an `export` to
`~/.profile` or `~/.bashrc` does **not** work — the shell is started by the
systemd user session, not by your login shell.

To change the key later, edit that file and log out/in again:

```bash
$EDITOR ~/.config/environment.d/openrouter.conf
```

## Use

Click the `OR $x.xx` label in the top-right panel:

- **Refresh now** — poll the API immediately (otherwise every 120 s)
- **Open OpenRouter API keys page**

## Diagnostics

State changes are logged, so:

```bash
journalctl _COMM=gnome-shell --no-pager | grep openrouter-usage-checker
```

Healthy session looks like:

```
[openrouter-usage-checker@local] enabled
[openrouter-usage-checker@local] Tracking sk-or-v1-32a...787 (OPENROUTER_API_KEY).
```

If you see `OPENROUTER_API_KEY environment variable is not set.` then the
variable did not reach the shell — check `~/.config/environment.d/openrouter.conf`
exists and that you logged out/in after creating it.

## Uninstall

```bash
./uninstall.sh
```

Removes the extension and the saved key, then log out/in.

## Development

Only `extension.js` and `metadata.json` are needed at runtime. The rest is for
building and testing:

| file | purpose |
|------|---------|
| `extension.js` | the indicator |
| `metadata.json` | extension metadata |
| `install.sh` / `uninstall.sh` | user-facing setup and teardown |
| `tests/logic-check.mjs` | out-of-process check of GI bindings, live API call, rendering |

Check the logic without restarting the shell:

```bash
gjs -m tests/logic-check.mjs
```

It asserts every `GLib`/`Gio`/`Soup` symbol used actually exists (so a typo
fails here instead of at shell startup), performs a live `GET /api/v1/key`, and
verifies the rendering rules — including the uncapped-key case.

### Changing the code

GNOME Shell imports `extension.js` **once per session**. Toggling the extension
re-runs `enable()`/`disable()` but does *not* re-read the file, and on a
production shell `org.gnome.Shell.Eval` and `ReloadExtension` are both
unavailable.

**After editing: log out and back in (or reboot).** On X11, `Alt`+`F2` → `r`
also works.

## Notes on the API

- `/api/v1/key` is used. `/api/v1/credits` is deliberately **not** used: it
  requires a *management* key and answers `403` for normal inference keys.
- A key with no credit cap reports `limit` / `limit_remaining` as `null`. That
  is valid, so spend is shown instead of failing.
