---
name: web-browser
description: "Browser automation via Chrome/Chromium CDP. Use when you need to navigate pages, inspect DOM state, click or pick elements, dismiss cookie dialogs, emulate devices, or take screenshots."
license: Stolen from Mario
---

# Web Browser

CDP helpers for browser automation.

## Start

```bash
./scripts/start.js
./scripts/start.js --profile
./scripts/start.js --reset-profile
```

Optional env vars:

```bash
BROWSER_BIN=/path/to/chrome ./scripts/start.js
BROWSER_DEBUG_PORT=9333 ./scripts/start.js
BROWSER_EXTRA_ARGS='--window-size=1440,1200' ./scripts/start.js
```

Notes:
- Uses an isolated profile under `~/.cache/agent-web/browser/`.
- On Linux/container setups, `start.js` auto-detects common Chromium paths and adds container-safe flags when needed.
- `--profile` copies a local Chrome/Chromium profile into the isolated cache.

Stop the managed browser:

```bash
./scripts/stop.js
```

## Navigate

```bash
./scripts/nav.js https://example.com
./scripts/nav.js https://example.com --new
```

## Evaluate JavaScript

```bash
./scripts/eval.js 'document.title'
./scripts/eval.js 'document.querySelectorAll("a").length'
```

Use single quotes around the JavaScript when possible.

## Screenshots

```bash
./scripts/screenshot.js
./scripts/screenshot.js --full-page
./scripts/screenshot.js --device iphone-14
```

## Device emulation

```bash
./scripts/emulate.js --list
./scripts/emulate.js iphone-14
./scripts/emulate.js pixel-7 --landscape
./scripts/emulate.js --reset
```

The active emulation applies to `nav.js`, `eval.js`, `pick.js`, `dismiss-cookies.js`, and `screenshot.js`.

## Pick elements

```bash
./scripts/pick.js "Click the submit button"
```

## Dismiss cookie dialogs

```bash
./scripts/dismiss-cookies.js
./scripts/dismiss-cookies.js --reject
```

Typical flow:

```bash
./scripts/start.js
./scripts/nav.js https://example.com
./scripts/dismiss-cookies.js
./scripts/screenshot.js --full-page
```

## Logs

`start.js` also starts background logging under `~/.cache/agent-web/logs/`.

```bash
./scripts/watch.js
./scripts/logs-tail.js
./scripts/logs-tail.js --follow
./scripts/net-summary.js
```
