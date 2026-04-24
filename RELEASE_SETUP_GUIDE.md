# Rudu Release Setup Guide

## What Is Already Done

- App metadata has been renamed to `rudu`.
- The Tauri updater plugin is wired into the app.
- A manual "Check for updates" UI is available in the app header.
- Tauri capabilities now allow the updater and process plugins from the frontend.
- Tauri updater artifact generation is enabled in `src-tauri/tauri.conf.json`.
- The updater endpoint is set to GitHub Releases:
  - `https://github.com/tanvesh01/rudu/releases/latest/download/latest.json`
- The release workflow publishes draft GitHub Releases from `v*` tags.
- GitHub tag protection is configured on `tanvesh01/rudu` with a tag ruleset for `refs/tags/v*`.

Important:

- The updater will not work end-to-end until the GitHub release workflow is run with the required secrets and starts publishing `latest.json` plus signed updater artifacts.

## Release Control

Releases are triggered by pushing a `v*` tag, and the repo now has a GitHub tag ruleset in place to protect those release tags.

### Current GitHub ruleset

The repository ruleset is configured as:

- target: `tag`
- enforcement: `active`
- include pattern: `refs/tags/v*`
- rules:
  - `creation`
  - `update`
  - `deletion`
- bypass:
  - only the repository admin role in this personal repository

Ruleset URL:

- `https://github.com/tanvesh01/rudu/rules/15519973`

If your repository UI does not offer rulesets, use legacy protected tags for `v*` instead.

## Keys and Secrets You Need

There are three separate signing systems involved:

1. Tauri updater signing
2. Apple code signing and notarization
3. GPG signing for Linux release checksums

These are independent of each other.

## 1. Tauri Updater Signing Key

This signs updater artifacts so the app can trust downloaded updates.

### Current project keypair

The current Tauri updater keypair for this project is the rotated password-protected key.

Paths on this machine:

- Private key: `~/.tauri/rudunew.key`
- Public key: `~/.tauri/rudunew.key.pub`

The public key is already embedded in `src-tauri/tauri.conf.json`.

### What to do with it

- Keep `~/.tauri/rudunew.key` secret.
- Back it up somewhere safe.
- Put the private key contents into a GitHub Actions secret later.

### GitHub secrets to create

- `TAURI_SIGNING_PRIVATE_KEY`
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`

### Add them with `gh`

```bash
gh secret set TAURI_SIGNING_PRIVATE_KEY < ~/.tauri/rudunew.key
gh secret set TAURI_SIGNING_PRIVATE_KEY_PASSWORD <<< "your-updater-key-password"
```

For the key currently generated in this repo:

- `TAURI_SIGNING_PRIVATE_KEY`: contents of `~/.tauri/rudunew.key`
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`: the real password you set when generating that key

If you want to regenerate it yourself later:

```bash
bun x tauri signer generate -w ~/.tauri/rudunew.key
```

If you rotate it, you must also update the public key in `src-tauri/tauri.conf.json` before releasing.

## 2. Apple Signing and Notarization

You said you already have the necessary Apple ecosystem keys, so this is the checklist for wiring them into CI.

### You need

- A `Developer ID Application` certificate
- A `.p12` export of that certificate
- The `.p12` export password
- The signing identity string
- Notarization credentials

### A. Export the certificate to `.p12`

On your Mac:

1. Open `Keychain Access`.
2. Go to the `login` keychain.
3. Open `My Certificates`.
4. Find your `Developer ID Application` certificate.
5. Expand it so the private key is visible.
6. Right-click the certificate entry and export it as `.p12`.
7. Choose a strong export password.

### B. Convert the `.p12` file to base64 for GitHub Actions

```bash
openssl base64 -A -in /path/to/certificate.p12 -out certificate-base64.txt
```

Create these GitHub secrets:

- `APPLE_CERTIFICATE`: contents of `certificate-base64.txt`
- `APPLE_CERTIFICATE_PASSWORD`: the `.p12` export password

Add them with `gh`:

```bash
gh secret set APPLE_CERTIFICATE < certificate-base64.txt
gh secret set APPLE_CERTIFICATE_PASSWORD <<< "your-p12-password"
```

### C. Get the signing identity string

Run:

```bash
security find-identity -v -p codesigning
```

Use the matching `Developer ID Application: ...` value for:

- `APPLE_SIGNING_IDENTITY`

Add it with `gh`:

```bash
gh secret set APPLE_SIGNING_IDENTITY <<< "Developer ID Application: Your Name (TEAMID)"
```

### D. Get notarization credentials

Create these secrets:

- `APPLE_ID`
- `APPLE_PASSWORD`
- `APPLE_TEAM_ID`

How to get them:

- `APPLE_ID`: your Apple ID email
- `APPLE_PASSWORD`: generate an app-specific password at `appleid.apple.com`
- `APPLE_TEAM_ID`: from the Apple Developer portal membership details

Add them with `gh`:

```bash
gh secret set APPLE_ID <<< "you@example.com"
gh secret set APPLE_PASSWORD <<< "your-app-specific-password"
gh secret set APPLE_TEAM_ID <<< "TEAMID"
```

## 3. Linux GPG Key for Signed Checksums

This is not for Tauri updater signing. This is for publishing signed `SHA256SUMS` files alongside `.deb` and `AppImage` assets.

### Why use it

- Ubuntu users downloading from GitHub Releases can verify release integrity.
- This is a good fit for GitHub Releases without maintaining an APT repository.

### Generate a dedicated release-signing key

```bash
gpg --full-generate-key
```

Recommended choices:

- Key type: RSA and RSA
- Key size: 4096
- Expiry: 1y or 2y
- Use a dedicated identity for release signing

### Inspect your key ID

```bash
gpg --list-secret-keys --keyid-format LONG
```

### Export the private key for GitHub Actions

```bash
gpg --armor --export-secret-keys YOUR_KEY_ID > rudu-release-private.asc
```

### Export the public key for users

```bash
gpg --armor --export YOUR_KEY_ID > rudu-release-public.asc
```

### GitHub secrets to create

- `GPG_PRIVATE_KEY`
- `GPG_PASSPHRASE`
- `GPG_KEY_ID`

Add them with `gh`:

```bash
gh secret set GPG_PRIVATE_KEY < rudu-release-private.asc
gh secret set GPG_PASSPHRASE <<< "your-gpg-passphrase"
gh secret set GPG_KEY_ID <<< "YOUR_KEY_ID"
```

Suggested usage later in CI:

- import `GPG_PRIVATE_KEY`
- generate `SHA256SUMS`
- sign it as `SHA256SUMS.asc`
- upload both to the GitHub Release

## GitHub Secrets Checklist

You can inspect what is already set with:

```bash
gh secret list
```

### Required for updater

- `TAURI_SIGNING_PRIVATE_KEY`
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`

### Required for macOS signing

- `APPLE_CERTIFICATE`
- `APPLE_CERTIFICATE_PASSWORD`
- `APPLE_SIGNING_IDENTITY`

### Required for notarization

- `APPLE_ID`
- `APPLE_PASSWORD`
- `APPLE_TEAM_ID`

### Optional for Linux verification

- `GPG_PRIVATE_KEY`
- `GPG_PASSPHRASE`
- `GPG_KEY_ID`

## What Still Needs To Be Finished

- GitHub Actions secrets must be added in the repository settings
- The release workflow must be run from a `vX.Y.Z` tag
- macOS signing and notarization credentials must be verified in CI
- Linux GPG secrets should be added if you want signed checksum files on each release
- Release publishing must produce and upload:
  - app bundles
  - updater signatures
  - `latest.json`
  - `SHA256SUMS`
  - `SHA256SUMS.asc` when GPG secrets are configured

## Suggested Next Step

Add the required GitHub secrets, then cut a test tag such as `v0.1.0` to validate the full updater and release pipeline.
