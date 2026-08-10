# Rudu

Rudu is a local desktop app for inspecting local working-tree changes and reviewing GitHub pull requests with rendered diffs and review comments.

## Language

**Repository**:
A codebase presented once in Rudu, combining its Local Checkouts and GitHub identity when both are known.
_Avoid_: repository entry, tracked repo

**Repository Discovery**:
The set of GitHub repositories the authenticated viewer can access for pull request review.
_Avoid_: global repository search, repo autocomplete

**Repository Suggestions**:
A small starting set of repositories offered before the developer enters a search query.
_Avoid_: complete repository list, initial search results

**Saved Repository**:
A repository the developer has added to Rudu's local sidebar for pull request review.
_Avoid_: tracked repo, watched repo, cloned repo

**Local Checkout**:
An existing Git working tree at a developer-selected path, independent of whether it has a GitHub remote.
_Avoid_: Local Repository, Saved Repository, tracked repo

**Local Checkout Identity**:
The canonical absolute filesystem path of a Local Checkout's Git top-level directory, used to recognize the same checkout even when it is named through a relative path, symlink, or subdirectory.
_Avoid_: entered path, display path

**Unavailable Local Checkout**:
A persisted Local Checkout whose path no longer resolves to a Git working tree.
_Avoid_: deleted repository, invalid Saved Repository

**Working Tree Review**:
A review of a Local Checkout's current uncommitted changes relative to `HEAD`, including staged, unstaged, deleted, and untracked files, presented as one combined change per file.
_Avoid_: local pull request, branch review, commit review

**Working Tree Refresh**:
An update that rereads a Working Tree Review's current changes after repository state changes or a developer request.
_Avoid_: Revision Refresh

**Selected Diff Review**:
A read-only review of an explicit Git range, commit, patch, or file comparison opened for a Local Checkout.
_Avoid_: Working Tree Review, pull request review

**Review Note**:
A local line annotation authored by the developer in Rudu on a Working Tree Review or Selected Diff Review, or by an agent through the Rudu session CLI on a Working Tree Review.
_Avoid_: pull request comment, chat message

**CLI Launch**:
A developer starting Rudu from a terminal, optionally naming one Local Checkout to open. CLI Launch is supported on macOS in v1.
_Avoid_: command-line mode, terminal UI

**Existing Rudu Instance**:
The running Rudu desktop application that receives a later CLI Launch instead of allowing a second application instance.
_Avoid_: background process, duplicate app

**CLI Launcher Installation**:
Rudu's automatic installation of the `rudu` terminal command when a packaged macOS app launches.
_Avoid_: shell configuration changes, PATH takeover

**CLI Launch Failure**:
A terminal-visible failure to resolve a requested CLI Launch path to a readable Local Checkout.
_Avoid_: app error screen, unavailable checkout

**Repository Search**:
Developer-entered repository lookup across accessible GitHub repositories.
_Avoid_: global public search, local repo filtering

**Pull Request Suggestions**:
Open pull requests suggested from the developer's Saved Repositories during onboarding or repository review setup.
_Avoid_: global pull request search, recommended work, tracked pull requests

**Rudu Setup**:
The app preflight step that verifies required local dependencies before repository review begins.
_Avoid_: runtime setup, install wizard

**Pull Request Revision**:
A specific pull request state identified by repository, pull request number, and head SHA.
_Avoid_: PR, branch, current checkout

**App Database**:
Rudu's local SQLite database for durable app-owned state.
_Avoid_: cache-only store, transient UI memory

## Relationships

- A **Repository** may have one or more **Local Checkouts**, a **Saved Repository**, or both
- **Local Checkouts** and a **Saved Repository** with the same GitHub identity are presented as one **Repository**
- Existing remote-only **Saved Repositories** remain visible and usable
- A developer adds a **Local Checkout** through the labeled **Add local checkout** action and explicitly selects its filesystem path
- **CLI Launch** and **Add local checkout** are two entry points to the same Local Checkout flow; only the source of the path differs
- A **CLI Launch** without a path opens Rudu normally
- A **CLI Launch** with a path opens that **Local Checkout**
- A **CLI Launch Failure** prints a concise terminal diagnostic and does not open Rudu
- A CLI Launch path must name a directory; file paths are CLI Launch Failures
- A CLI Launcher whose installed Rudu app is unavailable fails with a terminal recovery instruction and does not search for another app copy
- A successful **CLI Launch** returns after Rudu accepts the request; it does not wait for the **Working Tree Review** to render
- The CLI Launcher's v1 command surface is normal launch, one Local Checkout path, help, and version; it has no repository-mutating commands
- A **CLI Launch** hands off to an **Existing Rudu Instance**, which focuses and navigates to the requested **Working Tree Review**
- A **CLI Launcher Installation** places or refreshes `rudu` in `~/.local/bin` whenever the packaged macOS app starts, without changing shell configuration
- Rudu does not discover **Local Checkouts** by scanning the developer's machine
- Each **Local Checkout** is tracked independently by its filesystem path
- Rudu resolves a **CLI Launch** path from the invoking terminal and recognizes the resulting **Local Checkout** by its **Local Checkout Identity**
- A **CLI Launch** for an existing **Local Checkout Identity** selects that Local Checkout without creating a duplicate; it also restores an **Unavailable Local Checkout** when that path is valid again
- A **Local Checkout** remains in Rudu until the developer explicitly removes it
- An **Unavailable Local Checkout** offers removal but no relocation flow in v1
- A **Working Tree Review** belongs to exactly one **Local Checkout**
- A **Local Checkout** remains visible when its **Working Tree Review** is clean
- A **Working Tree Review** refreshes automatically when its `HEAD`, index, or working-tree files change
- A developer can also request a **Working Tree Refresh** manually
- Rudu observes the current branch but never switches branches or otherwise mutates Git state in a **Local Checkout**
- A **Working Tree Review** may display **Review Notes** from the developer or an agent
- A **Selected Diff Review** may display developer-authored **Review Notes** scoped to its exact source and resolved revision
- Changing a **Selected Diff Review** source or revision does not carry its **Review Notes** into the new review
- **Review Notes** never publish to GitHub; pull request review comments remain exclusive to pull request reviews
- **Repository Discovery** includes repositories owned by the viewer and repositories owned by organizations visible to the viewer
- **Repository Suggestions** are not a complete list of every repository in **Repository Discovery**
- A **Saved Repository** appears in Rudu's local repository sidebar
- Saving a **Saved Repository** does not track any pull requests by itself
- **Repository Search** uses the developer's query to search accessible repositories remotely rather than relying on a preloaded complete repository list
- **Pull Request Suggestions** are drawn from the developer's Saved Repositories
- Accepting a **Pull Request Suggestion** creates a tracked pull request
- **Rudu Setup** requires an installed and authenticated GitHub CLI before repository review can begin
