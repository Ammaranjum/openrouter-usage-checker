#!/usr/bin/env bash
# Remove OpenRouter Usage Checker and its saved config.
set -euo pipefail

UUID='openrouter-usage-checker@local'
DEST="${XDG_DATA_HOME:-$HOME/.local/share}/gnome-shell/extensions/$UUID"
CONFIG_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/openrouter-extension"

if command -v gnome-extensions >/dev/null 2>&1; then
    gnome-extensions disable "$UUID" 2>/dev/null || true
fi

rm -rf "$DEST"
rm -rf "$CONFIG_DIR"

echo "Removed extension and config."
echo "Log out and back in for the panel indicator to disappear."
