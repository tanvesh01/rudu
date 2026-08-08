# Rudu

Review PRs without losing your mind.

<img width="3144" height="1974" alt="Untitled design" src="https://github.com/user-attachments/assets/3a920338-bf95-4815-92bf-e0d140c55780" />


[Download the latest release](https://github.com/tanvesh01/rudu/releases)

## Installation

### Install a release

1. Download the latest build from [GitHub Releases](https://github.com/tanvesh01/rudu/releases).
2. Install Git.
3. To review GitHub pull requests, install and authenticate the GitHub CLI:
   - Install `gh`: https://cli.github.com/
   - Authenticate: `gh auth login`
4. Launch Rudu.

Local checkout review uses Git directly and does not require GitHub authentication. Rudu shells out to your local `gh` binary for GitHub repositories and pull requests, so those features can only access what your current GitHub CLI session can access.

### Run from source

#### Prerequisites

- [Bun](https://bun.sh/docs/installation)
- [Rust](https://www.rust-lang.org/tools/install)
- [Tauri prerequisites for your platform](https://tauri.app/start/prerequisites/)
- [Git](https://git-scm.com/)
- Optional: [GitHub CLI](https://cli.github.com/) with an authenticated session from `gh auth login` for pull request review

#### Setup

```sh
bun install
bun run tauri dev
```

This repository uses Bun for JavaScript tasks. Do not use `npm`.

Create the local app config first:

```sh
cp .env.example .env
```

Then launch Rudu with:

```sh
bun run tauri:dev
```

## Sponsor

Hey! Thanks for checking Rudu out. I work on this for free and do my best to maintain it alongside my day job. If Rudu has been useful to you, please consider sponsoring it.

[![Sponsor](https://img.shields.io/badge/Sponsor-GitHub-ea4aaa?logo=githubsponsors&logoColor=white)](https://github.com/sponsors/tanvesh01)

## Usage

1. Open the app.
2. Select **Add local checkout** to review uncommitted changes in an existing Git working tree, or track a GitHub pull request.
3. Select a local checkout or pull request from its repository group.
4. Use the changed-files tree to navigate the diff. Local checkouts are read-only in Rudu; pull requests also support review comments.

## License

MIT. See [LICENSE](LICENSE).
