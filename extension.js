// OpenRouter Usage Checker — a GNOME Shell panel indicator that stays top-right
// and shows how much credit remains on one API key.
//
// Fixes for GNOME 45/46:
//   * `clutter_text.set_password()` does not exist -> use `set_password_char()`
//   * explicit libsoup 3 import (`gi://Soup?version=3.0`)
//   * keys without a credit cap (`limit_remaining: null`) are no longer
//     reported as "unexpected response"
//   * the key is asked for in a popup owned by the extension: an entry placed
//     inside the status menu is destroyed by the same click that activates it
//   * the key can also be imported from an existing app config or a file, so a
//     working terminal prompt is enough to get the indicator running
//   * `disable()` tears everything down, so re-enabling never leaves stale actors

import St from 'gi://St';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Soup from 'gi://Soup?version=3.0';
import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

const SECRET_SERVICE = 'openrouter-usage-monitor';
const SECRET_ACCOUNT = 'default';
const API_URL = 'https://openrouter.ai/api/v1/key';
const KEYS_URL = 'https://openrouter.ai/settings/keys';
const REFRESH_SECONDS = 120;
const KEY_FILE = GLib.build_filenamev([GLib.get_user_config_dir(), 'openrouter-usage-monitor', 'api_key']);

// Only read when the user explicitly picks "Import key…".
const IMPORT_SOURCES = [
    { name: 'Cline', path: GLib.build_filenamev([GLib.get_home_dir(), '.cline', 'data', 'secrets.json']) },
    { name: 'opencode', path: GLib.build_filenamev([GLib.get_home_dir(), '.local', 'share', 'opencode', 'auth.json']) },
    { name: 'key file', path: KEY_FILE },
];

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

        this._importItem = new PopupMenu.PopupSubMenuMenuItem('Import key from an app config', false);
        this._button.menu.addMenuItem(this._importItem);
        // Scan when the menu opens (not at startup) — the parent menu is always
        // opened before its submenu, so the submenu is populated by then.
        this._button.menu.connect('open', () => this._populateImportMenu());

        this._setKeyItem = this._addItem('Set / replace API key…', true);
        this._setKeyItem.connect('activate', () => this._promptForKey());

        this._removeKeyItem = this._addItem('Forget saved API key', true);
        this._removeKeyItem.connect('activate', () => this._forgetKey());

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
        if (this._promptIdle) {
            GLib.source_remove(this._promptIdle);
            this._promptIdle = 0;
        }
        this._closeEntry();
        this._session?.abort();
        this._button?.destroy();
        this._button = null;
        this._label = null;
        this._statusItem = null;
        this._importItem = null;
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

    _secretTool(args, stdinText, callback) {
        let proc;
        try {
            proc = Gio.Subprocess.new(
                ['secret-tool', ...args],
                Gio.SubprocessFlags.STDIN_PIPE | Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE
            );
        } catch (e) {
            callback(null, `secret-tool is unavailable (install libsecret-tools): ${e.message}`);
            return;
        }
        proc.communicate_utf8_async(stdinText, null, (p, result) => {
            try {
                const [, stdout, stderr] = p.communicate_utf8_finish(result);
                if (!p.get_successful())
                    callback(null, (stderr || 'Secret Service operation failed').trim());
                else
                    callback((stdout || '').trim(), null);
            } catch (e) {
                callback(null, e.message);
            }
        });
    }

    _readTextFile(path) {
        try {
            const file = Gio.File.new_for_path(path);
            if (!file.query_exists(null))
                return null;
            const result = file.load_contents(null);
            const bytes = Array.isArray(result) ? (result[1] ?? result[0]) : result;
            if (!bytes)
                return null;
            return new TextDecoder().decode(bytes);
        } catch (e) {
            return null;
        }
    }

    _keyFromFile() {
        const text = this._readTextFile(KEY_FILE);
        if (!text)
            return null;
        const match = text.match(KEY_PATTERN);
        return (match ? match[0] : text).trim() || null;
    }

    _writeKeyFile(key) {
        try {
            const dir = GLib.path_get_dirname(KEY_FILE);
            Gio.File.new_for_path(dir).make_parents(null);
            GLib.file_set_contents(KEY_FILE, `${key}\n`);
            GLib.chmod(KEY_FILE, 0o600);
            return true;
        } catch (e) {
            this._log(`Could not write ${KEY_FILE}: ${e.message}`);
            return false;
        }
    }

    _removeKeyFile() {
        try {
            const file = Gio.File.new_for_path(KEY_FILE);
            if (file.query_exists(null))
                file.delete(null);
            return true;
        } catch (e) {
            return false;
        }
    }

    /* keyring > config file > environment. callback(key, source, error) */
    _getKey(callback) {
        this._secretTool(
            ['lookup', 'service', SECRET_SERVICE, 'account', SECRET_ACCOUNT],
            null,
            (stdout, err) => {
                if (stdout)
                    return callback(stdout, 'login keyring', null);

                const fileKey = this._keyFromFile();
                if (fileKey)
                    return callback(fileKey, `file (${KEY_FILE})`, null);

                const envKey = (GLib.getenv('OPENROUTER_API_KEY') ?? '').trim();
                if (envKey)
                    return callback(envKey, 'OPENROUTER_API_KEY', null);

                callback(null, null, err ?? 'no-key');
            }
        );
    }

    _storeKey(key, description, callback) {
        this._secretTool(
            ['store', `--label=OpenRouter Usage Monitor ${description ?? 'API key'}`,
                'service', SECRET_SERVICE, 'account', SECRET_ACCOUNT],
            key,
            (stdout, err) => {
                if (err) {
                    // Keyring missing/locked should not make the indicator useless.
                    if (this._writeKeyFile(key)) {
                        callback(null, `keyring rejected the write (${err}); saved to ${KEY_FILE} instead`);
                    } else {
                        callback(err, null);
                    }
                    return;
                }
                this._removeKeyFile();
                callback(null, null);
            }
        );
    }

    _maskKey(key) {
        if (!key || key.length < 14)
            return '(empty)';
        return `${key.slice(0, 8)}…${key.slice(-4)}`;
    }

    _foundKeys() {
        const seen = new Set();
        const found = [];
        for (const source of IMPORT_SOURCES) {
            const text = this._readTextFile(source.path);
            if (!text)
                continue;
            const match = text.match(KEY_PATTERN);
            if (!match || seen.has(match[0]))
                continue;
            seen.add(match[0]);
            found.push({ name: source.name, path: source.path, key: match[0] });
        }
        return found;
    }

    _populateImportMenu() {
        if (!this._importItem)
            return;
        this._importItem.menu.removeAll();
        const found = this._foundKeys();
        if (!found.length) {
            const none = new PopupMenu.PopupMenuItem('No sk-or-… key found in app configs', { reactive: false });
            this._importItem.menu.addMenuItem(none);
            return;
        }
        for (const entry of found) {
            const item = new PopupMenu.PopupMenuItem(`${entry.name}: ${this._maskKey(entry.key)}`);
            item.connect('activate', () => {
                this._setStatus(`Imported key from ${entry.name}…`, 'OR …', 'none');
                this._storeKey(entry.key, `key from ${entry.name}`, (err, note) => {
                    if (err)
                        this._setStatus(`Could not save the key: ${err}`, 'OR !', 'crit');
                    else if (note)
                        this._setStatus(`Saved with fallback — ${note}`, 'OR !', 'warn');
                    this._refresh();
                });
            });
            this._importItem.menu.addMenuItem(item);
        }
    }

    _openUrl(url) {
        try {
            Gio.AppInfo.launch_default_for_uri(url, null);
        } catch (e) {
            this._log(`Could not open ${url}: ${e.message}`);
        }
    }

    _promptForKey() {
        // Activating a menu item closes the status menu; opening a popup in that
        // same tick fights the input grab and kills the entry, so let the close
        // animation finish first.
        if (this._promptIdle)
            return;
        this._promptIdle = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 250, () => {
            this._promptIdle = 0;
            this._openPopupEntry();
            return GLib.SOURCE_REMOVE;
        });
    }

    /* Key entry in a popup owned by the extension rather than by the status
       menu, so dismissing the menu cannot tear the widget down mid-typing. */
    _openPopupEntry() {
        this._closeEntry();

        const popup = new PopupMenu.PopupMenu(this._button, 0.5, St.Side.TOP);
        const holder = new PopupMenu.PopupBaseMenuItem({ reactive: false, can_focus: false });
        const box = new St.BoxLayout({ vertical: true, style: 'spacing: 8px; padding: 6px;' });

        box.add_child(new St.Label({ text: 'Paste OpenRouter API key (input is masked)' }));

        const entry = new St.Entry({
            name: 'openrouter-api-key-entry',
            hint_text: 'sk-or-v1-…',
            can_focus: true,
            reactive: true,
            style: 'min-width: 340px; padding: 8px;',
        });
        try {
            entry.clutter_text.set_password_char?.('•'.charCodeAt(0));
        } catch (e) {
            this._log(`Could not mask the entry: ${e.message}`);
        }
        box.add_child(entry);

        const buttons = new St.BoxLayout({ style: 'spacing: 8px;' });
        const save = new St.Button({ label: 'Save key', can_focus: true, style_class: 'modal-dialog-button' });
        const cancel = new St.Button({ label: 'Cancel', can_focus: true, style_class: 'modal-dialog-button' });
        buttons.add_child(save);
        buttons.add_child(cancel);
        box.add_child(buttons);

        holder.add_child(box);
        popup.addMenuItem(holder);
        this._entryPopup = popup;

        const submit = () => this._submitKey(entry.get_text());
        save.connect('clicked', submit);
        cancel.connect('clicked', () => {
            this._closeEntry();
            this._refresh();
        });
        entry.clutter_text.connect('activate', submit);

        try {
            popup.open();
            entry.grab_key_focus();
        } catch (e) {
            const script = GLib.build_filenamev([GLib.get_home_dir(), '.local', 'share',
                'gnome-shell', 'extensions', this.uuid, 'set-key.sh']);
            this._closeEntry();
            this._setStatus(`Could not open the key entry (${e.message}). Save the key with: ${script} store`,
                'OR !', 'crit');
        }
    }

    _closeEntry() {
        if (!this._entryPopup)
            return;
        const popup = this._entryPopup;
        this._entryPopup = null;
        try {
            popup.close();
        } catch (e) {
            /* already dismissed */
        }
        popup.destroy();
    }

    _submitKey(text) {
        const key = (text ?? '').trim();
        if (!key) {
            this._setStatus('Enter an API key first', 'OR —', 'none');
            return;
        }
        if (this._entryPopup)
            this._closeEntry();
        this._setStatus('Saving key…', 'OR …', 'none');
        this._storeKey(key, null, (err, note) => {
            if (err) {
                this._setStatus(`Could not save the key: ${err}`, 'OR !', 'crit');
                return;
            }
            if (note)
                this._log(`Saved with fallback: ${note}`);
            this._refresh();
        });
    }

    _forgetKey() {
        this._secretTool(
            ['clear', 'service', SECRET_SERVICE, 'account', SECRET_ACCOUNT],
            null,
            (stdout, err) => {
                const removedFile = this._removeKeyFile();
                if (err && !removedFile) {
                    this._setStatus(`Could not remove the key: ${err}`, 'OR !', 'crit');
                    return;
                }
                this._keySource = null;
                this._maskedKey = null;
                this._setRows([]);
                this._setStatus('No API key saved. Use “Set / replace API key…” or “Import key…”.', 'OR —', 'none');
            }
        );
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

    _refresh() {
        if (!this._button)
            return;
        this._getKey((key, source, err) => {
            if (!this._button)
                return;
            if (!key) {
                this._keySource = null;
                this._maskedKey = null;
                this._setRows([]);
                const reason = err && err !== 'no-key'
                    ? err
                    : `No API key found (keyring, ${KEY_FILE}, OPENROUTER_API_KEY are all empty).`;
                this._setStatus(`${reason} Use “Set / replace API key…” or “Import key…”.`, 'OR —', 'none');
                return;
            }
            this._keySource = source;
            this._maskedKey = this._maskKey(key);
            this._fetch(key);
        });
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

