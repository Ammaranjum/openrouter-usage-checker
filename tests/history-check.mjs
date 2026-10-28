// Run with: gjs -m tests/history-check.mjs
// Exercises the actual extension method with temporary files and synthetic data.
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import System from 'system';

const root = GLib.dir_make_tmp('openrouter-history-test-XXXXXX');
const historyPath = `${root}/openrouter-extension/usage-history.json`;
const assert = (ok, message) => { if (!ok) throw new Error(message); };
const read = () => new TextDecoder().decode(Gio.File.new_for_path(historyPath).load_contents(null)[1]);
const keyA = 'synthetic-key-a';
const keyB = 'synthetic-key-b';
const hash = key => GLib.compute_checksum_for_string(GLib.ChecksumType.SHA256, key, -1);
let failed = false;

try {
    const sourcePath = Gio.File.new_for_uri(import.meta.url).get_parent().get_parent().get_child('extension.js');
    const source = new TextDecoder().decode(sourcePath.load_contents(null)[1])
        .replace(/^import .*;\n/gm, '').replace('export default class ', 'class ');
    const testGLib = {
        build_filenamev: GLib.build_filenamev,
        get_user_config_dir: () => root,
        get_user_data_dir: () => root,
        compute_checksum_for_string: GLib.compute_checksum_for_string,
        ChecksumType: GLib.ChecksumType,
        mkdir_with_parents: GLib.mkdir_with_parents,
    };
    const Extension = new Function('GLib', 'Gio', 'Extension',
        `${source}\nreturn OpenRouterUsageExtension;`)(testGLib, Gio, class {});
    const extension = new Extension();
    const errors = [];
    extension._log = message => errors.push(message);
    const record = (key, usage, date, total = usage) => extension._recordUsage(
        key, { usage_daily: usage, usage: total }, new Date(date));

    record(keyA, 0.123456, '2026-10-27T10:00:00Z', 10.123456);
    record(keyA, 0.25, '2026-10-27T12:00:00Z', 10.25);
    let days = JSON.parse(read()).keys[hash(keyA)].days;
    assert(Object.keys(days).length === 1 && days['2026-10-27'].usage_usd === 0.25,
        'Repeated polls must replace the daily total, not add it');
    assert(days['2026-10-27'].first_observed_at === '2026-10-27T10:00:00.000Z', 'Keep first observation');
    assert(days['2026-10-27'].last_observed_at === '2026-10-27T12:00:00.000Z', 'Update last observation');
    assert(days['2026-10-27'].total_usage_usd === 10.25, 'Keep cumulative usage');
    record(keyA, 0.1, '2026-10-27T11:00:00Z', 10.1);
    assert(JSON.parse(read()).keys[hash(keyA)].days['2026-10-27'].usage_usd === 0.25,
        'An older observation must not overwrite newer data');
    record(keyA, 0, '2026-10-28T00:00:00Z', 10.25);
    record(keyA, 0.123456, '2026-10-30T01:00:00+05:00', 10.373456);
    record(keyB, 2, '2026-10-29T21:00:00Z');
    const restarted = new Extension();
    restarted._log = message => errors.push(message);
    restarted._recordUsage(keyA, { usage_daily: 0.5, usage: 10.75 }, new Date('2026-10-30T01:00:00Z'));
    const history = JSON.parse(read());
    days = history.keys[hash(keyA)].days;
    assert(days['2026-10-28'].usage_usd === 0, 'Preserve genuine zero values');
    assert(days['2026-10-29'].usage_usd === 0.123456, 'Use UTC dates and retain precision');
    assert(days['2026-10-30'].usage_usd === 0.5, 'Preserve history across extension restarts');
    assert(Object.keys(history.keys).length === 2 && history.keys[hash(keyB)].days['2026-10-29'].usage_usd === 2,
        'Keep separate histories for separate keys');
    assert(!read().includes(keyA) && !read().includes(keyB), 'Never save plaintext keys');
    const before = read();
    for (const value of [undefined, null, -1, NaN, Infinity, '2'])
        record(keyA, value, '2026-10-31T00:00:00Z');
    assert(read() === before, 'Missing or invalid daily totals must not create records');
    const mode = Gio.File.new_for_path(historyPath).query_info('unix::mode', Gio.FileQueryInfoFlags.NONE, null)
        .get_attribute_uint32('unix::mode') & 0o777;
    assert(mode === 0o600, 'History must be owner-only');
    assert(errors.length === 0, 'Valid observations must save without errors');
    GLib.file_set_contents(historyPath, '{broken');
    record(keyA, 1, '2026-10-31T00:00:00Z');
    assert(read() === '{broken' && errors.length === 1, 'Preserve damaged history and report failure');
    print('PASS: daily updates, UTC rollover, precision, restart, key separation, invalid data, permissions, and damaged history');
} catch (e) {
    printerr(e.stack ?? e.message);
    failed = true;
} finally {
    for (const path of [historyPath, `${root}/openrouter-extension`, root]) {
        const file = Gio.File.new_for_path(path);
        if (file.query_exists(null)) file.delete(null);
    }
}
if (failed) System.exit(1);
