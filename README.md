# Rudu

<img width="1512" height="972" alt="rudu (Window) 2026-04-25 01:49 AM" src="https://github.com/user-attachments/assets/e4efdf48-8257-4002-941e-606c6849175f" />

Review PRs without losing your mind.

[Download the latest release](https://github.com/tanvesh01/rudu/releases)

## Installation

### Install a release

1. Download the latest build from [GitHub Releases](https://github.com/tanvesh01/rudu/releases).
2. Install and authenticate the GitHub CLI:
   - Install `gh`: https://cli.github.com/
   - Authenticate: `gh auth login`
3. Launch Rudu.

Rudu shells out to your local `gh` binary, so the app will only be able to access repositories and pull requests that your current GitHub CLI session can access.

### Run from source

#### Prerequisites

- [Bun](https://bun.sh/docs/installation)
- [Rust](https://www.rust-lang.org/tools/install)
- [Tauri prerequisites for your platform](https://tauri.app/start/prerequisites/)
- [GitHub CLI](https://cli.github.com/) with an authenticated session from `gh auth login`

#### Setup

```sh
bun install
bun run tauri dev
```

This repository uses Bun for JavaScript tasks. Do not use `npm`.

## Sponsor

Hey! Thanks for checking Rudu out. I work on this for free and do my best to maintain it alongside my day job. If Rudu has been useful to you, please consider sponsoring it.

[![Sponsor](https://img.shields.io/badge/Sponsor-GitHub-ea4aaa?logo=githubsponsors&logoColor=white)](https://github.com/sponsors/tanvesh01)

## Usage

1. Open the app.
2. Add a repository from the sidebar.
3. Choose a pull request to track for that repository.
4. Select the tracked pull request to load its changed files, patch, and review threads.
5. Use the file tree to navigate the diff and create, reply to, or edit review comments.

## License

MIT. See [LICENSE](LICENSE).
