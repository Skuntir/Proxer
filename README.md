<h1 align="center">Proxer</h1>

<img width="1920" height="1080" alt="636_1x_shots_so" src="https://github.com/user-attachments/assets/6cdfca9c-a2fc-4cb3-88c8-fb97e0b07acf" />
 

## Description

Proxer is a desktop HTTP and HTTPS interception proxy built with Tauri v2 and a Next.js UI. It captures traffic into a local SQLite database, shows it in a real-time History view, and builds a Sitemap from observed endpoints.

## Features

- HTTP and HTTPS proxy with CONNECT support
- Optional TLS interception for HTTPS visibility
- HTTP History with request and response details
- Sitemap view that groups traffic by host and endpoint
- Request interception with scope gating
- Built-in tools: Repeater, Intruder, Scanner, Decoder, Comparer, Logger, and Extensions
- Sessions and projects: temporary session or project on disk (choose a folder on startup)
- Light and dark themes with color and grayscale variants
- Windows system proxy toggle with automatic restore on stop
- Local persistence via SQLite per project

## Screens and Navigation

Main navigation is:

- Dashboard
- HTTP History
- Sitemap
- Intercept
- Proxy

## How it works

1. The proxy listens on a local address, usually 127.0.0.1:8080.
2. For HTTP requests, the proxy can capture full request and response data.
3. For HTTPS requests, the browser first creates a CONNECT tunnel. You can capture the tunnel destination without decrypting it.
4. If you enable TLS interception and install the generated CA certificate, Proxer can decrypt HTTPS traffic and capture full request and response data.
5. Captured traffic is stored in a local SQLite database and drives the Dashboard, History, and Sitemap views.

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

## Repository layout

- `frontend/` Next.js UI
- `src-tauri/` Tauri backend, proxy engine, and storage

## Troubleshooting

### I only see CONNECT in History

- This is expected for HTTPS without TLS interception and CA installation.
- Enable SSL Interception in the Proxy view and install the exported CA certificate.

### Other apps stop working when system proxy is enabled

- If Intercept is enabled and the system proxy routes traffic through Proxer, other apps can pause waiting for you to forward or drop. Use system proxy only when you want to intercept traffic from desktop apps. Browsers can be captured by setting a browser proxy without enabling the system proxy.

### Where is my project data stored?

- Temporary sessions use a database under your OS temp directory.
- Projects on disk use the folder you picked at startup, with a `proxer.db` inside it.
