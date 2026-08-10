# Rudu

Review PRs without losing your mind.

<img width="3144" height="1974" alt="Untitled design" src="https://github.com/user-attachments/assets/3a920338-bf95-4815-92bf-e0d140c55780" />

[Download the latest release](https://github.com/tanvesh01/rudu/releases)

### Agent-guided review

Rudu includes an agent skill for navigating diffs and leaving inline comments through the CLI:

```sh
rudu skill path
```

Give the printed skill file to your coding agent. It will use `rudu session review`, `navigate`, and `comment` commands to guide the review in the live app.

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

Open a checkout from the app or terminal:

```sh
rudu .                         # combined uncommitted changes
rudu diff                      # unstaged changes + untracked files
rudu diff --staged             # staged changes
rudu diff HEAD                 # everything changed since HEAD
rudu show                      # latest commit
rudu show HEAD~1               # an earlier commit
rudu diff main...HEAD          # merge-base branch/PR diff
rudu diff HEAD~3..HEAD -- src  # range limited by pathspec
rudu patch change.patch        # unified patch file
command-producing-patch | rudu patch -
```

`diff` targets use native Git revision syntax. Two existing file paths compare those files directly.

## License

MIT. See [LICENSE](LICENSE).
