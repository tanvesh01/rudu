# Rudu

Review PRs without losing your mind.

<img width="1512" height="972" alt="rudu (Window) 2026-04-25 01:49 AM" src="https://github.com/user-attachments/assets/e4efdf48-8257-4002-941e-606c6849175f" />



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

### Remote Pi Review Worker

Remote Pi review uses a user-owned Cloudflare Worker plus a session Durable
Object. Rudu reads your local `gh` auth token, passes it to your configured
Worker for the session TTL, and the Worker indexes the selected PR head SHA into
read-only GitHub file tools for Pi.

Packaged users should use Rudu's Deploy Worker button to deploy the isolated
`cloudflare/remote-review` Worker into their own Cloudflare account, then paste
the deployed Worker URL into Rudu and pair it. Rudu generates the bearer token
locally, stores it in the OS credential store, and claims the Worker once after
deployment. The Worker URL is not secret; the paired bearer token is the access
control boundary.

Create the local config files first:

```sh
cp .env.example .env
cp cloudflare/remote-review/.dev.vars.example cloudflare/remote-review/.dev.vars
```

Use the files like this:
- `.env`: values the Tauri app reads during local dev
- `cloudflare/remote-review/.dev.vars`: Wrangler local Worker bindings, including the developer-only `RUDU_REMOTE_REVIEW_API_TOKEN`

The dedicated dev scripts below source `.env` for the app side, and Wrangler
will load `.dev.vars` for the local Worker.

```sh
bun run cf:types
bun run cf:dev
```

For a developer-owned deployed Worker that bypasses post-deploy pairing,
configure the shared bearer token and deploy:

```sh
wrangler secret put RUDU_REMOTE_REVIEW_API_TOKEN --config cloudflare/remote-review/wrangler.jsonc
bun run cf:deploy
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
