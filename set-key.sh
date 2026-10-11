#!/usr/bin/env bash
# OpenRouter Usage Monitor — manage the API key the GNOME extension reads.
#
#   ./set-key.sh              auto-detect the key from app configs and store it
#   ./set-key.sh store sk-or…  store an explicit key
#   ./set-key.sh store          prompt (hidden input) for a key
#   ./set-key.sh file          store in ~/.config/openrouter-usage-monitor/api_key only
#   ./set-key.sh show          print the masked key + where it came from
#   ./set-key.sh clear         remove the stored key (keyring and file)
#   ./set-key.sh reload        re-enable the extension so new code is loaded
set -euo pipefail

UUID='openrouter-usage-checker@local'
SERVICE='openrouter-usage-monitor'
ACCOUNT='default'
KEY_FILE="${XDG_CONFIG_HOME:-$HOME/.config}/openrouter-usage-monitor/api_key"
PATTERN='sk-or-[A-Za-z0-9_.-]{16,}'

mask() { printf '%s…%s\n' "${1:0:8}" "${1: -4}"; }

detect() {
    local f key
    for f in \
        "$HOME/.cline/data/secrets.json" \
        "$HOME/.local/share/opencode/auth.json" \
        "$HOME/.config/opencode/auth.json" \
        "$KEY_FILE"; do
        [[ -r $f ]] || continue
        key=$(grep -oE "$PATTERN" "$f" | head -1 || true)
        if [[ -n $key ]]; then
            printf '%s\n' "$key"
            return 0
        fi
    done
    return 1
}

store_keyring() {
    printf '%s' "$1" | secret-tool store --label='OpenRouter Usage Monitor API key' \
        service "$SERVICE" account "$ACCOUNT"
}

store_file() {
    mkdir -p "$(dirname "$KEY_FILE")"
    umask 077
    printf '%s\n' "$1" >"$KEY_FILE"
    chmod 600 "$KEY_FILE"
}

current_key() {
    local k
    k=$(secret-tool lookup service "$SERVICE" account "$ACCOUNT" 2>/dev/null || true)
    [[ -n $k ]] && { printf '%s\n' "$k"; return 0; }
    [[ -r $KEY_FILE ]] && { grep -oE "$PATTERN" "$KEY_FILE" | head -1; return 0; }
    return 1
}

reload() {
    gnome-extensions disable "$UUID" 2>/dev/null || true
    sleep 0.5
    gnome-extensions enable "$UUID"
    echo "re-enabled $UUID — a newly stored key is used on the next poll (<=120s)."
    echo "note: GNOME imports extension code once per session; code edits need a logout/login."
}

action="${1:-store}"
case "$action" in
    store)
        key="${2:-}"
        if [[ -z $key ]]; then
            if key=$(detect); then
                echo "detected key $(mask "$key") in an app config"
            else
                read -r -s -p 'Paste OpenRouter API key: ' key; echo
            fi
        fi
        [[ $key =~ $PATTERN ]] || { echo "error: not an OpenRouter key (sk-or-…)" >&2; exit 1; }
        if store_keyring "$key"; then
            rm -f "$KEY_FILE"
            echo "saved to login keyring as $(mask "$key")"
        else
            store_file "$key"
            echo "keyring unavailable; saved to $KEY_FILE"
        fi
        reload
        ;;
    file)
        key="${2:-$(detect || true)}"
        [[ -n ${key:-} ]] || { echo "error: no key given" >&2; exit 1; }
        store_file "$key"
        echo "saved to $KEY_FILE"
        reload
        ;;
    show)
        if key=$(current_key); then
            echo "key: $(mask "$key")"
            secret-tool lookup service "$SERVICE" account "$ACCOUNT" >/dev/null 2>&1 \
                && echo "source: login keyring" || echo "source: $KEY_FILE"
        else
            echo "no key stored" >&2; exit 1
        fi
        ;;
    clear)
        secret-tool clear service "$SERVICE" account "$ACCOUNT" 2>/dev/null || true
        rm -f "$KEY_FILE"
        echo "removed stored key"
        reload
        ;;
    reload)
        reload
        ;;
    *)
        sed -n '2,12p' "$0"
        exit 1
        ;;
esac
