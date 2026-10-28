// Run with: gjs -m tests/logic-check.mjs
// Actual extension methods, synthetic responses, temporary config; no credentials/network.
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import System from 'system';

const root = GLib.dir_make_tmp('openrouter-logic-test-XXXXXX');
const dir = `${root}/openrouter-extension`;
const assert = (ok, message) => { if (!ok) throw new Error(message); };
const menu = () => ({ items: [], removeAll() { this.items = []; }, addMenuItem(item) { this.items.push(item.text); } });
const PopupMenu = { PopupMenuItem: class { constructor(text) { this.text = text; } } };
const Soup = { Message: { new() {
    return { status: 200, request_headers: { append() {} },
        response_headers: { get_one: () => 'Tue, 27 Oct 2026 12:00:00 GMT' },
        get_status() { return this.status; } };
} } };
let settings;
let failed = false;
try {
    const file = Gio.File.new_for_uri(import.meta.url).get_parent().get_parent().get_child('extension.js');
    const source = new TextDecoder().decode(file.load_contents(null)[1])
        .replace(/^import .*;\n/gm, '').replace('export default class ', 'class ');
    const testGLib = Object.create(GLib);
    Object.defineProperties(testGLib, {
        get_user_config_dir: { value: () => root },
        get_user_data_dir: { value: () => root },
    });
    const Extension = new Function('GLib', 'Gio', 'Soup', 'PopupMenu', 'Extension',
        `${source}\nreturn OpenRouterUsageExtension;`)(testGLib, Gio, Soup, PopupMenu, class {});
    const ext = new Extension();
    ext._button = { destroy() {} };
    ext._historyItem = { menu: menu() };
    ext._setRows = lines => { ext.rows = lines; };
    ext._setStatus = (message, panel, level) => { ext.status = { message, panel, level }; };
    ext._log = () => {};

    ext._render({ label: 'test', limit: 10, limit_remaining: 4.65, usage: 5.35 });
    assert(ext.status.panel === '⬡ OR $4.65 left', 'Capped fallback must have one dollar sign and say left');
    ext._render({ usage: 25.5 });
    assert(ext.status.panel === '⬡ OR ?', 'Never substitute spending when remaining is unavailable');
    ext._render({ usage: 5, usage_daily: 0.42, usage_weekly: 1.5, usage_monthly: 4 });
    assert(ext.status.panel === '⬡ OR ?', 'Daily spending must stay out of the remaining display');
    ext._render({ limit: 10, limit_remaining: 4.65, usage_daily: 0.42, usage_weekly: 1.5 });
    assert(ext.status.panel === '⬡ OR $4.65 left', 'Remaining takes priority over daily spending');
    ext._render({ usage: 5, usage_daily: 0.42, usage_weekly: 1.5, usage_monthly: 4 });
    assert(ext.rows.some(row => row.includes('account balance not tracked')), 'Do not confuse key cap with balance');
    assert(ext.rows.some(row => row === 'This week (UTC): $1.50'), 'Weekly usage must appear');
    assert(ext.rows.length === 9, 'Current figures must fit the allocated menu rows');
    ext._render({ limit: 5, limit_remaining: 0.4, usage_daily: 0 });
    assert(ext.status.panel === '⬡ OR $0.40 left' && ext.status.level === 'crit', 'Remaining display and low-cap warning');
    ext._render({ limit: 5, limit_remaining: 1.5 });
    assert(ext.status.level === 'warn', '30 percent remaining must warn');
    ext._render({ usage: Infinity, limit_remaining: NaN });
    assert(ext.status.panel === '⬡ OR ?', 'Invalid numbers must not render as money');

    const pending = [];
    let currentKey = 'synthetic-key-a';
    ext._loadKey = () => currentKey;
    ext._session = {
        send_and_read_async(message, _priority, cancellable, callback) { pending.push({ message, cancellable, callback }); },
        send_and_read_finish(result) {
            if (result instanceof Error) throw result;
            return { get_data: () => new TextEncoder().encode(result) };
        },
        abort() {},
    };
    const reply = (index, data, status = 200, raw) => {
        const item = pending[index];
        item.message.status = status;
        item.callback(ext._session, raw ?? JSON.stringify({ data }));
    };
    ext._fetch(currentKey);
    currentKey = 'synthetic-key-b';
    ext._fetch(currentKey);
    assert(pending[0].cancellable.is_cancelled(), 'New requests must cancel old requests');
    reply(1, { label: 'new', usage_daily: 0.42, usage: 2 });
    reply(0, { label: 'old', usage_daily: 99, usage: 100 });
    assert(ext.rows[0].includes('new'), 'Old callbacks must not overwrite the current key');
    const history = JSON.parse(new TextDecoder().decode(Gio.File.new_for_path(`${dir}/usage-history.json`).load_contents(null)[1]));
    const id = GLib.compute_checksum_for_string(GLib.ChecksumType.SHA256, currentKey, -1);
    assert(history.keys[id].days['2026-10-27'].usage_usd === 0.42, 'Use the response UTC date for saved history');
    assert(ext._historyItem.menu.items.some(text => text.includes('2026-10-27: $0.42')), 'Display saved days in submenu');
    assert(ext._historyItem.menu.items.some(text => text.includes('incomplete')), 'Disclose incomplete observed totals');
    ext._updateHistory(currentKey, true);
    assert(ext._historyItem.menu.items[0].includes('could not be saved'), 'Show history write failures in the menu');
    ext._fetch(currentKey);
    reply(2, null, 401);
    assert(ext.rows.length === 0 && ext.status.panel === '⬡ OR !', 'Authentication errors clear stale figures');
    ext._fetch(currentKey);
    reply(3, null, 200, '{broken');
    assert(ext.rows.length === 0 && ext.status.message.includes('parse'), 'Malformed responses must show an error');
    ext._fetch(currentKey);
    reply(4, null, 200, new Error('offline'));
    assert(ext.rows.length === 0 && ext.status.message.includes('offline'), 'Network errors clear stale figures');
    ext._fetch(currentKey);
    currentKey = null;
    reply(5, { label: 'removed key', usage_daily: 99 });
    assert(ext.status.message.includes('No API key') && ext._historyItem.menu.items.length === 0,
        'A response after key deletion must not restore old figures');
    currentKey = 'synthetic-key-b';
    ext._fetch(currentKey);
    ext.disable();
    ext._button = { destroy() {} }; // Simulate re-enabling before an old callback arrives.
    ext.status = null;
    reply(6, { label: 'disabled request', usage_daily: 99 });
    assert(ext.status === null, 'Callbacks from a disabled extension must remain ignored after re-enable');

    settings = new Extension();
    settings._button = { destroy() {} };
    settings._log = () => {};
    let refreshed = 0;
    let interval;
    const loop = GLib.MainLoop.new(null, false);
    settings._refresh = () => { refreshed++; loop.quit(); };
    settings._applyRefreshInterval = () => { interval = settings._loadRefreshSeconds(); };
    settings._watchConfig();
    GLib.file_set_contents(`${dir}/prefs.json`, '{"refresh_seconds":90}');
    const timeout = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 3, () => {
        loop.quit(); return GLib.SOURCE_CONTINUE;
    });
    loop.run();
    GLib.source_remove(timeout);
    assert(refreshed > 0 && interval === 90, 'Saved preferences must apply automatically');
    GLib.file_set_contents(`${dir}/prefs.json`, '{"refresh_seconds":999999}');
    assert(settings._loadRefreshSeconds() === 120, 'Reject out-of-range intervals');
    GLib.file_set_contents(`${dir}/key`, 'prefix sk-or-v1-abcdefghijklmnop');
    assert(settings._loadKey() === null, 'Reject keys containing surrounding text');
    GLib.file_set_contents(`${dir}/key`, 'sk-or-v1-abcdefghijklmnop');
    assert(settings._loadKey() === 'sk-or-v1-abcdefghijklmnop', 'Accept valid key format');
    const prefsFile = Gio.File.new_for_uri(import.meta.url).get_parent().get_parent().get_child('prefs.js');
    const prefsSource = new TextDecoder().decode(prefsFile.load_contents(null)[1]);
    const helpers = prefsSource.slice(prefsSource.indexOf('const KEY_PATTERN'), prefsSource.indexOf('export default class'));
    const prefs = new Function('GLib', 'Gio', `${helpers}\nreturn { saveKey, loadKey, loadPrefs };`)(testGLib, Gio);
    prefs.saveKey('sk-or-v1-abcdefghijklmnop');
    const mode = Gio.File.new_for_path(`${dir}/key`).query_info('unix::mode', Gio.FileQueryInfoFlags.NONE, null)
        .get_attribute_uint32('unix::mode') & 0o777;
    assert(mode === 0o600 && prefs.loadKey() === 'sk-or-v1-abcdefghijklmnop', 'Preferences must save owner-only keys');
    GLib.file_set_contents(`${dir}/prefs.json`, 'null');
    assert(prefs.loadPrefs().refresh_seconds === 120, 'Malformed preferences must recover safely');
    print('PASS: actual rendering, request cancellation, stale/error handling, history menu, settings monitor, key validation');
} catch (e) {
    printerr(e.stack ?? e.message);
    failed = true;
} finally {
    settings?.disable();
    for (const path of [`${dir}/key`, `${dir}/prefs.json`, `${dir}/usage-history.json`, dir, root]) {
        const file = Gio.File.new_for_path(path);
        if (file.query_exists(null)) file.delete(null);
    }
}
if (failed) System.exit(1);
