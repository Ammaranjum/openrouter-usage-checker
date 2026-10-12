#!/usr/bin/env bash
# Install OpenRouter Usage Checker for the current user.
#
#   ./install.sh
#
# After the FIRST install you must log out and back in once so GNOME Shell
# picks up the new extension. After that, any key / settings changes you make
# in Preferences take effect immediately — no logout needed.
#
# To reload the extension without logging out (after the first install):
#   gnome-extensions disable openrouter-usage-checker@local
#   gnome-extensions enable  openrouter-usage-checker@local
set -euo pipefail

UUID='openrouter-usage-checker@local'
SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEST="${XDG_DATA_HOME:-$HOME/.local/share}/gnome-shell/extensions/$UUID"

if ! command -v gnome-extensions >/dev/null 2>&1; then
    echo "error: gnome-extensions not found — this only works on GNOME." >&2
    exit 1
fi

mkdir -p "$DEST/tests"
cp "$SRC/extension.js" "$SRC/metadata.json" "$SRC/prefs.js" \
   "$SRC/install.sh" "$SRC/uninstall.sh" "$DEST/"
cp "$SRC/tests/"* "$DEST/tests/" 2>/dev/null || true
chmod +x "$DEST/install.sh" "$DEST/uninstall.sh"
echo "Installed to $DEST"

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo " FIRST TIME SETUP"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo " 1. Log out and back in (only needed once)."
echo " 2. Run:  gnome-extensions enable $UUID"
echo " 3. Click the 'OR' panel indicator → Preferences…"
echo "    and paste your OpenRouter API key (sk-or-…)."
echo ""
echo " After the first setup, to apply updates just run:"
echo "   gnome-extensions disable $UUID"
echo "   gnome-extensions enable  $UUID"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
