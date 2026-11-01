---
layout: default
---

A small usage indicator for Windows, macOS, and Ubuntu / GNOME. Made by Ammar.

## Windows 10 / 11

**[Download Windows EXE](https://github.com/Ammaranjum/openrouter-usage-checker/releases/latest/download/OpenRouterUsage.exe)**

Keep the EXE in a permanent folder, open it, enter your own OpenRouter API key,
and choose **Save and refresh**. Click **OR** near the clock to see usage.
No installer, administrator access, or separate .NET installation is required.
For updates, exit the app before replacing the EXE. Saved settings and history stay.

[Windows guide](https://github.com/Ammaranjum/openrouter-usage-checker/blob/main/windows/README.md)

## macOS 13 or later

The native Mac app includes a menu bar panel, Keychain storage, local history,
and optional launch at login. It supports Apple Silicon and Intel.

The Mac version is currently a **development build**. A signed, notarized public
download is not available yet. Build on a Mac with Xcode command line tools:

```sh
git clone https://github.com/Ammaranjum/openrouter-usage-checker
cd openrouter-usage-checker
./macos/build.sh
```

Move `macos/dist/OpenRouter Usage.app` to Applications and open it.

[Mac build and signing guide](https://github.com/Ammaranjum/openrouter-usage-checker/blob/main/macos/README.md)
· [Mac development builds](https://github.com/Ammaranjum/openrouter-usage-checker/actions/workflows/macos.yml)

## Ubuntu / GNOME Linux

Requires GNOME Shell 45–48.

```sh
git clone https://github.com/Ammaranjum/openrouter-usage-checker
cd openrouter-usage-checker
./install.sh
```

Log out and back in, then run:

```sh
gnome-extensions enable openrouter-usage-checker@local
```

Click **OR → Preferences…** to enter your API key.

## What the amounts mean

Amounts are in USD. Remaining key cap is separate from your OpenRouter account
balance. Missing amounts and dates stay unknown. History saves observed daily
totals locally; it cannot backfill days before the app ran, and a saved day may
be incomplete if the app was asleep, offline, or closed. Dates use UTC.

No analytics or telemetry is included. Your API key goes to OpenRouter for usage
requests; saved history identifies keys by a SHA-256 fingerprint.

[Source and full setup guide](https://github.com/Ammaranjum/openrouter-usage-checker)
· [Releases](https://github.com/Ammaranjum/openrouter-usage-checker/releases)
· [Report an issue](https://github.com/Ammaranjum/openrouter-usage-checker/issues)
