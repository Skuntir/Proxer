# Release

This document describes a suggested release process for Proxer.

## Versioning

Proxer version is defined in:

- `src-tauri/Cargo.toml`
- `src-tauri/tauri.conf.json`
- `frontend/package.json` for the UI package metadata

Update versions consistently before building release artifacts.

## Build release artifacts

From the repository root:

1. Install frontend dependencies:

   - `npm --prefix frontend ci`

2. Build the Tauri app:

   - `npm run build`

This runs the configured frontend build steps and produces native bundles for your platform.

## Platform notes

### Windows

Common outputs include an installer and an executable bundle.

If you enable signing, configure code signing certificates and integrate them into your build pipeline.

### macOS

Common outputs include an app bundle and a DMG.

For distribution outside local development, you will typically need signing and notarization.

### Linux

Common outputs include AppImage and Debian packages.

## Cross platform releases

Tauri does not produce Windows, macOS, and Linux installers from a single build machine by default. To publish releases for all platforms, build on each OS, or use CI with a build matrix.

## GitHub Releases

Recommended steps:

1. Create and push a git tag for the release version, for example `v0.1.0`.
2. Let GitHub Actions build the artifacts and create a draft GitHub Release.
3. Smoke test the artifacts from the draft release.
4. Publish the release and add release notes that summarize user facing changes, fixes, and known issues.

## Checklist

- Versions updated
- `cargo check` passes
- `npm run build` passes
- `npm run build` completes on each target platform
- Installer and app launch smoke tests done
- Release artifacts uploaded to GitHub Releases
