# Convertly — Privacy Policy

_Last updated: October 2026_

Convertly processes your files locally on your device. Your files are not uploaded to our servers
because Convertly does not operate a file-processing server.

## Your files

- Files you open, drop or paste are read directly by your browser and processed in memory using
  JavaScript, Web Workers and WebAssembly that are **bundled inside the extension**.
- Results are saved through Chrome's own download manager.
- Convertly keeps no copies. When you close the Convertly tab, everything in memory is released.
- Passwords typed to open a protected ZIP or PDF are used only in memory, on your device, to
  decrypt that file. They are never stored and never sent anywhere.

## No network access

- The extension pages run under a Content Security Policy that only allows the extension itself:
  `connect-src 'self' blob: data:` — connections to external hosts are blocked by the browser.
- Convertly loads no remote code, fonts, WebAssembly or scripts (no CDNs).
- The tools keep working with Wi-Fi turned off.

## What is stored on your device

Stored in `chrome.storage.local` on this device only:

| Data | Purpose |
| --- | --- |
| Preferences (theme, language, default quality, download folder, confirmations) | Remember your settings |
| Favorite tool ids | Show your favorites |
| Recently used tool ids + date (optional, can be disabled and cleared) | "Recently used" section |

File names and file contents are **never** stored.

## What Convertly never sends

- File names or file contents
- Conversion history
- Browsing history
- Your IP address or device information
- Telemetry, crash reports or usage statistics of any kind

No analytics or tracking SDKs are included. There are no accounts and no login.

## Permissions

| Permission | Why |
| --- | --- |
| `storage` | Save the preferences listed above |
| `downloads` | Save results (optionally into a sub-folder of Downloads, or with a "Save as" dialog) |

Convertly requests **no access to the websites you visit** (no host permissions, no content
scripts, no `tabs` permission).

## Device capabilities

At startup Convertly checks locally which browser features exist (WebAssembly, workers, image
encoders, number of CPU threads) to enable only the tools that can run. These values are used only
on your device and never transmitted.

## Open source

Convertly is free software (GPL-3.0-or-later): anyone can verify these statements in its source
code (linked from **About → Source code** inside the extension).

## Contact

Questions about this policy: use the support contact listed on the Chrome Web Store page.
