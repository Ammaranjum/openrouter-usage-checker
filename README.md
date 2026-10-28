# OpenRouter Usage Checker

A small OpenRouter usage indicator for **Windows** and **Ubuntu / GNOME Linux**,
with daily history saved locally. Made by Ammar.

## Choose your version

- **Windows 10/11 (64-bit):** [Download OpenRouterUsage.exe](https://github.com/Ammaranjum/openrouter-usage-checker/releases/latest/download/OpenRouterUsage.exe), double-click it, enter your API key, and save. No installer, administrator access, or separate .NET installation is needed. See the [Windows guide](windows/README.md).
- **Ubuntu / GNOME Linux:** follow the [setup commands below](#ubuntu--gnome-linux-setup), then enter your key in Preferences.

Ubuntu is a Linux distribution. The Linux version requires GNOME Shell 45–48;
it is not an extension for every Linux desktop.

## Windows setup

1. [Download OpenRouterUsage.exe](https://github.com/Ammaranjum/openrouter-usage-checker/releases/latest/download/OpenRouterUsage.exe).
2. Move it to a permanent folder, such as `Documents/OpenRouter Usage`.
3. Double-click it. Enter your OpenRouter API key and choose **Save and refresh**.
4. Look for **OR** beside the clock (it may be under the hidden-icons arrow).
   Left-click it to check usage. Choose **Settings** to change/delete the key;
   choose **Exit** to stop the app.

No Git clone, terminal command, administrator access, installer, or separate .NET
installation is required for the portable release. Each person uses their own key.
For updates, exit the old app, replace the EXE, and run it again; saved settings
and history are kept.

## Ubuntu / GNOME Linux setup

```bash
git clone https://github.com/Ammaranjum/openrouter-usage-checker
cd openrouter-usage-checker
./install.sh
```

Then **log out and back in**. After logging in, run:

```bash
gnome-extensions enable openrouter-usage-checker@local
```

Click the **OR** indicator → **Preferences…**, enter your own OpenRouter API key,
and press Enter. Existing users update with `git pull` followed by `./install.sh`,
then log out and back in. See [Install](#install) for the alternative curl installer.

## Ubuntu / GNOME Linux

The GNOME Shell panel shows the remaining OpenRouter API-key cap:

Works on GNOME 45–48.
The dropdown shows today's, weekly, monthly, and total key usage, the key's
remaining spending cap, and the seven most recent saved days under **Recent days
(UTC)**. Each saved day includes its last observation time. Amber/red indicate
≤ 30%/≤ 10% of a configured key cap remaining; normal status uses your theme.
The key cap is not your account balance. The panel always represents remaining
cap, never daily or total spending. If remaining is unavailable it displays `OR ?`.
Daily spending stays inside the dropdown and continues to be saved locally.

---

## Install

### One-liner (no git needed)

```bash
curl -fsSL https://raw.githubusercontent.com/Ammaranjum/openrouter-usage-checker/main/install.sh | bash
```

Then follow the logout/login and enable steps under [Ubuntu / GNOME Linux setup](#ubuntu--gnome-linux-setup).

### Daily usage history

Each successful refresh saves the key's reported `usage_daily` in
`~/.local/share/openrouter-extension/usage-history.json` (or under
`$XDG_DATA_HOME` when set). No additional API request or management key is needed.
History is grouped by a SHA-256 fingerprint of the key; the API key itself is
never included. Amounts retain the precision reported by OpenRouter.

Each UTC date has one record containing `usage_usd`, `total_usage_usd`,
`first_observed_at`, and `last_observed_at`. Refreshes replace that day's value
rather than adding it again. UTC days reset at 05:00 in Pakistan.

History starts when this version runs. Values are observations, not guaranteed
final daily totals: spending after the last refresh can be missing if the
computer is off, asleep, offline, or the extension is disabled. Missing dates
are unknown, not zero. Switching keys keeps their histories separate.
The history file survives uninstalling the extension so it can be used by a
future dashboard; delete it manually to remove the saved usage history.

Verify history saving without credentials or network access:
`gjs -m tests/history-check.mjs`.

### Requirements

- GNOME Shell 45, 46, 47, or 48
- An OpenRouter API key — [create one here](https://openrouter.ai/settings/keys)
- `curl` (for the one-liner) or `git`

---

## Remove

```bash
curl -fsSL https://raw.githubusercontent.com/Ammaranjum/openrouter-usage-checker/main/uninstall.sh | bash
```

Or if you cloned:

```bash
./uninstall.sh
```

Removes the extension and all saved config. Log out and back in for the panel indicator to disappear.

---

## After updating the code

Run `./install.sh` again, then **log out and back in** so GNOME loads the new
JavaScript. On X11, `Alt+F2`, then `r`, also restarts GNOME Shell. Disabling and
enabling alone does not load edited code. Saved key and interval changes apply
automatically without a restart.

## Windows

The separate [Windows version](windows/README.md) lives in `windows/`. It runs
as a native system-tray app, encrypts its saved key for the Windows account, and
uses the same daily-history JSON format. Its own build script creates a portable
Windows executable. The GNOME extension remains here with its existing Linux
installer; the two versions have separate settings and data folders.

---

## Diagnostics

```bash
journalctl _COMM=gnome-shell --no-pager | grep openrouter-usage-checker
```

---

## Files

| file | purpose |
|------|---------|
| `extension.js` | the panel indicator |
| `prefs.js` | preferences UI (key + refresh interval) |
| `metadata.json` | extension metadata |
| `install.sh` / `uninstall.sh` | setup and teardown |
| `tests/logic-check.mjs` | out-of-process logic check (no shell restart needed) |

Run the logic check:

```bash
gjs -m tests/logic-check.mjs
gjs -m tests/history-check.mjs
```

Both checks use synthetic data and temporary files, without network requests or
access to your saved API key. They test the actual extension methods; they do
not replace visual testing inside GNOME Shell.
