# OpenRouter Usage for Mac

A native SwiftUI menu bar companion for **macOS 13 Ventura or later**, with a
universal build for Apple Silicon and Intel. No Electron, web view, third-party
packages, analytics, or management key required.

## Build and install on a Mac

Install Xcode command line tools (`xcode-select --install`) or Xcode 15 or newer.
From this repository:

```bash
./macos/build.sh
open "macos/dist/OpenRouter Usage.app"
```

The script runs the Swift tests, builds both architectures, generates the icon,
and packages `macos/dist/OpenRouterUsage-macOS-universal.zip`. Drag **OpenRouter
Usage.app** into **Applications** before enabling **Open at login**. Click the
chart icon in the menu bar, paste your key, and choose **Save and refresh**.
This is a menu bar app; it has no Dock icon. Quit from its panel.

Local builds are ad-hoc signed for development. There is no published, notarized
Mac download yet. The macOS GitHub Actions workflow also produces a development
ZIP after a successful run; that artifact is not a public production release.
Do not disable Gatekeeper to distribute an unsigned app.

## Interface

The compact panel uses SwiftUI controls, system typography, semantic colors,
SF Symbols, native keyboard focus, and system light/dark appearance. No custom
motion is added. It includes:

- Today's spending in USD, weekly/monthly/all-time spending, and remaining key
  cap. The cap is not the account balance. Unreported values remain unknown.
- Seven most recent saved UTC dates, with each observation's exact timestamp.
  Missing dates are unknown, not zero; saved observations are not final totals.
- Refresh (⌘R), a masked replacement-key field, delete-key confirmation, refresh
  intervals from 30 seconds to one hour, optional menu bar amount, and optional
  login launch through macOS Service Management.
- Explicit network, rejected-key, rate-limit, and history errors. Expired values
  are hidden after the refresh interval plus 30 seconds. Opening the panel
  refreshes overdue data after sleep. Failed requests hide current amounts.

## Credentials and local data

The API key is stored as a generic password in this Mac's **Keychain**, with
`kSecAttrAccessibleWhenUnlockedThisDeviceOnly`. The replacement field starts
empty; the stored key is never displayed. Only the refresh interval and menu
amount preference use UserDefaults. Delete key removes the Keychain item;
it does not revoke the API key at OpenRouter or erase history.

The packaged app enables App Sandbox and Hardened Runtime. Its only sandbox
capability is outbound network access. App Transport Security defaults remain
intact. Requests use a fixed HTTPS endpoint, an ephemeral session without disk
cache or cookies, request/resource timeouts, a 64 KiB response limit, and refused
redirects. Raw response bodies, headers, and network errors are never displayed
or logged. New requests cancel older ones; generation checks prevent a response
for a previous key from changing current usage or history.

History is written inside the app sandbox, typically:

```text
~/Library/Containers/com.ammaranjum.openrouter-usage/Data/Library/Application Support/OpenRouterUsage/usage-history.json
```

It uses the Linux/Windows version-1 UTC JSON schema, a SHA-256 key fingerprint
instead of the API key, owner-only directory/file permissions (`700`/`600`),
and atomic replacement. Corrupt or unknown history is preserved and reported.
Repeated observations replace the same day's value rather than accumulating it;
older responses cannot roll a saved day backwards. Missing daily usage does not
create a zero entry. A plausible HTTP Date header determines the UTC observation
date, falling back to local time when missing or more than five minutes away.

For full removal: delete the saved key in Settings, turn off **Open at login**,
quit, remove the app, then remove its sandbox container if you also want to erase
history and preferences. Deleting only the app does not remove its Keychain item.

## Signed distribution

Use your own Apple Developer ID Application certificate and a notarization
profile stored using `xcrun notarytool store-credentials`. Never commit signing
certificates, passwords, or API keys. Then run on a Mac:

```bash
SIGNING_IDENTITY='Developer ID Application: Your Name (TEAMID)' \
NOTARY_PROFILE='your-notary-profile' ./macos/build.sh
```

The script signs with App Sandbox entitlements, Hardened Runtime, and a secure
timestamp, submits the ZIP to Apple, staples and validates the ticket, checks
Gatekeeper, and recreates the ZIP with the stapled app. Keep the bundle identifier
and signing team stable across updates so Keychain and sandbox identity remain
consistent. Signing/notarization must succeed before calling this ready for
public distribution. This is not an App Store submission or a security audit.

References: [MenuBarExtra](https://developer.apple.com/documentation/swiftui/menubarextra),
[Keychain Services](https://developer.apple.com/documentation/security/keychain-services),
[App Sandbox](https://developer.apple.com/documentation/security/app-sandbox),
[Apple notarization](https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution),
and [OpenRouter current-key API](https://openrouter.ai/docs/api/api-reference/api-keys/get-current-api-key).

## Validation

```bash
cd macos
swift test
```

Tests cover input and numeric validation, unknown versus zero, key fingerprints,
UTC rollover, replacement rather than addition, older-observation rejection,
per-key separation, private file permissions, and corrupt-file preservation.
The build script also compiles the UI, verifies its signature, and verifies both
binary architectures. CI runs on a Mac; it does not publish releases.

Before release, test the packaged app on actual Apple Silicon and Intel Macs:
first-run save, rejected key, offline/timeouts, refresh after sleep/UTC midnight,
key replacement during a request, delete/relaunch, Keychain denial/locked state,
login launch, history persistence, and updates signed by the same team. Check
VoiceOver, keyboard navigation, light/dark appearance, Increase Contrast, Reduce
Motion, scaled display text, and panel placement on a small screen. Unit tests and
compilation do not establish these UI, Keychain, sandbox, or live API behaviors.
