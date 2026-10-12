#!/usr/bin/env bash
# Remove the OpenRouter Usage Checker and its saved API key.
set -euo pipefail

UUID='openrouter-usage-checker@local'
DEST="${XDG_DATA_HOME:-$HOME/.local/share}/gnome-shell/extensions/$UUID"
ENV_FILE="${XDG_CONFIG_HOME:-$HOME/.config}/environment.d/openrouter.conf"

if command -v gnome-extensions >/dev/null 2>&1; then
    gnome-extensions disable "$UUID" 2>/dev/null || true
fi

rm -rf "$DEST"
rm -f "$ENV_FILE"

echo "removed extension and $ENV_FILE"
echo "log out and back in for the panel indicator to disappear."
