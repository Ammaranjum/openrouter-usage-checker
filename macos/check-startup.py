#!/usr/bin/env python3
"""Run the actual packaged app, bounded by a timeout, without using credentials."""
import base64
from pathlib import Path
import subprocess
import sys

app = Path(__file__).resolve().parent / "dist" / "OpenRouter Usage.app"
result = subprocess.run(
    [str(app / "Contents/MacOS/OpenRouterUsage"), "--startup-check"],
    capture_output=True, text=True, timeout=30,
)
for line in result.stdout.splitlines():
    if line.startswith("STARTUP_SCREENSHOT:"):
        (app.parent / "startup-check.png").write_bytes(base64.b64decode(line.split(":", 1)[1]))
    else:
        print(line)
print(result.stderr, file=sys.stderr, end="")
if result.returncode != 0 or "ALL PACKAGED MAC STARTUP CHECKS PASSED" not in result.stdout:
    sys.exit("Packaged Mac startup check failed")
