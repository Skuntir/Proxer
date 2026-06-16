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

   - `npm --prefix frontend install`

The Tauri CLI is installed through the frontend dev dependencies. You do not need to install the global Rust command with `cargo install tauri-cli`.

## Run in development mode

From the repository root:

- `npm run dev`

This starts the Next.js dev server and launches the Tauri app.

Do not use `cargo run` for normal development. It starts only the Rust side of the Tauri app and expects the frontend dev server to already be listening on `http://localhost:3000`. If the frontend is not running, `cargo run` can fail with `Could not connect to localhost: Connection refused`.

If you need to pass arguments directly to the Tauri CLI, use:

- `npm run tauri -- dev`
- `npm run tauri -- build --no-bundle`

## Frontend only development

If you want to work on UI without starting the Tauri shell:

- `cd frontend`
- `npm run dev`

This runs the UI at `http://localhost:3000`.

Some features require the Tauri backend, such as proxy capture, settings persistence, and TLS operations.

## Build checks

Frontend build:

- `npm run frontend:build`

Frontend type check:

- `npm run frontend:typecheck`

Backend build check:

- `npm run backend:check`

Combined check:

- `npm run check`

## Docker build environment

To build Linux release artifacts in Docker:

- `docker build -t proxer-build .`

To open a reusable development container shell:

- `docker build -f Dockerfile.dev -t proxer-dev .`
- `docker run --rm -it -v "$PWD:/workspace" proxer-dev`

The Docker image is for Linux builds and checks. Launching the desktop app from inside Docker requires extra host display and WebKit setup, so local `npm run dev` is the normal development path.

## Project data location

Proxer stores captured traffic in SQLite.

- Temporary sessions use a database under your OS temp directory.
- Projects on disk use the folder you picked at startup, with a `proxer.db` inside it.

Proxer also stores a small session config in the OS app data directory to remember the most recently opened project path.

If you need a clean state, you can clear traffic from the UI, or you can remove the database file used by the current session or project.

## Tips

- If you see only CONNECT tunnels for HTTPS, enable SSL Interception and install the exported CA certificate.
- If other apps pause when Intercept is enabled, narrow your scope regex, or disable the system proxy.
