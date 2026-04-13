# Rudu Release Plan

## Goals

- Rename the app metadata from `tauri-diffs` to `rudu`.
- Add Tauri updater support with a manual "Check for updates" flow.
- Publish stable releases through GitHub Releases.
- Sign and notarize macOS builds.
- Ship Ubuntu-friendly Linux artifacts with a simple verification story.

## Decisions Locked In

- GitHub repo: `tanvesh01/rudu`
- Release channel: stable only
- Update UX: manual "Check for updates"
- Linux audience: Ubuntu LTS users
- Distribution channel: GitHub Releases only

## Release Strategy

### macOS

- Build signed macOS bundles.
- Notarize all public releases.
- Upload release assets to GitHub Releases.
- Support in-app updates through Tauri updater artifacts.

### Linux

- Publish `.deb` and `AppImage` artifacts.
- Publish `SHA256SUMS` for release assets.
- Sign `SHA256SUMS` with GPG.
- Skip APT repository work for now.
- Skip `.deb` or `.rpm` package-signing complexity for now.

## Phase 1: Normalize App Identity

Update naming so release artifacts, updater metadata, and user-visible app names all match `rudu`.

Files to update:

- `package.json`
- `src-tauri/tauri.conf.json`
- `src-tauri/Cargo.toml`
- Any user-facing window titles or display names that still say `tauri-diffs`

Notes:

- Keep the bundle identifier stable unless there is a strong reason to change it.
- Version values must stay aligned across `package.json`, `tauri.conf.json`, and `Cargo.toml`.

## Phase 2: Add Tauri Updater

### Rust integration

- Add `tauri-plugin-updater` to `src-tauri/Cargo.toml`.
- Initialize the updater plugin in `src-tauri/src/lib.rs`.

### Frontend integration

- Add a manual "Check for updates" entry point.
- Recommended first location: Settings UI.
- Flow:
  - Check for an update.
  - If none exists, show a clear "up to date" message.
  - If an update exists, show current and target versions.
  - Ask for confirmation before install.
  - Download, install, and relaunch.

### Tauri config

Update `src-tauri/tauri.conf.json` to:

- Enable updater artifact generation.
- Add updater public key.
- Add GitHub Releases endpoint configuration.

### Updater keys

- Generate a Tauri updater keypair.
- Commit the public key in app config.
- Store the private key in GitHub Actions secrets.

Important:

- Tauri updater signing is separate from Apple signing.
- Tauri updater signing is also separate from GPG signing of Linux checksum files.

## Phase 3: GitHub Releases Contract

Use a simple stable release convention:

- Tag format: `vX.Y.Z`
- Release name: `rudu vX.Y.Z`

Release assets should include:

- macOS bundles
- Linux bundles
- Updater signatures
- Generated updater JSON
- `SHA256SUMS`
- `SHA256SUMS.asc`

## Phase 4: macOS Signing and Notarization

Add the files and config needed for smooth macOS distribution.

Implementation items:

- Add `src-tauri/Entitlements.plist`.
- Configure signing identity through Tauri config or CI environment.
- Configure notarization in GitHub Actions.

Expected CI secrets:

- `APPLE_CERTIFICATE`
- `APPLE_CERTIFICATE_PASSWORD`
- `APPLE_SIGNING_IDENTITY`
- Notarization credentials via either:
  - Apple ID + app-specific password, or
  - App Store Connect API key flow

Preferred direction:

- Use API key based notarization if available.

## Phase 5: Linux Verification Story

For Ubuntu LTS users downloading from GitHub Releases, use a simple trust model.

Implementation items:

- Build `.deb` and `AppImage` artifacts.
- Generate `SHA256SUMS` from release assets.
- Sign the checksum file with GPG.
- Publish both files in the GitHub Release.

Rationale:

- This gives users a straightforward way to verify authenticity and integrity.
- It avoids spending time on packaging work that matters more for APT or DNF repositories than direct downloads.

Optional later:

- Add embedded AppImage signing in CI.

## Phase 6: GitHub Actions Release Workflow

Add a release workflow using `tauri-apps/tauri-action`.

Targets:

- `macos-latest` for:
  - `aarch64-apple-darwin`
  - `x86_64-apple-darwin`
- `ubuntu-22.04` for Linux bundles

Workflow responsibilities:

- Install Bun dependencies.
- Install Rust toolchain.
- Install Linux system packages required for Tauri bundling.
- Build the app.
- Generate updater artifacts.
- Sign updater artifacts.
- Sign and notarize macOS artifacts.
- Upload assets to GitHub Releases.
- Generate and sign `SHA256SUMS`.

## Phase 7: Verification

### Updater verification

- Release `v0.1.0`.
- Install the app.
- Release `v0.1.1`.
- Verify that the app detects the new version.
- Verify download, install, and relaunch.

### macOS verification

- Download on a clean machine.
- Confirm the app opens without Gatekeeper failure.
- Confirm notarization is accepted.
- Confirm in-app update works.

### Ubuntu verification

- Install the `.deb` on a supported Ubuntu LTS system.
- Run the `AppImage` on a supported Ubuntu LTS system.
- Verify `SHA256SUMS` and GPG signature verification steps.

## Secrets Inventory

### Tauri updater

- `TAURI_SIGNING_PRIVATE_KEY`
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` if used

### Apple signing and notarization

- Apple signing certificate secrets
- Apple notarization secrets

### Linux checksum signing

- GPG private key
- GPG passphrase if used

## Execution Order

1. Rename app metadata to `rudu`.
2. Add updater plugin and updater config.
3. Add manual updater UI.
4. Generate updater keys and wire secrets.
5. Add macOS entitlements and signing config.
6. Add GitHub Actions release workflow.
7. Add checksum generation and GPG signing.
8. Cut a test release and validate updater flow.

## Nice-to-Haves Later

- Background update checks
- Pre-release channel support
- Embedded AppImage signing
- APT repository distribution for Ubuntu users
