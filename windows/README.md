# OpenRouter Usage for Windows

A separate Windows system-tray app. The Linux GNOME extension stays in the
repository root and has its own installer and storage.

## Run

1. [Download OpenRouterUsage.exe](https://github.com/Ammaranjum/openrouter-usage-checker/releases/latest/download/OpenRouterUsage.exe) and keep it in a permanent folder, such as `Documents/OpenRouter Usage`.
2. Double-click `OpenRouterUsage.exe`. No administrator access or separate .NET installation is needed for the self-contained release.
3. Enter your OpenRouter key and save. Look for **OR** near the Windows clock;
   Windows may put it in the hidden-icons overflow menu.
4. Left-click the OR tray icon to open remaining credit, current usage, recent
   days, refresh, and settings. The large remaining amount appears below the title
   and **Made by Ammar**. The balance and “remaining” share one line. Today/week/month
   amounts align on the right. Refresh uses the small icon beside the title, with
   a tooltip and keyboard-accessible button. Details and the separate Refresh row
   are removed. A single blue progress bar shows cap usage only when a positive
   cap and remaining amount are reported. “Monthly limit” appears only when the
   API reports a monthly reset. Popup width is approximately 288 logical pixels;
   the entire popup uses one custom native control, including matching Lucide line
   icons, a blue OR logo, cursive credit, spacing, typography, dividers, and hover
   treatment. Recent days opens a matching flyout to the left when space allows,
   with seven short dates and amounts. It stays within the screen work area.
   Refresh retains the last successful values while checking the same key, and
   updates the small status line without collapsing the popup. Failures clear
   figures and show the error; changing the saved key clears the previous key's
   snapshot before fetching.

Only the OR icon remains in the tray. There is no floating display or automatic
usage popup. The menu opens when clicked, and the tray tooltip reports remaining
key cap, never today's or total spending. If remaining is unavailable, it says so.
Settings opens automatically only when no usable saved key is available, or
when you choose Settings. Closing Settings keeps the collector running.
Use **Save and refresh** to replace a key and fetch its usage immediately.
Settings stays open to show connection success or errors; choose **Close** when done.
Settings uses a compact 448 logical-pixel client width and scales with DPI.
Its height fits the native button and footer measurements, with a 16-pixel gap
before the footer and no scrolling. A reserved two-line status area means
saving and connection feedback cannot change the window size or shift controls.
The key field has an adjacent fixed-width Show/Hide button. Refresh uses a dropdown
with 30, 60, 90, 120 seconds, and 5, 10, 30, 60 minutes; new installations default
to 120 seconds. An existing custom interval is preserved as an extra choice.
Only the title bar names the app. The history explanation is omitted.
“Refresh every,” its dropdown, and Delete saved key share one row.
The single-line footer places cursive **Made by Ammar** at the far left and
**Buy me a Coffee ☕** at the far right. Both use a readable medium grey and align
with the key row outer edges.
The coffee text is not a link.
To stop it, left-click the OR tray icon and choose **Exit**. Your key and history
stay saved. On update, exit the running copy before replacing the EXE.
If launched again, it shows a message instead of starting a second collector.

The EXE is portable and can be transferred by itself. Its bundled runtime is
inside the executable; the other files in the ZIP are instructions and licenses.
Built-in single-file compression reduces the EXE's size without removing the
runtime. The embedded assemblies are decompressed when the app starts, which
can increase startup time. Actual startup performance needs checking on Windows.
Each user enters their own key and has separate settings and history.

The popup and Settings follow the Windows app light/dark preference, including
changes while running. High-contrast mode uses Windows system colors. Native
window borders, dropdown controls, and other system details may differ
between Windows versions. Dark title-bar styling is requested on Windows 11;
older Windows keeps its native title bar. No theme library or web runtime is used.

Targets Windows 10/11 x64. An ARM64 build can be generated separately. Native
Windows behavior must be verified on a Windows machine; Linux build checks do
not prove tray rendering, DPI layout, or Windows key encryption works end to end.

## Local data and privacy

Local data is stored in `%LOCALAPPDATA%\OpenRouterUsage`:

- `settings.json`: refresh interval and a key encrypted with Windows DPAPI for
  the current user. Use **Delete saved key** in Settings to remove the key while
  preserving history. Clearing the key field and saving also removes it.
- `usage-history.json`: daily observations grouped by a SHA-256 key fingerprint,
  with the same schema as the Linux version. It contains no plaintext API key.

Daily totals come from `GET https://openrouter.ai/api/v1/key`, using your normal
API key; no management key is required. The menu distinguishes the key's spending
cap from account balance. Amounts are in USD. Each refresh replaces that day's
total instead of adding it again. Full reported precision is stored.

Dates use UTC (reset at 05:00 Pakistan time). Dates with no observation are
unknown, not zero. Saved days may be incomplete if the PC is asleep, offline,
the app is closed, or more spending happens after the last refresh. They are
last observed totals, not guaranteed final billing totals. The recent-days menu
shows seven entries; the file retains all collected days. Historical usage before
the app first runs is not backfilled.

To run at login, press Win+R, enter `shell:startup`, and place a shortcut to the
executable there. This is optional. Keep the executable in its original location
while using that shortcut.

To remove: choose Exit, remove any Startup shortcut, then delete the app folder.
History is retained. Delete `%LOCALAPPDATA%\OpenRouterUsage` as well to remove
all saved settings and history. Copying the settings file to another Windows
account/computer does not transfer a usable key; enter the key there separately.
No analytics, telemetry, server, or auto-updater is included.

## Build from source

Install the [.NET 10 SDK](https://dotnet.microsoft.com/en-us/download/dotnet/10.0), then run in PowerShell:

```powershell
./build.ps1
# For Windows on ARM:
./build.ps1 -Runtime win-arm64
```

The zip is written under `dist/`. Builds require internet access to restore the
Microsoft targeting/runtime packs. No third-party runtime packages are used. Static Lucide icons are included
under their ISC license (`Assets/LUCIDE-LICENSE`), also embedded in the EXE.

On Linux, build the same Windows binary with:

```sh
dotnet publish windows/OpenRouterUsage.csproj -c Release -r win-x64 --self-contained true -p:PublishSingleFile=true -p:IncludeNativeLibrariesForSelfExtract=true -p:DebugType=None -o windows/dist/win-x64
```

Core checks use synthetic HTTP responses and temporary files, without credentials:

```sh
dotnet run --project windows/tests/CoreChecks.csproj
```

These checks cover API parsing, errors/cancellation, USD formatting, UTC date
assignment, key separation, precision, history updates, and damaged-file preservation.

Windows-only UI regression checks (requires the SDK on Windows):

```powershell
dotnet run --project windows/tests/ui/UiChecks.csproj
```

These checks create sample controls without API requests or settings writes. They
check feedback sizing, control bounds, the default interval, hidden-menu rendering,
stable refresh, and clearing stale data on errors. They cannot run on Linux.
