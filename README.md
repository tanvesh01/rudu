# Rudu

Review PRs without losing your mind.

<img width="3144" height="1974" alt="Untitled design" src="https://github.com/user-attachments/assets/3a920338-bf95-4815-92bf-e0d140c55780" />


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

### Local Review Workspaces

Rudu chat uses local Rudu-managed Git workspaces instead of a remote file
index. Rudu keeps one bare repository cache under `~/rudu/workspaces/_repos`
and one moving worktree per pull request under
`~/rudu/workspaces/<owner>-<repo>/pr-<number>/repo`.

When the selected PR head changes, Rudu updates that PR workspace to the latest
head SHA and tells the same review chat session about the new active revision.
Rudu runs the assistant through `codex-acp` in read-only mode, so the chat is
for code review: it can inspect the local worktree and use read-only Git/GitHub
commands, but it does not edit files or mutate GitHub state.

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
2. Add a repository from the sidebar.
3. Choose a pull request to track for that repository.
4. Select the tracked pull request to load its changed files, patch, and review threads.
5. Use the file tree to navigate the diff and create, reply to, or edit review comments.

## License

MIT. See [LICENSE](LICENSE).
