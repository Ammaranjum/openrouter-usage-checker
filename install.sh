#!/usr/bin/env bash
# Install OpenRouter Usage Checker by Ammar Anjum
#
# One-liner install (no git clone needed):
#   curl -fsSL https://raw.githubusercontent.com/Ammaranjum/openrouter-usage-checker/main/install.sh | bash
#
# Or clone and run locally:
#   git clone https://github.com/Ammaranjum/openrouter-usage-checker
#   cd openrouter-usage-checker && ./install.sh
set -euo pipefail

UUID='openrouter-usage-checker@local'
DEST="${XDG_DATA_HOME:-$HOME/.local/share}/gnome-shell/extensions/$UUID"
BASE_URL='https://raw.githubusercontent.com/Ammaranjum/openrouter-usage-checker/main'

if ! command -v gnome-extensions >/dev/null 2>&1; then
    echo "error: gnome-extensions not found — this only works on GNOME." >&2
    exit 1
fi

# If running via curl | bash, $BASH_SOURCE[0] is empty — download files directly.
# If running from a local clone, copy from the repo directory.
if [ -z "${BASH_SOURCE[0]:-}" ] || [ "${BASH_SOURCE[0]}" = "bash" ] || [ ! -f "${BASH_SOURCE[0]}" ]; then
    echo "Downloading from GitHub…"
    if ! command -v curl >/dev/null 2>&1; then
        echo "error: curl is required for remote install." >&2
        exit 1
    fi
    mkdir -p "$DEST"
    for f in extension.js prefs.js metadata.json install.sh uninstall.sh; do
        curl -fsSL "$BASE_URL/$f" -o "$DEST/$f"
    done
    chmod +x "$DEST/install.sh" "$DEST/uninstall.sh"
else
    SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
    mkdir -p "$DEST"
    cp "$SRC/extension.js" "$SRC/prefs.js" "$SRC/metadata.json" \
       "$SRC/install.sh" "$SRC/uninstall.sh" "$DEST/"
    chmod +x "$DEST/install.sh" "$DEST/uninstall.sh"
fi

echo "Installed to $DEST"
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo " SETUP"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo " 1. Log out and back in (first time only)."
echo "    On X11 you can skip this: press Alt+F2, type r, Enter."
echo " 2. Run:  gnome-extensions enable $UUID"
echo " 3. Click the panel indicator → Preferences…"
echo "    and paste your OpenRouter API key (sk-or-…)."
echo ""
echo " To reload after updates (no logout needed):"
echo "   gnome-extensions disable $UUID && gnome-extensions enable $UUID"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
