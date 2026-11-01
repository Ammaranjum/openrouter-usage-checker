#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")"
if [[ "$(uname -s)" != Darwin ]]; then
    echo 'Build on a Mac with Xcode command line tools (macOS 13 or newer).'
    exit 1
fi
# No credentials are needed for a local build. Distribution needs Developer ID.
identity="${SIGNING_IDENTITY:--}"
if [[ -n "${NOTARY_PROFILE:-}" && "$identity" == '-' ]]; then
    echo 'Set SIGNING_IDENTITY to your Developer ID Application certificate before notarizing.'
    exit 1
fi
swift test
swift build -c release --arch arm64 --arch x86_64
binary_directory="$(swift build -c release --arch arm64 --arch x86_64 --show-bin-path)"
app="$PWD/dist/OpenRouter Usage.app"
mkdir -p "$app/Contents/MacOS" "$app/Contents/Resources" "$PWD/.build/AppIcon.iconset"
cp "$binary_directory/OpenRouterUsage" "$app/Contents/MacOS/OpenRouterUsage"
cp Info.plist "$app/Contents/Info.plist"
cp ../LICENSE "$app/Contents/Resources/LICENSE"
swift GenerateIcon.swift "$PWD/.build/AppIcon.iconset"
iconutil -c icns "$PWD/.build/AppIcon.iconset" -o "$app/Contents/Resources/AppIcon.icns"
signing_options=(--force --options runtime --entitlements OpenRouterUsage.entitlements --sign "$identity")
if [[ "$identity" != '-' ]]; then signing_options+=(--timestamp); fi
codesign "${signing_options[@]}" "$app"
codesign --verify --strict --verbose=2 "$app"
lipo "$app/Contents/MacOS/OpenRouterUsage" -verify_arch arm64 x86_64
archive="$PWD/dist/OpenRouterUsage-macOS-universal.zip"
# ditto can update existing archives; remove the old artifact to avoid stale entries.
rm -f "$archive"
ditto -c -k --sequesterRsrc --keepParent "$app" "$archive"
if [[ -n "${NOTARY_PROFILE:-}" ]]; then
    xcrun notarytool submit "$archive" --keychain-profile "$NOTARY_PROFILE" --wait
    xcrun stapler staple "$app"
    xcrun stapler validate "$app"
    spctl --assess --type execute --verbose=2 "$app"
    rm -f "$archive"
    ditto -c -k --sequesterRsrc --keepParent "$app" "$archive"
else
    echo 'Development build only. Sign with Developer ID and notarize before public distribution.'
fi
printf 'Built: %s\n' "$archive"
