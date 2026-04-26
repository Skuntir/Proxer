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

   - `cd frontend`
   - `npm install`

2. Build the Tauri app:

   - `cd ../src-tauri`
   - `cargo tauri build`

This runs the configured frontend build steps and produces native bundles for your platform.

## Platform notes

### Windows

Common outputs include an installer and an executable bundle.

If you enable signing, configure code signing certificates and integrate them into your build pipeline.

### macOS

Common outputs include an app bundle and a DMG.

For distribution outside local development, you will typically need signing and notarization.

### Linux

Common outputs include AppImage and distribution specific packages, depending on your configuration.

## GitHub Releases

Recommended steps:

1. Create a git tag for the release version.
2. Build artifacts on clean machines for Windows, macOS, and Linux, or use CI.
3. Create a GitHub Release and upload the artifacts.
4. Include release notes that summarize user facing changes, fixes, and known issues.

## Checklist

- Versions updated
- `cargo check` passes
- `npm run build` passes
- `cargo tauri build` completes on each target platform
- Installer and app launch smoke tests done
- Release artifacts uploaded to GitHub Releases

