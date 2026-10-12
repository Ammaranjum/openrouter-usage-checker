# OpenRouter Usage Checker

A GNOME Shell panel indicator that shows your remaining OpenRouter credit, color-coded by usage. Built by Ammar Anjum.

```
⬡ OR $4.65    # green — plenty of credit
⬡ OR $0.80    # amber — ≤ 30% remaining
⬡ OR $0.12    # red   — ≤ 10% remaining
```

Works on GNOME 45–48.

---

## Install

### One-liner (no git needed)

```bash
curl -fsSL https://raw.githubusercontent.com/Ammaranjum/openrouter-usage-checker/main/install.sh | bash
```

### Or clone

```bash
git clone https://github.com/Ammaranjum/openrouter-usage-checker
cd openrouter-usage-checker
./install.sh
```

After installing:

1. **Log out and back in** (first time only — GNOME needs to discover the extension)
   - On X11 you can skip this: press `Alt+F2`, type `r`, hit Enter
2. Enable the extension:
   ```bash
   gnome-extensions enable openrouter-usage-checker@local
   ```
3. Click the `⬡ OR` indicator in the panel → **Preferences…** → paste your `sk-or-…` key → press Enter

That's it. No terminal config, no env vars.

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

No logout needed after the first install. Just reload:

```bash
gnome-extensions disable openrouter-usage-checker@local
gnome-extensions enable  openrouter-usage-checker@local
```

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
```
