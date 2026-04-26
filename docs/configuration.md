# Configuration

This document describes the major user facing settings and how they affect the proxy behavior.

Settings are persisted by the backend and are retrieved and updated through Tauri commands.

## Proxy settings

### Listener

The proxy listener binds to a local address, usually `127.0.0.1:8080`. You can change the port from the Proxy screen.

### Use System Proxy

On Windows, Proxer can configure the system proxy to route system traffic through the proxy listener.

If you enable this setting, be careful when Intercept is enabled, because apps can pause waiting for an intercept decision.

### SSL Interception

When enabled, Proxer attempts to decrypt HTTPS traffic by generating host certificates from the local CA.

You must trust the CA in your browser or OS for this to work reliably.

### Verify Certificates

Controls whether upstream server certificates are validated when Proxer connects upstream.

Disabling verification can be useful for testing on internal targets, but it reduces security and should be avoided for normal browsing.

## Intercept settings

### Intercept enabled

When enabled, the proxy can pause requests for manual forward or drop decisions.

### Scope regex

Scope regex is a newline separated list of regular expressions.

- If the list is empty, interception is not applied.
- If any line matches the request host, interception can pause the request.

This helps prevent intercepting unrelated system traffic when the system proxy is enabled.

## History settings

### Show CONNECT tunnels

Controls whether CONNECT tunnels appear in HTTP History.

- When disabled, CONNECT entries are hidden.
- When enabled, CONNECT entries are shown.

This setting does not change capture behavior. It only changes what the UI shows.

## UI settings

### Theme

Theme controls:

- light or dark mode
- color or grayscale tone
- system variants that follow the OS theme

### Compact mode

Reduces spacing in the UI.

