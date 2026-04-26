# Architecture

This document describes the high level architecture of Proxer, the main modules, and the data flow between the proxy engine, storage, and the UI.

## Overview

Proxer is a Tauri v2 desktop application:

- Backend: Rust, Tokio, Hyper, and Reqwest
- Frontend: Next.js, React, TypeScript, and CSS variables for theming
- Storage: SQLite via sqlx, stored in the OS app data directory

The proxy engine captures HTTP and HTTPS traffic, stores it in SQLite, and emits events so the UI can update in real time.

## Repository layout

- `frontend/` contains the Next.js UI
- `src-tauri/` contains the Rust backend and the Tauri configuration

Key backend modules in `src-tauri/src/`:

- `main.rs` app bootstrap, Tauri command registration, and TLS crypto provider install
- `app_state.rs` dependency wiring and auto start of the proxy listener
- `proxy/mod.rs` HTTP proxy server, CONNECT handling, and upstream forwarding
- `tls/mod.rs` CA generation, certificate management, and per host TLS config for MITM
- `storage/mod.rs` SQLite schema and persistence APIs
- `events.rs` event bus and polling buffer
- `intercept.rs` request interception and pause, forward, and drop decisions
- `rules/mod.rs` rule set and rule actions applied to requests and responses
- `dashboard.rs` dashboard aggregation queries and computed stats
- `sitemap.rs` sitemap aggregation and tree building
- `scanner.rs` vulnerability scanning, findings persistence, and progress events
- `intruder.rs` intrusion attacks and results persistence
- `logs.rs` log persistence and log events
- `system_proxy.rs` Windows system proxy enable and disable, with backup and restore
- `commands.rs` Tauri commands exposed to the frontend
- `ui.rs` formatting and shaping of stored traffic into UI friendly structures

## Data flow

### Proxy listener lifecycle

The proxy listener is started by `AppState::new` and it tries ports 8080 to 8090. The listener runs on a dedicated thread with a single thread Tokio runtime and a LocalSet.

The proxy can also be started and stopped via Tauri commands.

### Request capture pipeline

For each incoming connection:

1. Hyper parses requests over HTTP/1.1.
2. Requests are routed by method:
   - CONNECT is handled by `handle_connect`
   - everything else is handled by `handle_forward`
3. A `ProxyRequest` is created, including method, url, host, headers, and body.
4. A `BackendEvent::RequestCaptured` event is emitted so the UI can append a row immediately.
5. If Intercept is enabled and the host is in scope, the request can be paused:
   - forward, optionally with an edited raw request
   - drop with an error response
6. Rules are applied to the request and can delay or block it.
7. The request is forwarded upstream with Reqwest.
8. Rules are applied to the response.
9. A `BackendEvent::ResponseReceived` event is emitted with status, size, and timing.
10. The request, response, and error fields are stored in SQLite.

### HTTPS and CONNECT behavior

For HTTPS traffic, browsers first create a CONNECT tunnel to `host:port`.

- Without MITM: the tunnel is established and proxied byte for byte, and Proxer can record the tunnel destination as a CONNECT entry.
- With MITM enabled: Proxer dynamically generates a server certificate for the host using the local CA, performs a TLS handshake with the client, and then runs an inner HTTP server on top of the TLS stream. This allows capturing full HTTPS request and response contents.

MITM requires the CA to be trusted by the browser or OS. Without trust, the browser will show certificate errors, and traffic will not be decrypted.

### Storage

Traffic is stored in a `traffic` table with:

- request metadata: id, started timestamp, scheme, host, method, url, headers, and body
- response metadata: status, headers, body, and elapsed time
- an error field for failures

Dashboard and Sitemap are derived from this traffic dataset.

### Events and UI updates

The backend uses an in process event bus that:

- publishes events via a broadcast channel for internal consumers
- stores recent events in a bounded ring buffer with a monotonic cursor
- supports long polling with a timeout to reduce UI polling frequency

The frontend consumes events through a `events_poll` command in a loop. This avoids reliance on direct window event listeners when permissions or webview policies make that unreliable.

## UI architecture

The Next.js UI maintains:

- a local list for History, updated by initial query and then patched by live events
- a Sitemap tree loaded on view mount and refreshed on capture events
- an overlay system for dialogs and toast notifications

The UI talks to the backend via `@tauri-apps/api` invocations in `frontend/lib/proxer.ts`.

## Safety and scope gating

Interception is gated by a scope regex setting. This is intended to prevent pausing unrelated system traffic when interception is enabled, especially when the system proxy is enabled.

