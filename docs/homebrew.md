# Homebrew distribution

This document covers Homebrew tap templates for publishing Rudu through a
`homebrew-rudu` tap without changing the release pipeline or pushing to another
repository from this repo.

## Tap layout

Create a tap repository named `homebrew-rudu` under the publishing GitHub owner
and copy the templates into the matching Homebrew directories:

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

After the tap is published, users can install Rudu with:

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
3. Update both templates' `version` values.
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

The initial templates target Rudu `v0.5.0`:

- macOS Apple Silicon: `rudu_0.5.0_aarch64.dmg`
  - SHA-256: `12e1fd0c3d729db03459790981ef9a1519c292166d2a80d9cc48488aad0a3e3c`
- macOS Intel: `rudu_0.5.0_x64.dmg`
  - SHA-256: `a2481659dee6f9fa3adbc5d7d862f9b4ca3a560c3530e378c1a3a44e8b255261`
- Linux amd64: `rudu_0.5.0_amd64.AppImage`
  - SHA-256: `b6619c43b9a06c3932290411f12ca0d4be965cbfbb6f79e787e443f4bc9224a1`
