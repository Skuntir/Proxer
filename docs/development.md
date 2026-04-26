# Development

This document explains how to set up a local development environment for Proxer and how to run the app during development.

## Prerequisites

You need:

- Node.js 18 or newer
- Rust stable toolchain
- Tauri v2 prerequisites for your platform

Platform specific notes:

- Windows: Microsoft C++ build tools and WebView2
- macOS: Xcode Command Line Tools
- Linux: required system packages for Tauri webview dependencies, depending on your distribution

## Install dependencies

From the repository root:

1. Install frontend dependencies:

   - `cd frontend`
   - `npm install`

2. Return to the repository root:

   - `cd ..`

## Run in development mode

From `src-tauri`:

- Windows: `cd src-tauri` then `cargo tauri dev`
- macOS and Linux: `cd src-tauri` then `cargo tauri dev`

This starts the Next.js dev server and launches the Tauri app.

## Frontend only development

If you want to work on UI without starting the Tauri shell:

- `cd frontend`
- `npm run dev`

This runs the UI at `http://localhost:3000`.

Some features require the Tauri backend, such as proxy capture, settings persistence, and TLS operations.

## Build checks

Frontend build:

- `cd frontend`
- `npm run build`

Backend build check:

- `cd src-tauri`
- `cargo check`

## Project data location

Proxer stores its SQLite database under the OS app data directory in a `proxer/` folder.

If you need a clean state, you can clear traffic from the UI, or you can remove the database file from the app data directory.

## Tips

- If you see only CONNECT tunnels for HTTPS, enable SSL Interception and install the exported CA certificate.
- If other apps pause when Intercept is enabled, narrow your scope regex, or disable the system proxy.

