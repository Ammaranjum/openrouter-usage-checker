# OpenRouter Usage Checker (GNOME Shell extension)

Top-right panel indicator showing the remaining credits / spend of one OpenRouter
API key. Written for GNOME 45–48; fixed and verified on GNOME Shell 46.0 (Ubuntu 24.04).

## Files

| file | purpose |
|------|---------|
| `extension.js` | the panel indicator |
| `set-key.sh` | store / replace / clear the API key from a terminal |
| `tests/logic-check.mjs` | out-of-process check of keyring, libsoup request, parsing |
| `metadata.json` | extension metadata (`version: 2`) |

## Applying a code change — important on Wayland

GNOME Shell imports an extension's ES module **once per session**. Toggling the
extension re-runs `enable()`/`disable()` but does *not* re-read `extension.js`,
and on a production shell both `org.gnome.Shell.Eval` (unsafe mode) and
`ReloadExtension` are unavailable.

**After editing the code: log out and back in (or reboot).** On an X11 session
`Alt`+`F2` → `r` also works.

The stored API key, however, is picked up by the running indicator on its next
poll (≤120 s) — no restart needed for that.

## Where the key comes from (first match wins)

1. Secret Service / login keyring — attributes `service=openrouter-usage-monitor`, `account=default`
2. `~/.config/openrouter-usage-monitor/api_key` (created `0600` only if the keyring write fails)
3. `OPENROUTER_API_KEY` in the shell environment

Menu items:

- **Refresh now**
- **Import key from an app config** — scans `~/.cline/data/secrets.json` and
  `~/.local/share/opencode/auth.json`, lists matches masked (`sk-or-v1…b787`)
  and only reads them when you click one. Nothing is read at startup.
- **Set / replace API key…** — masked entry in a popup owned by the extension
- **Forget saved API key** — clears keyring entry and the config file
- **Open OpenRouter API keys page**

## Terminal, no GUI required

```bash
cd ~/.local/share/gnome-shell/extensions/openrouter-usage-checker@Ammaranjum
./set-key.sh                 # auto-detect from app configs, store in keyring
./set-key.sh store sk-or-…   # explicit key
./set-key.sh file            # store in the config file instead of the keyring
./set-key.sh show | clear | reload
```

## Verify the logic without restarting the shell

```bash
gjs -m tests/logic-check.mjs
```

It evaluates `extension.js`'s module-level constants (so a wrong GI name fails
here, not at shell startup), asserts every `GLib`/`Gio`/`Soup` symbol used
exists, runs a real `secret-tool` lookup, a live `GET /api/v1/key`, and checks
the rendering rules — including the uncapped-key case that used to look broken.

## Diagnostics

State changes are logged as shell warnings so journald keeps them:

```bash
journalctl _COMM=gnome-shell --no-pager | grep openrouter-usage-monitor
```

Panel label: `OR $1.42` = credits left on the key (amber ≤30 %, red ≤10 %).
`OR $3.58 used` = this key has no credit cap, so total spend is shown instead.

## What was broken

- `_promptForKey()` crashed with `TypeError:
  dialog.clutter_text.set_password is not a function` — Clutter only has
  `set_password_char`, so **a key could never be saved** and the indicator was
  permanently stuck showing `OR —`.
- The entry widget lived inside the status menu, which closes on the very click
  that activates the item, so it could not be typed into even after fixing the
  method name.
- Keys with no credit cap return `limit` / `limit_remaining` as `null`, which the
  old parser reported as “Unexpected response”.
- `metadata.json` still said `version: 1` and `disable()` left labels, value
  rows and any open entry behind, so re-enabling leaked actors.
- `/api/v1/credits` is deliberately **not** used: it requires a *management* key
  and answers `403` for normal inference keys.

Old revision kept at `/tmp/extension.js.bak` (pre-fix) and `/tmp/ext-mid.js`
(mid-refactor) if you want to diff.
