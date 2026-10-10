// tests/logic-check.mjs — runs the non-UI logic of the extension (keyring
// access, libsoup request, response parsing, key import, masking) outside
// gnome-shell, so it can be verified without a shell restart.
//
//   gjs -m tests/logic-check.mjs
//
// Keep the helpers here in sync with extension.js.

import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import Soup from 'gi://Soup?version=3.0';

const SECRET_SERVICE = 'openrouter-usage-monitor';
const SECRET_ACCOUNT = 'default';
const API_URL = 'https://openrouter.ai/api/v1/key';
const KEY_FILE = GLib.build_filenamev([GLib.get_user_config_dir(), 'openrouter-usage-monitor', 'api_key']);
const KEY_PATTERN = /sk-or-[A-Za-z0-9_.-]{16,}/;
const IMPORT_SOURCES = [
    { name: 'Cline', path: GLib.build_filenamev([GLib.get_home_dir(), '.cline', 'data', 'secrets.json']) },
    { name: 'opencode', path: GLib.build_filenamev([GLib.get_home_dir(), '.local', 'share', 'opencode', 'auth.json']) },
    { name: 'key file', path: KEY_FILE },
];

let failures = 0;
function check(label, ok, detail) {
    print(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
    if (!ok)
        failures++;
}

function readTextFile(path) {
    try {
        const file = Gio.File.new_for_path(path);
        if (!file.query_exists(null))
            return null;
        const result = file.load_contents(null);
        const bytes = Array.isArray(result) ? (result[1] ?? result[0]) : result;
        return bytes ? new TextDecoder().decode(bytes) : null;
    } catch (e) {
        return null;
    }
}

function maskKey(key) {
    if (!key || key.length < 14)
        return '(empty)';
    return `${key.slice(0, 8)}…${key.slice(-4)}`;
}

/* mirrors _render() in extension.js */
function render(data, keySource, masked) {
    const money = n => `$${n.toFixed(2)}`;
    const count = n => (typeof n === 'number' ? n : null);

    const remaining = count(data.limit_remaining);
    const limit = count(data.limit);
    const used = count(data.usage);
    const pct = limit && limit > 0 && remaining !== null
        ? Math.max(0, Math.min(100, (remaining / limit) * 100))
        : null;

    const lines = [
        `Key: ${data.label || masked || 'OpenRouter key'}`,
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
        `Source: ${keySource ?? 'unknown'}`,
    ];

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
    return { panel, level, lines };
}

function secretToolSync(args, stdinText) {
    let proc;
    try {
        proc = Gio.Subprocess.new(
            ['secret-tool', ...args],
            Gio.SubprocessFlags.STDIN_PIPE | Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE
        );
    } catch (e) {
        return [null, `secret-tool unavailable: ${e.message}`];
    }
    try {
        const result = proc.communicate_utf8(stdinText, null);
        const [, stdout, stderr] = Array.isArray(result) ? result : [result, '', ''];
        if (!proc.get_successful())
            return [null, (stderr || 'Secret Service operation failed').trim()];
        return [(stdout || '').trim(), null];
    } catch (e) {
        return [null, e.message];
    }
}

function httpGetKey(key) {
    const loop = GLib.MainLoop.new(null, false);
    const session = new Soup.Session();
    session.timeout = 15;
    const outcome = { status: 0, body: '', error: null };

    const message = Soup.Message.new('GET', API_URL);
    message.request_headers.append('Authorization', `Bearer ${key}`);
    message.request_headers.append('Accept', 'application/json');

    GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 25, () => {
        if (loop.is_running())
            loop.quit();
        return GLib.SOURCE_REMOVE;
    });

    session.send_and_read_async(message, GLib.PRIORITY_DEFAULT, null, (s, res) => {
        try {
            const bytes = s.send_and_read_finish(res);
            outcome.body = new TextDecoder().decode(bytes.get_data());
            outcome.status = message.get_status();
        } catch (e) {
            outcome.error = e.message;
        }
        if (loop.is_running())
            loop.quit();
    });
    loop.run();
    return outcome;
}

function firstKeyFromConfigs() {
    for (const s of IMPORT_SOURCES) {
        const t = readTextFile(s.path);
        const m = t && t.match(KEY_PATTERN);
        if (m)
            return m[0];
    }
    return null;
}

function main() {
    // 0a. Run extension.js' module-level constant block (imports and class body
    // excluded) so a wrong GI name fails here instead of at shell startup.
    const extDir = import.meta.url.replace('file://', '').replace('/tests/logic-check.mjs', '');
    const extSrc = readTextFile(`${extDir}/extension.js`);
    check('extension.js readable', !!extSrc, `${extDir}/extension.js`);
    if (extSrc) {
        const start = extSrc.indexOf('const SECRET_SERVICE');
        const end = extSrc.indexOf('export default class');
        const region = extSrc.slice(start, end);
        try {
            const built = new Function('GLib', 'Gio', 'Soup', `${region}\nreturn { KEY_FILE, IMPORT_SOURCES, KEY_PATTERN, REFRESH_SECONDS, API_URL };`)(GLib, Gio, Soup);
            check('module constants evaluate', !!built.KEY_FILE && built.IMPORT_SOURCES.length === 3 && built.KEY_PATTERN instanceof RegExp,
                built.KEY_FILE);
        } catch (e) {
            check('module constants evaluate', false, e.message);
        }
        // The class body must at least parse as a module.
        check('extension.js references only bundled imports',
            !/\bimports\./.test(extSrc) && /gi:\/\/Soup\?version=3\.0/.test(extSrc));
        // ui/modal.js cannot be probed without a shell restart; the extension must
        // not depend on it, or a bad path would break loading entirely.
        check('extension.js stays off ui/modal.js', !/ui\/modal\.js/.test(extSrc));
    }

    // 0b. every GI symbol used by the extension must actually exist
    const names = [
        ['GLib.build_filenamev', GLib.build_filenamev],
        ['GLib.get_user_config_dir', GLib.get_user_config_dir],
        ['GLib.get_home_dir', GLib.get_home_dir],
        ['GLib.path_get_dirname', GLib.path_get_dirname],
        ['GLib.file_set_contents', GLib.file_set_contents],
        ['GLib.chmod', GLib.chmod],
        ['GLib.getenv', GLib.getenv],
        ['GLib.timeout_add', GLib.timeout_add],
        ['GLib.timeout_add_seconds', GLib.timeout_add_seconds],
        ['GLib.source_remove', GLib.source_remove],
        ['Gio.File.new_for_path', Gio.File.new_for_path],
        ['Gio.Subprocess.new', Gio.Subprocess.new],
        ['Gio.AppInfo.launch_default_for_uri', Gio.AppInfo.launch_default_for_uri],
        ['Soup.Message.new', Soup.Message.new],
        ['Soup.Session', Soup.Session],
    ];
    const missing = names.filter(([, fn]) => typeof fn !== 'function').map(([n]) => n);
    check('all GI names exist', missing.length === 0, missing.join(', ') || `${names.length} ok`);

    print(`home: ${GLib.get_home_dir()}`);
    print(`config key file: ${KEY_FILE}\n`);

    // 1. keyring lookup, exactly like _getKey()
    const [ringKey, ringErr] = secretToolSync(['lookup', 'service', SECRET_SERVICE, 'account', SECRET_ACCOUNT], null);
    check('secret-tool lookup runs', ringErr === null, ringErr ?? 'ok');
    print(`      keyring: ${ringKey ? maskKey(ringKey) : 'empty'}`);

    // 2. fallback chain: keyring > file > env > app configs
    const fileText = readTextFile(KEY_FILE);
    const fileKey = fileText ? ((fileText.match(KEY_PATTERN)?.[0] ?? fileText).trim() || null) : null;
    const envKey = (GLib.getenv('OPENROUTER_API_KEY') ?? '').trim() || null;
    const key = ringKey || fileKey || envKey || firstKeyFromConfigs();
    check('a usable key is resolvable', !!key, key ? maskKey(key) : 'none found anywhere');

    // 3. import scan reports masked keys only
    const seen = new Set();
    const found = [];
    for (const s of IMPORT_SOURCES) {
        const t = readTextFile(s.path);
        const m = t && t.match(KEY_PATTERN);
        if (m && !seen.has(m[0])) {
            seen.add(m[0]);
            found.push(`${s.name}: ${maskKey(m[0])}`);
        }
    }
    check('import scan finds app configs', found.length > 0, found.join(' | '));

    // 4. live request + parsing
    if (key) {
        const out = httpGetKey(key);
        check('HTTPS request completed', out.error === null, out.error ?? `HTTP ${out.status}`);
        let data = null;
        try {
            data = JSON.parse(out.body)?.data;
        } catch (e) {
            check('response is JSON', false, e.message);
        }
        if (data) {
            const r = render(data, ringKey ? 'login keyring' : 'file', maskKey(key));
            check('panel text rendered', /^OR /.test(r.panel), `${r.panel} [${r.level}]`);
            check('all menu rows present', r.lines.length === 10, `${r.lines.length} rows`);
            print('');
            r.lines.forEach(l => print(`      ${l}`));
        }
    }

    // 6. the old failure mode: a key with no credit cap must not look broken
    const uncapped = render({ label: 'no-cap key', limit: null, limit_remaining: null, usage: 2.5, usage_daily: 0.25 }, 'file', 'sk-or-…');
    check('uncapped key does not error', uncapped.panel === 'OR $2.50 used', uncapped.panel);
    const empty = render({ label: 'z' }, 'file', 'sk-or-…');
    check('missing numbers degrade gracefully', empty.panel === 'OR ?', `${empty.panel} ${empty.level}`);
    const crit = render({ label: 'z', limit: 5, limit_remaining: 0.4, usage: 4.6 }, 'file', 'sk-or-…');
    check('low remaining flags critical', crit.level === 'crit', `${crit.panel} ${crit.level}`);
    const warn = render({ label: 'z', limit: 5, limit_remaining: 1.5, usage: 3.5 }, 'file', 'sk-or-…');
    check('mid remaining flags warn', warn.level === 'warn', `${warn.panel} ${warn.level}`);

    print(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`);
    return failures;
}

main();
