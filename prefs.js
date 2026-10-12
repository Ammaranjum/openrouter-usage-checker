// prefs.js — Preferences UI for OpenRouter Usage Checker
// Opened via "Preferences…" in the panel menu or GNOME Extensions app.

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
        window.set_default_size(480, 320);

        const page = new Adw.PreferencesPage();
        window.add(page);

        // ── API Key group ──────────────────────────────────────────────────
        const keyGroup = new Adw.PreferencesGroup({
            title: 'API Key',
            description: 'Your OpenRouter key (sk-or-…). Stored in ~/.config/openrouter-extension/key',
        });
        page.add(keyGroup);

        const keyRow = new Adw.ActionRow({ title: 'API Key' });
        keyGroup.add(keyRow);

        const keyEntry = new Gtk.Entry({
            text: loadKey(),
            placeholder_text: 'sk-or-v1-…',
            visibility: false,    // masked by default
            input_purpose: Gtk.InputPurpose.PASSWORD,
            hexpand: true,
            valign: Gtk.Align.CENTER,
        });
        keyRow.add_suffix(keyEntry);
        keyRow.set_activatable_widget(keyEntry);

        // Toggle visibility button
        const visBtn = new Gtk.ToggleButton({
            icon_name: 'view-reveal-symbolic',
            valign: Gtk.Align.CENTER,
            tooltip_text: 'Show / hide key',
        });
        visBtn.connect('toggled', () => {
            keyEntry.set_visibility(visBtn.active);
            visBtn.icon_name = visBtn.active ? 'view-conceal-symbolic' : 'view-reveal-symbolic';
        });
        keyRow.add_suffix(visBtn);

        // Status label
        const statusLabel = new Gtk.Label({
            label: '',
            valign: Gtk.Align.CENTER,
            css_classes: ['dim-label'],
        });
        keyGroup.add(new Adw.ActionRow({ title: '' })); // spacer trick — use real row below
        // Replace with a proper label row
        const statusRow = new Adw.ActionRow({ title: 'Status' });
        statusRow.add_suffix(statusLabel);
        keyGroup.add(statusRow);

        // Save button
        const saveBtn = new Gtk.Button({
            label: 'Save Key',
            css_classes: ['suggested-action'],
            valign: Gtk.Align.CENTER,
        });
        saveBtn.connect('clicked', () => {
            const key = keyEntry.text.trim();
            if (!key) {
                // Clear key
                try { Gio.File.new_for_path(KEY_FILE).delete(null); } catch (_) {}
                statusLabel.label = 'Key cleared.';
                return;
            }
            if (!KEY_PATTERN.test(key)) {
                statusLabel.label = '⚠ Does not look like a valid sk-or-… key.';
                return;
            }
            saveKey(key);
            statusLabel.label = '✓ Saved.';
        });
        keyRow.add_suffix(saveBtn);

        // ── Refresh interval group ─────────────────────────────────────────
        const refreshGroup = new Adw.PreferencesGroup({ title: 'Refresh Interval' });
        page.add(refreshGroup);

        const prefs = loadPrefs();
        const refreshRow = new Adw.ActionRow({
            title: 'Interval (seconds)',
            subtitle: 'Minimum 30 s. Changes take effect after the next refresh cycle.',
        });
        refreshGroup.add(refreshRow);

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
        refreshRow.add_suffix(spin);
    }
}
