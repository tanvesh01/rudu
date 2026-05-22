# Keep workspace preparation internal

Rudu will not show a separate Review Workspace Activity surface while opening an empty Review Chat. Workspace preparation remains an internal prerequisite for Review Session readiness, while the empty chat state stays focused on the user action: talk to Rudu, ask anything, and mention files or pull requests/issues with `@` and `#`. This supersedes the Review Workspace Activity visibility portion of ADR-0003 without changing the Codex runtime or Review Workspace lifecycle decisions.
