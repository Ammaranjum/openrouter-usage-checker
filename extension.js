// OpenRouter Usage Checker — a GNOME Shell panel indicator that shows remaining OpenRouter credit.

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
const REFRESH_SECONDS = 120;
const KEY_PATTERN = /sk-or-[A-Za-z0-9_.-]{16,}/;

export default class OpenRouterUsageExtension extends Extension {
    enable() {
        this._lastStatus = null;
        this._valueItems = [];

        this._session = new Soup.Session();
        this._session.timeout = 15;

        this._button = new PanelMenu.Button(0.0, this.metadata?.name ?? 'OpenRouter Usage');
        this._label = new St.Label({
            text: 'OR —',
            style_class: 'system-status-icon',
        });
        this._button.add_child(this._label);

        this._statusItem = this._addItem('Loading usage…', false);
        this._button.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        for (let i = 0; i < 10; i++)
            this._valueItems.push(this._addItem('', false));
        this._button.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        this._refreshItem = this._addItem('Refresh now', true);
        this._refreshItem.connect('activate', () => this._refresh());

        this._openKeyItem = this._addItem('Open OpenRouter API keys page', true);
        this._openKeyItem.connect('activate', () => this._openUrl(KEYS_URL));

        Main.panel.addToStatusArea(this.uuid, this._button);
        this._log('enabled');
        this._refresh();
        this._timer = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, REFRESH_SECONDS, () => {
            this._refresh();
            return GLib.SOURCE_CONTINUE;
        });
    }

    disable() {
        if (this._timer) {
            GLib.source_remove(this._timer);
            this._timer = 0;
        }
        this._session?.abort();
        this._button?.destroy();
        this._button = null;
        this._label = null;
        this._statusItem = null;
        this._valueItems = [];
        this._session = null;
        this._lastStatus = null;
    }

    _addItem(text, reactive) {
        const item = new PopupMenu.PopupMenuItem(text, { reactive: !!reactive });
        this._button.menu.addMenuItem(item);
        return item;
    }

    /* gnome-shell swallows info-level GJS output, so diagnostics are emitted as
       warnings/errors — that keeps `journalctl -f` useful when the indicator
       misbehaves. Only state changes are logged, not every poll. */
    _log(message, level) {
        const text = `[${this.uuid}] ${message}`;
        if (level === 'crit' || level === 'error')
            console.error(text);
        else
            console.warn(text);
    }

    _maskKey(key) {
        if (!key || key.length < 14)
            return '(empty)';
        return `${key.slice(0, 8)}…${key.slice(-4)}`;
    }

    _openUrl(url) {
        try {
            Gio.AppInfo.launch_default_for_uri(url, null);
        } catch (e) {
            this._log(`Could not open ${url}: ${e.message}`);
        }
    }

    _setStatus(message, panelText, level) {
        if (!this._label || !this._statusItem)
            return;
        // Log once per state change instead of every poll, so the journal stays usable.
        if (message !== this._lastStatus) {
            this._lastStatus = message;
            this._log(message, level);
        }
        this._statusItem.label.text = message;
        this._label.text = panelText;
        const styles = {
            crit: 'color: #ff6b6b; font-weight: bold;',
            warn: 'color: #ffbf47;',
        };
        this._label.style = styles[level] ?? '';
    }

    _setRows(lines) {
        for (let i = 0; i < this._valueItems.length; i++) {
            const item = this._valueItems[i];
            if (!item || !item.label)
                continue;
            item.visible = i < lines.length;
            if (item.visible)
                item.label.text = lines[i];
        }
    }

    _getKeyFromEnv() {
        const key = (GLib.getenv('OPENROUTER_API_KEY') ?? '').trim();
        return key || null;
    }

    _refresh() {
        if (!this._button)
            return;
        const key = this._getKeyFromEnv();
        if (!key) {
            this._keySource = null;
            this._maskedKey = null;
            this._setRows([]);
            this._setStatus('OPENROUTER_API_KEY environment variable is not set.', 'OR —', 'none');
            return;
        }
        this._keySource = 'OPENROUTER_API_KEY';
        this._maskedKey = this._maskKey(key);
        this._fetch(key);
    }

    _fetch(key) {
        const message = Soup.Message.new('GET', API_URL);
        message.request_headers.append('Authorization', `Bearer ${key}`);
        message.request_headers.append('Accept', 'application/json');

        this._session.send_and_read_async(message, GLib.PRIORITY_DEFAULT, null, (session, result) => {
            if (!this._button)
                return;

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
                try {
                    detail = JSON.parse(body)?.error?.message ?? '';
                } catch (e) {
                    /* error body is not JSON */
                }
                const label = status === 401
                    ? 'API key rejected (401) — replace it'
                    : `API request failed (${status})`;
                this._setStatus(
                    `${label}${detail ? `: ${detail}` : ''}.`,
                    status === 401 ? 'OR !' : 'OR ?',
                    status === 401 ? 'crit' : 'warn'
                );
                return;
            }

            let payload;
            try {
                payload = JSON.parse(body);
            } catch (e) {
                this._setStatus(`Could not parse the API response: ${e.message}`, 'OR !', 'crit');
                return;
            }
            this._render(payload?.data);
        });
    }

    _render(data) {
        if (!data) {
            this._setStatus('Unexpected response: no “data” object.', 'OR ?', 'warn');
            return;
        }

        const money = n => `$${n.toFixed(2)}`;
        const count = n => (typeof n === 'number' ? n : null);

        const remaining = count(data.limit_remaining);
        const limit = count(data.limit);
        const used = count(data.usage);
        const pct = limit && limit > 0 && remaining !== null
            ? Math.max(0, Math.min(100, (remaining / limit) * 100))
            : null;

        // A key with no cap reports limit/limit_remaining as null: perfectly valid,
        // so fall back to showing spend instead of failing.
        const lines = [
            `Key: ${data.label || this._maskedKey || 'OpenRouter key'}`,
            remaining !== null
                ? `Remaining: ${money(remaining)}${pct === null ? '' : ` (${pct.toFixed(1)}%)`}`
                : 'Remaining: no credit cap on this key',
            `Used: ${used === null ? 'not reported' : money(used)}`,
            `Limit: ${limit === null ? 'none' : money(limit)}`,
            `Resets: ${data.limit_reset || 'never'}`,
            `Today: ${count(data.usage_daily) === null ? 'n/a' : money(data.usage_daily)}`,
            `This week: ${count(data.usage_weekly) === null ? 'n/a' : money(data.usage_weekly)}`,
            `This month: ${count(data.usage_monthly) === null ? 'n/a' : money(data.usage_monthly)}`,
            `Free-model requests left: ${data.free_model_daily_requests?.remaining ?? 'n/a'} per day`,
            `Source: ${this._keySource ?? 'unknown'} · updated ${new Date().toLocaleTimeString()}`,
        ];
        this._setRows(lines);

        let panel;
        let level = 'ok';
        if (remaining !== null) {
            panel = `OR ${money(remaining)}`;
            level = pct === null ? 'ok' : pct <= 10 ? 'crit' : pct <= 30 ? 'warn' : 'ok';
        } else if (used !== null) {
            panel = `OR ${money(used)} used`;
        } else {
            panel = 'OR ?';
            level = 'warn';
        }
        this._setStatus(
            `Tracking ${data.label || this._maskedKey} (${this._keySource ?? 'unknown source'}).`,
            panel,
            level
        );
    }
}

