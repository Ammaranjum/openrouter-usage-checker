// OpenRouter Usage Checker — GNOME Shell panel indicator
// Shows daily key usage, saved history, and the key's remaining spending cap.
// Key stored in ~/.config/openrouter-extension/key
// by Ammar Anjum

import St from 'gi://St';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Clutter from 'gi://Clutter';
import Soup from 'gi://Soup?version=3.0';
import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

const API_URL = 'https://openrouter.ai/api/v1/key';
const KEYS_URL = 'https://openrouter.ai/settings/keys';
const DEFAULT_REFRESH_SECONDS = 120;
const KEY_PATTERN = /^sk-or-[A-Za-z0-9_.-]{16,}$/;

const CONFIG_DIR = GLib.build_filenamev([GLib.get_user_config_dir(), 'openrouter-extension']);
const KEY_FILE   = GLib.build_filenamev([CONFIG_DIR, 'key']);
const PREFS_FILE = GLib.build_filenamev([CONFIG_DIR, 'prefs.json']);
const HISTORY_DIR = GLib.build_filenamev([GLib.get_user_data_dir(), 'openrouter-extension']);
const HISTORY_FILE = GLib.build_filenamev([HISTORY_DIR, 'usage-history.json']);

export default class OpenRouterUsageExtension extends Extension {
    enable() {
        this._lastStatus = null;
        this._valueItems = [];

        this._session = new Soup.Session();
        this._session.timeout = 15;

        this._button = new PanelMenu.Button(0.0, this.metadata?.name ?? 'OpenRouter Usage');

        // panel-status-menu-box is the CSS class GNOME uses for its own
        // text+icon panel buttons — it handles vertical centering via the theme
        const box = new St.BoxLayout({ style_class: 'panel-status-menu-box' });
        this._label = new St.Label({
            text: '⬡ OR',
            y_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        box.add_child(this._label);
        this._button.add_child(box);

        // Status row
        this._statusItem = this._addItem('Loading…', false);
        this._button.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        // Current usage and key spending cap (not the account balance).
        for (let i = 0; i < 10; i++)
            this._valueItems.push(this._addItem('', false));

        this._historyItem = new PopupMenu.PopupSubMenuMenuItem('Recent days (UTC)');
        this._button.menu.addMenuItem(this._historyItem);
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
        this._watchConfig();
        this._applyRefreshInterval();
        this._refresh();
    }

    disable() {
        this._clearTimer();
        this._cancelRequest();
        this._configMonitor?.cancel();
        this._configMonitor = null;
        if (this._configTimer) GLib.source_remove(this._configTimer);
        this._configTimer = 0;
        this._session?.abort();
        this._button?.destroy();
        this._button = null;
        this._label = null;
        this._statusItem = null;
        this._historyItem = null;
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

    _watchConfig() {
        try {
            if (GLib.mkdir_with_parents(CONFIG_DIR, 0o700) !== 0)
                throw new Error('Could not create configuration directory');
            this._configMonitor = Gio.File.new_for_path(CONFIG_DIR)
                .monitor_directory(Gio.FileMonitorFlags.NONE, null);
            this._configMonitor.connect('changed', (_monitor, file, otherFile) => {
                if (![file, otherFile].some(f => ['key', 'prefs.json'].includes(f?.get_basename()))) return;
                if (this._configTimer) GLib.source_remove(this._configTimer);
                this._configTimer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 200, () => {
                    this._configTimer = 0;
                    this._applyRefreshInterval();
                    this._refresh();
                    return GLib.SOURCE_REMOVE;
                });
            });
        } catch (e) {
            this._log(`Could not watch settings: ${e.message}`, 'warn');
        }
    }

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
            return (Number.isFinite(v) && v >= 30 && v <= 3600) ? Math.round(v) : DEFAULT_REFRESH_SECONDS;
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
            if (['warn', 'crit', 'error'].includes(level)) this._log(message, level);
        }
        this._statusItem.label.text = message;
        this._label.text = panelText;

        // Color-coded: red = critical, amber = warn, default = panel fg
        const colors = { crit: '#ff6b6b', warn: '#ffbf47' };
        this._label.style = colors[level]
            ? `color: ${colors[level]}; font-weight: bold;`
            : null;
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
        this._cancelRequest();
        const key = this._loadKey();
        if (!key) {
            this._setRows([]);
            this._historyItem?.menu.removeAll();
            this._setStatus('No API key set — open Preferences to add one.', '⬡ OR', 'warn');
            return;
        }
        this._maskedKey = this._maskKey(key);
        this._setRows([]);
        this._setStatus('Refreshing usage…', '⬡ OR …', 'ok');
        this._updateHistory(key);
        this._fetch(key);
    }

    _cancelRequest() {
        this._request?.cancel();
        this._request = null;
    }

    _fetch(key) {
        this._cancelRequest();
        const request = new Gio.Cancellable();
        this._request = request;
        const message = Soup.Message.new('GET', API_URL);
        message.request_headers.append('Authorization', `Bearer ${key}`);
        message.request_headers.append('Accept', 'application/json');

        this._session.send_and_read_async(message, GLib.PRIORITY_DEFAULT, request, (session, result) => {
            let body, error;
            try {
                const bytes = session.send_and_read_finish(result);
                body = new TextDecoder().decode(bytes.get_data());
            } catch (e) {
                error = e;
            }
            if (!this._button || this._request !== request || request.is_cancelled()) return;
            this._request = null;
            if (this._loadKey() !== key) {
                this._refresh();
                return;
            }
            this._setRows([]);
            if (error) {
                this._setStatus(`Request failed: ${error.message}`, '⬡ OR !', 'crit');
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
                    status === 401 ? '⬡ OR !' : '⬡ OR ?',
                    status === 401 ? 'crit' : 'warn'
                );
                return;
            }

            let payload;
            try { payload = JSON.parse(body); }
            catch (e) {
                this._setStatus(`Could not parse response: ${e.message}`, '⬡ OR !', 'crit');
                return;
            }
            // The server timestamp keeps UTC date assignment correct around midnight.
            const serverDate = new Date(message.response_headers.get_one('Date') ?? '');
            const observedAt = Number.isFinite(serverDate.getTime()) ? serverDate : new Date();
            const saved = this._recordUsage(key, payload?.data, observedAt);
            this._updateHistory(key, saved === false);
            this._render(payload?.data);
        });
    }

    _loadHistory() {
        const file = Gio.File.new_for_path(HISTORY_FILE);
        if (!file.query_exists(null)) return { version: 1, timezone: 'UTC', keys: {} };
        const [, bytes] = file.load_contents(null);
        const history = JSON.parse(new TextDecoder().decode(bytes));
        if (history?.version !== 1 || history.timezone !== 'UTC' || !history.keys ||
            typeof history.keys !== 'object' || Array.isArray(history.keys))
            throw new Error('Unrecognized usage history format');
        return history;
    }

    _recordUsage(key, data, observedAt = new Date()) {
        if (!Number.isFinite(data?.usage_daily) || data.usage_daily < 0) return;
        try {
            const file = Gio.File.new_for_path(HISTORY_FILE);
            const history = this._loadHistory();
            const keyId = GLib.compute_checksum_for_string(GLib.ChecksumType.SHA256, key, -1);
            const entry = history.keys[keyId] ??= { days: {} };
            const timestamp = observedAt.toISOString();
            const date = timestamp.slice(0, 10);
            const previous = entry.days[date];
            if (previous?.last_observed_at > timestamp) return true;
            entry.days[date] = {
                usage_usd: data.usage_daily,
                total_usage_usd: Number.isFinite(data.usage) ? data.usage : null,
                first_observed_at: previous?.first_observed_at ?? timestamp,
                last_observed_at: timestamp,
            };
            if (GLib.mkdir_with_parents(HISTORY_DIR, 0o700) !== 0)
                throw new Error('Could not create usage history directory');
            file.replace_contents(JSON.stringify(history, null, 2), null, false,
                Gio.FileCreateFlags.PRIVATE | Gio.FileCreateFlags.REPLACE_DESTINATION, null);
            return true;
        } catch (e) {
            this._log(`Could not save usage history: ${e.message}`, 'error');
            return false;
        }
    }

    _updateHistory(key, saveFailed = false) {
        if (!this._historyItem) return;
        const menu = this._historyItem.menu;
        menu.removeAll();
        const add = text => menu.addMenuItem(new PopupMenu.PopupMenuItem(text, { reactive: false }));
        try {
            const id = GLib.compute_checksum_for_string(GLib.ChecksumType.SHA256, key, -1);
            const days = this._loadHistory().keys[id]?.days ?? {};
            const dates = Object.keys(days).filter(date => /^\d{4}-\d{2}-\d{2}$/.test(date) &&
                Number.isFinite(days[date]?.usage_usd)).sort().reverse().slice(0, 7);
            if (saveFailed) add('Latest usage could not be saved');
            add('Last observed totals; days may be incomplete');
            if (!dates.length) add('No saved days yet');
            for (const date of dates) {
                const day = days[date];
                const time = day.last_observed_at?.slice(11, 16) ?? '?';
                add(`${date}: $${day.usage_usd.toFixed(2)} · as of ${time} UTC`);
            }
        } catch (_) {
            add('Could not read saved history');
        }
    }

    _render(data) {
        if (!data) {
            this._setStatus('Unexpected response: no "data" object.', '⬡ OR ?', 'warn');
            return;
        }

        const money = n => `$${n.toFixed(2)}`;
        const num   = n => (Number.isFinite(n) ? n : null);

        const remaining = num(data.limit_remaining);
        const limit     = num(data.limit);
        const used      = num(data.usage);
        const daily     = num(data.usage_daily);
        const pct       = (limit > 0 && remaining !== null)
            ? Math.max(0, Math.min(100, (remaining / limit) * 100))
            : null;

        const lines = [
            `Key:       ${data.label || this._maskedKey || 'OpenRouter key'}`,
            `Today (UTC): ${daily === null ? 'not reported' : money(daily)}`,
            `This week (UTC): ${num(data.usage_weekly) === null ? 'not reported' : money(data.usage_weekly)}`,
            `This month (UTC): ${num(data.usage_monthly) === null ? 'not reported' : money(data.usage_monthly)}`,
            remaining !== null
                ? `Key cap left: ${money(remaining)}${pct !== null ? ` (${pct.toFixed(1)}%)` : ''}`
                : 'Key cap: none (account balance not tracked)',
            `Used:      ${used === null ? 'not reported' : money(used)}`,
            `Limit:     ${limit === null ? 'none' : money(limit)}`,
            `Resets:    ${data.limit_reset || 'never'}`,
            `Updated:   ${new Date().toLocaleTimeString()}`,
        ];
        this._setRows(lines);

        // Panel text + color
        let panel, level;
        if (remaining !== null) {
            panel = `⬡ OR ${money(remaining)} left`;
            level = pct === null ? 'ok' : pct <= 10 ? 'crit' : pct <= 30 ? 'warn' : 'ok';
        } else {
            panel = '⬡ OR ?';
            level = 'warn';
        }

        this._setStatus(
            `Tracking ${data.label || this._maskedKey}.`,
            panel,
            level
        );
    }
}
