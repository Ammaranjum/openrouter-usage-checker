// prefs.js — Preferences UI for OpenRouter Usage Checker
// by Ammar Anjum

import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import { ExtensionPreferences } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

const KEY_PATTERN = /sk-or-[A-Za-z0-9_.-]{16,}/;
const CONFIG_DIR  = GLib.build_filenamev([GLib.get_user_config_dir(), 'openrouter-extension']);
const KEY_FILE    = GLib.build_filenamev([CONFIG_DIR, 'key']);
const PREFS_FILE  = GLib.build_filenamev([CONFIG_DIR, 'prefs.json']);

function ensureConfigDir() {
    const dir = Gio.File.new_for_path(CONFIG_DIR);
    if (!dir.query_exists(null))
        dir.make_directory_with_parents(null);
}

function loadKey() {
    try {
        const file = Gio.File.new_for_path(KEY_FILE);
        if (!file.query_exists(null)) return '';
        const [, bytes] = file.load_contents(null);
        return new TextDecoder().decode(bytes).trim();
    } catch (_) { return ''; }
}

function saveKey(key) {
    ensureConfigDir();
    GLib.file_set_contents(KEY_FILE, key.trim());
    GLib.chmod(KEY_FILE, 0o600);
}

function loadPrefs() {
    try {
        const file = Gio.File.new_for_path(PREFS_FILE);
        if (!file.query_exists(null)) return { refresh_seconds: 120 };
        const [, bytes] = file.load_contents(null);
        return JSON.parse(new TextDecoder().decode(bytes));
    } catch (_) { return { refresh_seconds: 120 }; }
}

function savePrefs(obj) {
    ensureConfigDir();
    GLib.file_set_contents(PREFS_FILE, JSON.stringify(obj, null, 2));
}

export default class OpenRouterPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        window.set_default_size(520, 380);
        window.title = 'OpenRouter Usage Checker';

        const page = new Adw.PreferencesPage({
            title: 'Settings',
            icon_name: 'preferences-system-symbolic',
        });
        window.add(page);

        // ── Header banner ──────────────────────────────────────────────────
        const aboutGroup = new Adw.PreferencesGroup();
        page.add(aboutGroup);

        const banner = new Adw.ActionRow({
            title: 'OpenRouter Usage Checker',
            subtitle: 'by Ammar Anjum',
            icon_name: 'network-transmit-receive-symbolic',
        });
        aboutGroup.add(banner);

        // ── API Key ────────────────────────────────────────────────────────
        const keyGroup = new Adw.PreferencesGroup({
            title: 'API Key',
            description: 'Get your key at openrouter.ai/settings/keys',
        });
        page.add(keyGroup);

        const entryRow = new Adw.PasswordEntryRow({
            title: 'OpenRouter API Key',
            text: loadKey(),
            show_apply_button: true,
        });
        keyGroup.add(entryRow);

        const feedbackRow = new Adw.ActionRow({
            title: 'Status',
            subtitle: loadKey() ? '✓ Key is saved' : 'No key saved yet — enter your sk-or-… key above and press Enter',
        });
        keyGroup.add(feedbackRow);

        entryRow.connect('apply', () => {
            const key = entryRow.text.trim();
            if (!key) {
                try { Gio.File.new_for_path(KEY_FILE).delete(null); } catch (_) {}
                feedbackRow.subtitle = 'Key cleared.';
                return;
            }
            if (!KEY_PATTERN.test(key)) {
                feedbackRow.subtitle = '⚠ Doesn\'t look like a valid sk-or-… key';
                return;
            }
            saveKey(key);
            feedbackRow.subtitle = '✓ Saved — reload the extension to apply';
        });

        // ── Refresh Interval ───────────────────────────────────────────────
        const refreshGroup = new Adw.PreferencesGroup({
            title: 'Refresh Interval',
        });
        page.add(refreshGroup);

        const prefs = loadPrefs();
        const spinRow = new Adw.ActionRow({
            title: 'Poll every',
            subtitle: 'How often to fetch your usage from OpenRouter (min 30 s)',
        });
        refreshGroup.add(spinRow);

        const spin = new Gtk.SpinButton({
            adjustment: new Gtk.Adjustment({
                lower: 30,
                upper: 3600,
                step_increment: 30,
                value: prefs.refresh_seconds ?? 120,
            }),
            valign: Gtk.Align.CENTER,
        });
        spin.connect('value-changed', () => {
            savePrefs({ ...loadPrefs(), refresh_seconds: spin.value });
        });
        spinRow.add_suffix(spin);

        // ── Reload hint ────────────────────────────────────────────────────
        const hintGroup = new Adw.PreferencesGroup();
        page.add(hintGroup);

        hintGroup.add(new Adw.ActionRow({
            title: 'To reload after changes',
            subtitle: 'gnome-extensions disable openrouter-usage-checker@local && gnome-extensions enable openrouter-usage-checker@local',
            css_classes: ['property'],
        }));
    }
}
