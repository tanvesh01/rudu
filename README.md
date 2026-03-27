# Rudu

Rudu is a Bun-powered terminal UI for managing background Pi coding agent sessions across git worktrees.

## Install

Rudu expects:

- `git` on your `PATH`
- `pi` on your `PATH`
- at least one Pi model already configured

Once those are ready, install with the GitHub-hosted installer:

```bash
curl -fsSL https://raw.githubusercontent.com/tanvesh01/rudu/main/install.sh | sh
```

The installer:

- checks for `git`
- checks for `pi`
- verifies `pi --list-models` returns at least one model
- installs Bun if it is missing
- installs Rudu globally from this GitHub repo with Bun

## TODO

- Move Pi readiness checks fully to app startup instead of blocking install. Installation should stay lightweight, while `rudu` itself should explain missing Pi setup when launched.

## Run

Launch Rudu from inside a git repository:

```bash
rudu
```

## Development

Install dependencies:

```bash
bun install
```

Run in watch mode:

```bash
bun dev
```

Run tests:

```bash
bun test
```
