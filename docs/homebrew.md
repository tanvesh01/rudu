# Homebrew distribution

This document covers the Homebrew templates mirrored to the published
[`homebrew-rudu`](https://github.com/tanvesh01/homebrew-rudu) tap.

## Tap layout

The published tap uses the standard Homebrew directory layout:

```text
homebrew-rudu/
  Casks/
    rudu.rb      # macOS DMG installer
  Formula/
    rudu.rb      # Linux x86_64/amd64 AppImage installer shim
```

The templates in this repo live at:

- `packaging/homebrew/Casks/rudu.rb`
- `packaging/homebrew/Formula/rudu.rb`

## Install commands

Users can install Rudu with:

```sh
brew tap tanvesh01/rudu
```

macOS:

```sh
brew install --cask rudu
```

Linux x86_64/amd64:

```sh
brew install rudu
```

Rudu shells out to Git and optionally the GitHub CLI. Install and authenticate
`gh` before using GitHub pull request features:

```sh
brew install gh
gh auth login
```

## Testing the tap locally

From a checkout of the tap repository:

```sh
brew audit --cask --new Casks/rudu.rb
brew audit --formula --new Formula/rudu.rb
brew install --cask ./Casks/rudu.rb
brew install --formula ./Formula/rudu.rb
brew test rudu
```

Notes:

- Run cask install tests on macOS.
- Run formula install tests on Linux x86_64/amd64. The formula wraps the upstream
  AppImage in a `bin/rudu` shim and uses `rudu --appimage-help` for a lightweight
  Homebrew test that does not require launching the GUI.
- Some Linux distributions need FUSE installed for AppImages to run. Homebrew
  cannot universally provision system FUSE packages, so the formula includes a
  caveat for users.

## Updating for a new Rudu release

1. Build and publish the GitHub release using the existing release workflow.
2. Download or inspect the uploaded release assets.
3. Update the macOS cask's `version` value.
4. Update the macOS cask URLs if the asset naming changes:
   - `rudu_<version>_aarch64.dmg`
   - `rudu_<version>_x64.dmg`
5. Update the Linux formula URL if the asset naming changes:
   - `rudu_<version>_amd64.AppImage`
6. Replace each `sha256` with the release asset checksum:

   ```sh
   shasum -a 256 rudu_<version>_aarch64.dmg
   shasum -a 256 rudu_<version>_x64.dmg
   shasum -a 256 rudu_<version>_amd64.AppImage
   ```

7. Run the local tap tests above on the relevant platforms.
8. Commit the template updates to the tap repository.

## Current template checksums

The templates target Rudu `v0.5.1`:

- macOS Apple Silicon: `rudu_0.5.1_aarch64.dmg`
  - SHA-256: `1d1291c03ce2d9218768906f7e8f52e42e0818bc8f5532b3e00a1d6301c850aa`
- macOS Intel: `rudu_0.5.1_x64.dmg`
  - SHA-256: `8a269079ff0af7030f4a4a60acfcc29b2f5854d967965116828fdc795b7b6249`
- Linux amd64: `rudu_0.5.1_amd64.AppImage`
  - SHA-256: `c7edee954782a347bc375a81be545888f9c2fc2cc8bc2e3d02c96c6b77364b23`
