<h1 align="center">Proxer</h1>


 <img width="1672" height="941" alt="banner" src="https://github.com/user-attachments/assets/8fdebf1c-f3b1-484b-aac0-6918013528a8" />


## Description

Proxer is a desktop HTTP, HTTPS, and WebSocket interception proxy built with Tauri v2 and a Next.js UI. It captures traffic into a local SQLite database, shows it in a real-time History view, scans captured traffic for secrets and exposed surface area, and provides Burp-style tools for inspecting, replaying, and testing requests.

## Features

- HTTP and HTTPS proxy with CONNECT support
- WebSocket upgrade proxying and WebSocket traffic capture
- Optional TLS interception for HTTPS visibility
- Custom TLS client fingerprint profiles backed by `primp`, including Chrome, Safari, Edge, Firefox, Opera, and random profiles with Android, iOS, Linux, macOS, Windows, and random OS impersonation options
- Upstream proxy support for direct, HTTP, HTTPS, and SOCKS5 routing
- HTTP History with request and response details
- Sitemap view that groups traffic by host and endpoint
- Burp-style request interception queue with editable forward and drop actions
- API Leaks view for secrets, tokens, keys, PGP blocks, credentials, high-entropy values, and other sensitive material found in captured traffic
- Attack Surface graph with live domain, host, port, technology, endpoint, status-code, method, scheme, and leak relationships
- MCP JSON-RPC server so agents can inspect traffic, control the proxy, manage interception, run scans, replay requests, and interact with Proxer tools
- Built-in tools: Repeater, Intruder, Scanner, Decoder, Comparer, Logger, and Extensions
- Scanner controls for memory and row limits
- Sessions and projects: temporary session or project on disk (choose a folder on startup)
- Light and dark themes with color and grayscale variants
- Windows system proxy toggle with automatic restore on stop
- Local persistence via SQLite per project

## Screens and Navigation

Main navigation is:

- Dashboard
- HTTP History
- Sitemap
- API Leaks
- Attack Surface
- Intercept
- Proxy
- Scanner
- Intruder
- Repeater
- Decoder
- Comparer
- Logger
- Extensions
- Settings

## How it works

1. The proxy listens on a local address, usually 127.0.0.1:8080.
2. For HTTP requests, the proxy can capture full request and response data.
3. For HTTPS requests, the browser first creates a CONNECT tunnel. You can capture the tunnel destination without decrypting it.
4. If you enable TLS interception and install the generated CA certificate, Proxer can decrypt HTTPS traffic and capture full request and response data.
5. WebSocket upgrade requests can be proxied and observed alongside normal HTTP traffic.
6. Captured traffic is stored in a local SQLite database and drives the Dashboard, History, Sitemap, API Leaks, Attack Surface, Scanner, and agent-facing MCP tools.

## API leaks and attack surface

The API Leaks view scans captured request and response headers and bodies with regex rules for common sensitive values. Findings are grouped by severity and include the request, host, location, evidence preview, method, URL, and status where available.

The Attack Surface view builds a live graph from captured traffic. It organizes domains, hosts, grouped asset categories, individual ports, technologies, endpoints, and leak findings into a left-to-right hierarchy. Nodes include request counts, endpoint counts, schemes, methods, status-code buckets, and grouped leak occurrence counts. The graph supports pan, zoom, minimap navigation, draggable nodes, search, filtering, collapsible branches, and a details panel.

## MCP agent access

When enabled in Settings, Proxer starts a localhost MCP JSON-RPC server. Agents can use it to call Proxer actions such as:

- `proxy.status`, `proxy.start`, and `proxy.stop`
- `settings.get` and `settings.set`
- `history.list`, `history.get`, and `history.replay`
- `intercept.enabled`, `intercept.set_enabled`, `intercept.queue`, `intercept.forward`, and `intercept.drop`
- `scanner.start`, `scanner.stop`, `scanner.status`, and `scanner.findings`
- `rules.list`, `rules.upsert`, and `rules.remove`
- `repeater.send_raw`
- `api_leaks.scan`
- `attack_surface.get`

The server binds to `127.0.0.1` on the configured MCP port.

## TLS fingerprinting and upstream proxies

Settings include custom TLS fingerprint options based on `primp`:

- Browser profiles: Chrome, Safari, Edge, Firefox, Opera, and random variants
- OS profiles: Android, iOS, Linux, macOS, Windows, and random

Proxy routing can be configured for direct connections or upstream HTTP, HTTPS, and SOCKS5 proxies.

## Install from prebuilt binaries

Prebuilt installers and archives are provided in GitHub Releases.

1. Download the latest release for your operating system.
2. Install or extract it.
3. Launch Proxer.

### Automated releases

This repository includes a GitHub Actions workflow that builds releases for Windows, macOS, and Linux.

- Push a git tag like `v0.1.0` to trigger a draft GitHub Release with the build artifacts attached.
- Publish the draft release once you have verified the artifacts.

### Browser proxy setup

To capture traffic, configure your browser to use the Proxer proxy listener.

- Host: 127.0.0.1
- Port: 8080, or the port you configured in the Proxy view

### HTTPS interception setup

To see HTTPS request and response contents:

1. Open Proxy.
2. Enable SSL Interception.
3. Export the CA certificate.
4. Install the CA certificate in your browser or operating system trust store.

If you do not install the CA, HTTPS traffic will typically appear as CONNECT tunnels only.

### Intercept queue

When interception is enabled, matching requests pause in the Intercept queue. You can inspect and edit the raw request before forwarding it, or drop it. Intercepted requests are surfaced in real time and can also be controlled through MCP.

## Build from source

Proxer uses:

- Node.js and npm for the Next.js frontend
- Rust toolchain for the Tauri backend

### Prerequisites

- Node.js 18 or newer
- Rust stable toolchain
- Tauri v2 prerequisites for your platform

Platform notes:

- Windows: Microsoft C++ Build Tools and WebView2
- macOS: Xcode Command Line Tools
- Linux: required system libraries for Tauri and WebKit based webviews, depending on your distribution

### Install dependencies

From the repository root:

- `npm --prefix frontend install`

The Tauri CLI is installed as a frontend dev dependency. You do not need the global `cargo tauri` command.

### Development build

From the repository root:

- `npm run dev`

This starts the Next.js dev server and launches the Tauri app window.

Do not use `cargo run` for normal app development. `cargo run` starts only the Rust shell and expects the frontend dev server to already be available at `http://localhost:3000`, so it can fail with `Could not connect to localhost: Connection refused`.

### Production build

From the repository root:

- `npm run build`

This builds the frontend, exports it to `frontend/out`, and builds a native app.

You can also build from the repository root using the helper scripts:

- Windows: `scripts\\build-windows.bat`
- macOS and Linux: `scripts/build-unix.sh`

#### Windows output

On Windows, the build produces:

- A portable app executable at `src-tauri/target/release/proxer.exe`
- An installer executable at `src-tauri/target/release/bundle/nsis/`

If you only want the portable executable and you do not want an installer:

- `npm run build:no-bundle`

#### macOS output

On macOS, the build produces a DMG under `src-tauri/target/release/bundle/dmg/` and an app bundle under `src-tauri/target/release/bundle/macos/`.

#### Linux output

On Linux, the build produces:

- An AppImage under `src-tauri/target/release/bundle/appimage/`
- A Debian package under `src-tauri/target/release/bundle/deb/`

#### Building for every OS

`npm run build` builds for the operating system you run it on. To produce Windows, macOS, and Linux artifacts, you must build on each OS, or use CI with a matrix that builds on Windows, macOS, and Linux.

### Docker build

The Dockerfile builds Linux release artifacts in a clean container:

- `docker build -t proxer-build .`

For an interactive build environment:

- `docker build -f Dockerfile.dev -t proxer-dev .`
- `docker run --rm -it -v "$PWD:/workspace" proxer-dev`

Docker is intended for Linux builds and checks. It is not the recommended way to launch the desktop UI interactively.

## Data and privacy

Captured traffic is stored locally. Do not use Proxer on networks or targets that you do not own or have explicit permission to test.

Secret scanning can surface sensitive data from captured traffic. Treat project folders and exported data as sensitive.

## Repository layout

- `frontend/` Next.js UI
- `src-tauri/` Tauri backend, proxy engine, and storage

## Troubleshooting

### I only see CONNECT in History

- This is expected for HTTPS without TLS interception and CA installation.
- Enable SSL Interception in the Proxy view and install the exported CA certificate.

### API Leaks or Attack Surface look empty

- Capture traffic first, then refresh or wait for the live update.
- HTTPS request and response bodies require TLS interception and a trusted Proxer CA.
- If a project has very large traffic history, increase scan limits carefully in Settings while staying within your RAM budget.

### Other apps stop working when system proxy is enabled

- If Intercept is enabled and the system proxy routes traffic through Proxer, other apps can pause waiting for you to forward or drop. Use system proxy only when you want to intercept traffic from desktop apps. Browsers can be captured by setting a browser proxy without enabling the system proxy.

### Where is my project data stored?

- Temporary sessions use a database under your OS temp directory.
- Projects on disk use the folder you picked at startup, with a `proxer.db` inside it.
