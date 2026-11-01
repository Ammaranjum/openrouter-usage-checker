# Changelog

## 1.4.3

- Fix the Mac 1.0.0 launch path that could leave the app running with no usable UI.
  Mac 1.0.1 creates and retains a native AppKit `OR` status item explicitly.
- Open a usage/settings window at launch; reopening the app restores that window
  even if the menu bar item is hidden. Closing the window keeps the collector running.
- Load the saved Keychain credential off the UI thread after creating the interface.
- Launch the packaged app in Mac CI and verify menu bar clicks, first-run setup,
  close/reopen, and UI availability while Keychain is blocked or fails.

Windows and Linux are unchanged. The Windows binary remains version 1.4.2.

## 1.4.2

- Add the native macOS 13+ menu bar companion for Apple Silicon and Intel, with
  Keychain storage, daily UTC history, refresh settings, and optional login launch.
  Mac distribution remains a development build pending Developer ID signing,
  notarization, and testing on real Macs.
- Make the Windows usage popup more compact by removing its authorship label.
  Keep a smaller Made by Ammar signature in Settings and remove the coffee label.
- Update Windows UI regression checks for the revised footer.
- Add native Windows and macOS CI builds and downloadable workflow artifacts.
- Add GitHub Pages setup and download documentation for all three platforms.

The Linux extension is unchanged in this release.
