# Troubleshooting

This document lists common issues and fixes.

## I do not see any traffic

1. Make sure the proxy is running in the Proxy screen.
2. Confirm the bind address and port, for example `127.0.0.1:8080`.
3. Configure your browser proxy settings to use that host and port.
4. If you use a proxy extension, confirm it is enabled for the current profile and it is pointing at the same port.

## I only see CONNECT entries for HTTPS

This is expected when TLS interception is not enabled, or the CA is not trusted.

To capture HTTPS request and response contents:

1. Open Proxy.
2. Enable SSL Interception.
3. Export the CA certificate.
4. Install the CA certificate in the browser trust store, or the OS trust store.

If the browser shows certificate errors, the CA is not trusted.

## Other apps stop working when the system proxy is enabled

If the system proxy is enabled and Intercept is enabled, Proxer can pause requests and other apps may wait for you to forward or drop.

Fixes:

- Disable Intercept when you do not need it.
- Narrow the scope regex so only your target hosts are intercepted.
- Disable the system proxy and use per app proxy configuration instead.

## Port already in use

If Proxer cannot start the proxy listener on your preferred port:

- Stop any other local proxies using that port.
- Pick a different port in the Proxy screen.

## HTTPS interception breaks some sites

Some sites use certificate pinning or strict TLS behavior.

Options:

- Disable SSL Interception for general browsing.
- Use SSL Interception only when testing sites that you control or have permission to test.

## Clear captured traffic does not remove my browser history

The Clear action only removes captured traffic stored by Proxer. It does not change your browser history.

