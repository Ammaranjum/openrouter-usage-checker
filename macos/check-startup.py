#!/usr/bin/env python3
"""Exercise the shipped ZIP using direct and LaunchServices launches on Mac CI."""
import base64
from pathlib import Path
import platform
import subprocess
import sys
import tempfile

root = Path(__file__).resolve().parent
archive = root / 'dist/OpenRouterUsage-macOS-universal.zip'
print('Host:', platform.mac_ver()[0], platform.machine(), flush=True)
with tempfile.TemporaryDirectory(prefix='openrouter-launch-') as temporary:
    directory = Path(temporary)
    subprocess.run(['ditto', '-x', '-k', str(archive), str(directory)], check=True)
    app = directory / 'OpenRouter Usage.app'
    subprocess.run(['codesign', '--verify', '--strict', str(app)], check=True)
    for mode in ['direct', 'launchservices']:
        print('Launch mode:', mode, flush=True)
        if mode == 'direct':
            command = [str(app / 'Contents/MacOS/OpenRouterUsage'), '--startup-check']
        else:
            stdout = directory / 'launch.stdout'
            stderr = directory / 'launch.stderr'
            command = ['open', '-n', '-W', '--stdout', str(stdout), '--stderr', str(stderr),
                       str(app), '--args', '--startup-check']
        try:
            result = subprocess.run(command, capture_output=True, text=True, timeout=45)
        except subprocess.TimeoutExpired as error:
            print(error.stdout or '', error.stderr or '', file=sys.stderr)
            sys.exit('Packaged Mac launch timed out: ' + mode)
        output = result.stdout if mode == 'direct' else stdout.read_text() if stdout.exists() else ''
        errors = result.stderr if mode == 'direct' else stderr.read_text() if stderr.exists() else ''
        for line in output.splitlines():
            if line.startswith('STARTUP_SCREENSHOT:'):
                image = root / 'dist' / ('startup-check-' + mode + '.png')
                image.write_bytes(base64.b64decode(line.split(':', 1)[1]))
            else:
                print(line)
        print(errors, file=sys.stderr, end='')
        if result.returncode != 0 or 'ALL PACKAGED MAC STARTUP CHECKS PASSED' not in output:
            print(result.stderr, file=sys.stderr)
            sys.exit('Packaged Mac startup check failed: ' + mode)
    print('Launch mode: ordinary app, no test flag', flush=True)
    process = subprocess.Popen([str(app / 'Contents/MacOS/OpenRouterUsage')],
                               stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        subprocess.run(['swift', str(root / 'check-window.swift'), str(process.pid)],
                       check=True, timeout=30)
    finally:
        process.terminate()
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait()
print('PASS: distributed ZIP launches through both paths')
