---
name: rudu
description: Drive a live Rudu diff-review app session from the CLI. Open working-tree, commit, branch, patch, file, or pull-request diffs; inspect changes; steer the user's view; and manage local review notes and PR drafts.
---

# Rudu

Rudu is a desktop diff-review app. The app window belongs to the user — never ask the user to click things for you. Use an open command to choose what Rudu displays, then `rudu session *` to inspect, navigate, and leave local notes.

## Open a session

```bash
rudu /path/to/repo                         # Working Tree Review
rudu diff main...HEAD                      # Selected Diff Review
rudu show HEAD                             # selected commit
rudu patch change.patch                    # patch file
rudu pr owner/repo#123                     # Pull Request Review
rudu pr https://github.com/owner/repo/pull/123
rudu skill path                            # print this skill's installed path
```

Open commands launch or focus the existing app. They return after Rudu accepts the request, not after the diff finishes rendering.

`rudu session list` returns persisted local checkouts, pull requests tracked in Rudu, and the current `active` target. With no selector, session commands use that active target. Use an explicit selector when needed:

```text
--repo <path>                working tree for that checkout
--pr <url|owner/repo#number> that tracked pull request
```

Do not pass both. For a Selected Diff Review, omit `--repo`; passing it intentionally selects the checkout's Working Tree Review.

## Core workflow

```bash
rudu pr owner/repo#123
rudu session list
rudu session review
rudu session navigate --file src/app.ts --new-line 42
rudu session comment add --file src/app.ts --new-line 42 --body "Explain this edge case"
rudu session comment list --type user
rudu session comment reply --note NOTE_ID --body "Answer"
# Only after the user explicitly asks to publish:
rudu session comment publish
```

All session output is JSON. Use `--new-line` for additions and `--old-line` for deletions; line numbers are 1-based.

## Choose a local diff

Use Git's own revision syntax instead of inventing source flags:

```bash
rudu diff                         # unstaged + untracked
rudu diff --staged                # staged
rudu diff HEAD                    # staged + unstaged + untracked
rudu show                         # latest commit
rudu show HEAD~1                  # selected commit
rudu diff main...HEAD             # merge-base/PR-style branch diff
rudu diff HEAD~3..HEAD -- src     # range limited by pathspec
rudu diff before.ts after.ts      # two files
rudu patch change.patch           # patch file
some-command-producing-patch | rudu patch -
```

These commands never mutate Git state. Review Notes on a Selected Diff Review are scoped to its exact source and resolved revision.

If a local review response contains `relatedPullRequest`, its current `HEAD` exactly matches a cached open PR. Keep reviewing the local target unless the user asks to switch; open the PR with `rudu pr owner/repo#number` when its GitHub context is needed. Absence means only that Rudu found no exact cached match.

## Inspect

```bash
rudu session review [--repo <path> | --pr <ref>] [--include-patch]
```

Local responses include:

```text
kind, checkoutId, branch, headSha, revision, files, relatedPullRequest?
```

PR responses include:

```text
kind, repo, number, headSha, summary, overview, checks, files
```

Overview or checks may have companion error fields while the diff remains usable. Add `--include-patch` only when raw unified diff is necessary; prefer local files when reviewing a checkout.

## Navigate

```bash
rudu session navigate [--repo <path> | --pr <ref>] \
  --file <path> (--new-line <n> | --old-line <n>)
```

Navigate before commenting so the user sees the code being discussed.

## Local notes and PR drafts

```bash
rudu session comment add [--repo <path> | --pr <ref>] --file <path> (--new-line <n> | --old-line <n>) --body <markdown>
rudu session comment reply [--repo <path> | --pr <ref>] --note <id> --body <markdown>
rudu session comment delete [--repo <path> | --pr <ref>] --note <id> [--note <id> ...]
rudu session comment delete [--repo <path> | --pr <ref>] --all
rudu session comment list [--repo <path> | --pr <ref>] [--file <path>] [--type agent|user|all]
rudu session comment publish [--repo <path> | --pr <ref>]
```

- Every note starts local to Rudu.
- PR notes are drafts scoped to `{repo, number, headSha}`.
- `comment publish` sends all root drafts as one comment-only GitHub review; local replies are not posted.
- Publish only after the user explicitly asks. This action cannot be undone in Rudu.
- A new PR head has a separate draft set.
- `comment list` on a PR returns local `notes` and read-only `githubThreads`.
- Reply only to IDs from local `notes`; GitHub threads cannot be replied to or edited yet.
- Deleting a root note also deletes its local replies.
- `comment delete --all` deletes all local notes for the exact selected target; list first.
- Publishing a Local Checkout requires its cached exact-head `relatedPullRequest`; invalid PR diff locations fail the whole publication and remain local.
- Use `comment reply`, not `comment add`, when answering a human's local note.
- `--type user` is the human-authored input channel; default is all local notes.

## Guiding a review

1. Run `review` to understand the target.
2. Inspect existing GitHub threads and local human notes before adding feedback.
3. Navigate to the relevant line.
4. Add only comments that clarify intent, risk, or follow-up work.
5. Reply in the existing local thread when answering the user.
6. Never publish without an explicit user request. After publishing, report the returned review URL and any `cleanupError`.

## Common errors

- **"Rudu is not running"** — open it with `rudu <path>` or `rudu pr <ref>`.
- **"no session matches repo"** — run `rudu <path>` first.
- **"pull request ... is not tracked"** — run `rudu pr <ref>` first.
- **"file not in the selected diff"** — inspect `session review` and use one of its file paths.
