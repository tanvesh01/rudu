---
name: rudu
description: Drive a live Rudu diff-review app session from the CLI. Open the app on a checkout, inspect the loaded working-tree diff structure, steer the user's view to specific files/lines, and leave or read inline review notes. Use when the user has Rudu installed and wants an agent-guided review of local changes.
---

# Rudu

Rudu is a desktop diff-review app. The app window belongs to the user — never ask the user to click things for you. Drive it through `rudu session *` commands only.

If `rudu session list` reports no sessions, open Rudu on the checkout first:

```bash
rudu /path/to/repo        # launches or focuses the app on that checkout
```

## Workflow

```text
1. rudu /path/to/repo                                  # open the app on the checkout
2. rudu session list                                   # confirm the session is live
3. rudu session review --repo .                        # file/line structure, no raw patch
4. rudu session navigate --repo . --file X --new-line N   # additions; use --old-line N for deletions
5. rudu session comment add --repo . --file X --new-line N --body "..."
6. rudu session comment list --repo . --type user       # read the human's inline notes
```

All output is JSON. `--repo <path>` matches a session by its checkout root; use any subdirectory of the checkout (e.g. `--repo .` from inside it). If exactly one session exists, `--repo` may be omitted.

## Commands

### Open

```bash
rudu <path>          # open/focus the app on a checkout (relative paths OK)
rudu skill path      # print the installed path of this skill file
```

### Choose any Git diff

Use Git's own revision syntax instead of inventing source flags:

```bash
rudu diff                         # unstaged + untracked
rudu diff --staged                # staged
rudu diff HEAD                    # staged + unstaged + untracked
rudu show                         # latest commit
rudu show HEAD~1                  # selected commit
rudu diff main...HEAD             # merge-base/PR-style branch diff
rudu diff HEAD~3..HEAD -- src     # commit range limited by pathspec
rudu diff before.ts after.ts      # two files
rudu patch change.patch           # patch file
some-command-producing-patch | rudu patch -
```

These commands open a selected, read-only diff in Rudu. Working-tree `session review` and review-note commands remain scoped to the live checkout review.

### Inspect

```bash
rudu session list
rudu session review [--repo <path>] [--include-patch]
```

- `review` returns `{checkoutId, branch, headSha, files: [{path, staged, unstaged, untracked}]}`
- add `--include-patch` only when you truly need the raw unified diff; prefer reading files from disk since you are already in the worktree

### Navigate

```bash
rudu session navigate [--repo <path>] --file <path> (--new-line <n> | --old-line <n>)
```

Scrolls the app's diff view to that file and line. Navigate before commenting so the user sees the code you're discussing. Use `--new-line` for additions and `--old-line` for deletions; line numbers are 1-based.

### Comments

```bash
rudu session comment add [--repo <path>] --file <path> (--new-line <n> | --old-line <n>) --body <markdown>
rudu session comment list [--repo <path>] [--file <path>] [--type agent|user|all]
```

- `comment add` leaves an inline note on the diff, marked agent-authored
- Use `--new-line` when the target note's `side` is `additions`; use `--old-line` when it is `deletions`
- `--type user` returns notes the human typed in the app — your input channel from them
- Default `--type` is `all`
- Agents cannot edit or delete human notes

## Guiding a review

1. `review` to understand what changed
2. `navigate` to the first interesting file/line
3. `comment add` explaining intent, risks, or follow-ups — in the order that tells the clearest story, not file order
4. Don't comment on every file — highlight what the user wouldn't spot themselves
5. Check `comment list --type user` for human-authored notes before finishing

## Common errors

- **"Rudu is not running"** — open it: `rudu <path>`
- **"no session matches repo"** — the checkout isn't open in Rudu; run `rudu <path>` first
- **"file not in the working-tree diff"** — the file has no changes vs HEAD; check `review`
