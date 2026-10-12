#!/usr/bin/env bash
# Install the OpenRouter Usage Checker for the current user.
#
#   ./install.sh                     # uses $OPENROUTER_API_KEY if set
#   ./install.sh sk-or-v1-...        # installs and saves this key
#
# GNOME Shell imports an extension once per session, so log out and back in
# after running this.
set -euo pipefail

UUID='openrouter-usage-checker@local'
SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEST="${XDG_DATA_HOME:-$HOME/.local/share}/gnome-shell/extensions/$UUID"
ENV_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/environment.d"
ENV_FILE="$ENV_DIR/openrouter.conf"

KEY="${1:-${OPENROUTER_API_KEY:-}}"

if ! command -v gnome-extensions >/dev/null 2>&1; then
    echo "error: gnome-extensions not found — this only works on GNOME." >&2
    exit 1
fi

mkdir -p "$DEST/tests"
cp "$SRC/extension.js" "$SRC/metadata.json" "$SRC/install.sh" "$DEST/"
cp "$SRC/tests/"* "$DEST/tests/" 2>/dev/null || true
chmod +x "$DEST/install.sh"
echo "installed to $DEST"

if [ -n "$KEY" ]; then
    mkdir -p "$ENV_DIR"
    printf 'OPENROUTER_API_KEY=%s\n' "$KEY" >"$ENV_FILE"
    chmod 600 "$ENV_FILE"
    echo "saved OPENROUTER_API_KEY to $ENV_FILE"
else
    echo "no API key given — the indicator will stay blank until you set one:"
    echo "  mkdir -p $ENV_DIR && echo 'OPENROUTER_API_KEY=sk-or-...' > $ENV_FILE && chmod 600 $ENV_FILE"
fi

gnome-extensions enable "$UUID"
echo
echo "enabled. Now log out and log back in (GNOME Shell reads both the code"
echo "and the environment only at session start)."
