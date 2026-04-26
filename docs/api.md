# API

This document describes the internal API between the frontend and the backend.

The frontend calls backend commands via Tauri invoke. The wrapper functions live in `frontend/lib/proxer.ts`.

## Commands

Commands are registered in the Tauri backend and are invoked by name.

High level groups:

- App: app info, and event polling
- Proxy: start, stop, and status
- TLS: CA management and MITM toggle
- Settings: get and set
- Traffic: history list and get, sitemap get, and clear traffic
- Tools: repeater, intruder, scanner, rules, logs, and extensions

### Event polling

The frontend uses a polling loop that calls `events_poll` with:

- a cursor
- a timeout in milliseconds

The backend returns:

- an updated cursor
- an array of events

This is used to update History, Dashboard, Sitemap, Scanner, and Logger in near real time.

## Events

Events are serialized with a `type` field and a `payload` object.

Common event types:

- ProxyStatusChanged
- RequestCaptured
- ResponseReceived
- InterceptPaused
- RuleTriggered
- TlsHandshake
- LogEmitted
- ScanStarted, ScanProgress, ScanFinding, and ScanCompleted
- IntruderStarted, IntruderProgress, IntruderResult, and IntruderCompleted
- ExtensionInstalled, and ExtensionEnabledChanged

## Data models

The UI uses a simplified HTTP request model that includes:

- id, method, url, host, and path
- statusCode, time, size, and contentType
- requestHeaders and headers
- body and responseBody

The backend stores raw bytes for request and response bodies and returns a UI friendly representation.

