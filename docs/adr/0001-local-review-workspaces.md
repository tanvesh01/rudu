# Use local Review Workspaces for AI review context

Rudu will replace the Cloudflare Worker-backed remote file tree with a local, Rudu-managed Review Workspace under `~/rudu/workspaces`. Each GitHub repository is cloned once into a shared bare Repository Cache, and each pull request gets one moving Git worktree that Rudu updates to the latest head SHA before starting the AI review; this keeps review context inspectable and avoids per-push workspace proliferation while preserving a local, inspection-only tool boundary.
