// OpenRouter Usage Checker — GNOME Shell panel indicator
// Shows remaining OpenRouter credit with color-coded status.
// Key stored in ~/.config/openrouter-extension/key
// by Ammar Anjum

import St from 'gi://St';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Soup from 'gi://Soup?version=3.0';
import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

const API_URL = 'https://openrouter.ai/api/v1/key';
const KEYS_URL = 'https://openrouter.ai/settings/keys';
const DEFAULT_REFRESH_SECONDS = 120;
const KEY_PATTERN = /sk-or-[A-Za-z0-9_.-]{16,}/;

const CONFIG_DIR = GLib.build_filenamev([GLib.get_user_config_dir(), 'openrouter-extension']);
const KEY_FILE   = GLib.build_filenamev([CONFIG_DIR, 'key']);
const PREFS_FILE = GLib.build_filenamev([CONFIG_DIR, 'prefs.json']);

export default class OpenRouterUsageExtension extends Extension {
    enable() {
        this._lastStatus = null;
        this._valueItems = [];

        this._session = new Soup.Session();
        this._session.timeout = 15;

        this._button = new PanelMenu.Button(0.0, this.metadata?.name ?? 'OpenRouter Usage');

        // BoxLayout — x_align/y_align use Clutter.ActorAlign: FILL=0 START=1 END=2 CENTER=3 BASELINE=4
        const box = new St.BoxLayout({
            vertical: false,
            x_align: 3, // CENTER
            y_align: 3, // CENTER
            style: 'spacing: 5px;',
        });

        // Subtle hexagon icon — techy, small, sits next to the amount
        this._icon = new St.Label({
            text: '⬡',
            x_align: 3,
            y_align: 3,
            style: 'font-size: 9px; color: #666;',
        });

        this._label = new St.Label({
            text: 'OR',
            x_align: 3,
            y_align: 3,
            style: 'font-size: 11px;',
        });

        box.add_child(this._icon);
        box.add_child(this._label);
        this._button.add_child(box);

        // Status row
        this._statusItem = this._addItem('Loading…', false);
        this._button.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        // Data rows (up to 8 lines of info)
        for (let i = 0; i < 8; i++)
            this._valueItems.push(this._addItem('', false));

        this._button.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        // Actions
        this._refreshItem = this._addItem('↻  Refresh now', true);
        this._refreshItem.connect('activate', () => this._refresh());

        this._setKeyItem = this._addItem('⚙  Preferences…', true);
        this._setKeyItem.connect('activate', () => this.openPreferences());

        this._openKeyItem = this._addItem('⬡  OpenRouter keys page', true);
        this._openKeyItem.connect('activate', () => this._openUrl(KEYS_URL));

        this._button.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        this._addItem('by Ammar', false);

        Main.panel.addToStatusArea(this.uuid, this._button);
        this._applyRefreshInterval();
        this._refresh();
    }

    disable() {
        this._clearTimer();
        this._session?.abort();
        this._button?.destroy();
        this._button = null;
        this._label = null;
        this._icon = null;
        this._statusItem = null;
        this._valueItems = [];
        this._session = null;
        this._lastStatus = null;
    }

    // ── timer ──────────────────────────────────────────────────────────────

    _applyRefreshInterval() {
        this._clearTimer();
        const secs = this._loadRefreshSeconds();
        this._timer = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, secs, () => {
            this._refresh();
            return GLib.SOURCE_CONTINUE;
        });
    }

    _clearTimer() {
        if (this._timer) {
            GLib.source_remove(this._timer);
            this._timer = 0;
        }
    }

    // ── config helpers ─────────────────────────────────────────────────────

    _loadKey() {
        try {
            const file = Gio.File.new_for_path(KEY_FILE);
            if (!file.query_exists(null)) return null;
            const [, bytes] = file.load_contents(null);
            const key = new TextDecoder().decode(bytes).trim();
            return KEY_PATTERN.test(key) ? key : null;
        } catch (_) { return null; }
    }

    _loadRefreshSeconds() {
        try {
            const file = Gio.File.new_for_path(PREFS_FILE);
            if (!file.query_exists(null)) return DEFAULT_REFRESH_SECONDS;
            const [, bytes] = file.load_contents(null);
            const prefs = JSON.parse(new TextDecoder().decode(bytes));
            const v = Number(prefs.refresh_seconds);
            return (Number.isFinite(v) && v >= 30) ? v : DEFAULT_REFRESH_SECONDS;
        } catch (_) { return DEFAULT_REFRESH_SECONDS; }
    }

    // ── ui helpers ─────────────────────────────────────────────────────────

    _addItem(text, reactive) {
        const item = new PopupMenu.PopupMenuItem(text, { reactive: !!reactive });
        this._button.menu.addMenuItem(item);
        return item;
    }

    _openUrl(url) {
        try { Gio.AppInfo.launch_default_for_uri(url, null); }
        catch (e) { this._log(`Could not open ${url}: ${e.message}`); }
    }

    _maskKey(key) {
        if (!key || key.length < 14) return '(empty)';
        return `${key.slice(0, 8)}…${key.slice(-4)}`;
    }

    _log(msg, level) {
        const text = `[${this.uuid}] ${msg}`;
        (level === 'error' || level === 'crit') ? console.error(text) : console.warn(text);
    }

    // ── panel label + status ───────────────────────────────────────────────

    _setStatus(message, panelText, level) {
        if (!this._label || !this._statusItem) return;
        if (message !== this._lastStatus) {
            this._lastStatus = message;
            this._log(message, level);
        }
        this._statusItem.label.text = message;
        this._label.text = panelText;

        // Color-coded panel label: red = critical, amber = warn, default = ok
        const colors = { crit: '#ff6b6b', warn: '#ffbf47' };
        this._label.style = colors[level]
            ? `color: ${colors[level]}; font-weight: bold;`
            : '';
        // Keep icon dim unless critical/warn
        if (this._icon) {
            this._icon.style = `font-size: 9px; color: ${colors[level] ?? '#666'};`;
        }
    }

    _setRows(lines) {
        for (let i = 0; i < this._valueItems.length; i++) {
            const item = this._valueItems[i];
            if (!item?.label) continue;
            item.visible = i < lines.length;
            if (item.visible) item.label.text = lines[i];
        }
    }

    // ── fetch / render ─────────────────────────────────────────────────────

    _refresh() {
        if (!this._button) return;
        const key = this._loadKey();
        if (!key) {
            this._setRows([]);
            this._setStatus('No API key set — open Preferences to add one.', 'OR', 'warn');
            return;
        }
        this._maskedKey = this._maskKey(key);
        this._fetch(key);
    }

    _fetch(key) {
        const message = Soup.Message.new('GET', API_URL);
        message.request_headers.append('Authorization', `Bearer ${key}`);
        message.request_headers.append('Accept', 'application/json');

        this._session.send_and_read_async(message, GLib.PRIORITY_DEFAULT, null, (session, result) => {
            if (!this._button) return;
            let body;
            try {
                const bytes = session.send_and_read_finish(result);
                body = new TextDecoder().decode(bytes.get_data());
            } catch (e) {
                this._setStatus(`Request failed: ${e.message}`, 'OR !', 'crit');
                return;
            }

            const status = message.get_status();
            if (status < 200 || status >= 300) {
                let detail = '';
                try { detail = JSON.parse(body)?.error?.message ?? ''; } catch (_) {}
                const label = status === 401
                    ? 'API key rejected (401) — check Preferences'
                    : `API request failed (${status})`;
                this._setStatus(
                    `${label}${detail ? `: ${detail}` : ''}.`,
                    status === 401 ? 'OR !' : 'OR ?',
                    status === 401 ? 'crit' : 'warn'
                );
                return;
            }

            let payload;
            try { payload = JSON.parse(body); }
            catch (e) {
                this._setStatus(`Could not parse response: ${e.message}`, 'OR !', 'crit');
                return;
            }
            this._render(payload?.data);
        });
    }

    _render(data) {
        if (!data) {
            this._setStatus('Unexpected response: no "data" object.', 'OR ?', 'warn');
            return;
        }

        const money = n => `$${n.toFixed(2)}`;
        const num   = n => (typeof n === 'number' ? n : null);

        const remaining = num(data.limit_remaining);
        const limit     = num(data.limit);
        const used      = num(data.usage);
        const pct       = (limit > 0 && remaining !== null)
            ? Math.max(0, Math.min(100, (remaining / limit) * 100))
            : null;

        const lines = [
            `Key:       ${data.label || this._maskedKey || 'OpenRouter key'}`,
            remaining !== null
                ? `Remaining: ${money(remaining)}${pct !== null ? ` (${pct.toFixed(1)}%)` : ''}`
                : 'Remaining: no credit cap',
            `Used:      ${used === null ? 'not reported' : money(used)}`,
            `Limit:     ${limit === null ? 'none' : money(limit)}`,
            `Resets:    ${data.limit_reset || 'never'}`,
            `Updated:   ${new Date().toLocaleTimeString()}`,
        ];
        this._setRows(lines);

        // Panel text + color
        let panel, level;
        if (remaining !== null) {
            panel = `OR ${money(remaining)}`;
            level = pct === null ? 'ok' : pct <= 10 ? 'crit' : pct <= 30 ? 'warn' : 'ok';
        } else if (used !== null) {
            panel = `OR ${money(used)}`;
            level = 'ok';
        } else {
            panel = 'OR ?';
            level = 'warn';
        }

        this._setStatus(
            `Tracking ${data.label || this._maskedKey}.`,
            panel,
            level
        );
    }
}
