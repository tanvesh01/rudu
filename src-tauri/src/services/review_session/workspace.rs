use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, Output};

use crate::github::run_gh;

use super::{emit_workspace_log, ReviewSessionInput, ReviewWorkspaceEvent};

const REPO_DIR: &str = "repo";
const RUDU_DIR: &str = ".rudu";

pub(super) struct ReviewWorkspace {
    pub(super) workspace_dir: PathBuf,
    pub(super) head_sha: String,
}

pub(super) fn prepare<F>(
    input: &ReviewSessionInput,
    emit_event: &F,
) -> Result<ReviewWorkspace, String>
where
    F: Fn(ReviewWorkspaceEvent),
{
    let root = workspaces_root()?;
    let cache_path = repository_cache_path(&root, &input.repo)?;
    let workspace_dir = workspace_path(&root, &input.repo, input.number)?;
    let repo_dir = workspace_dir.join(REPO_DIR);
    let rudu_dir = workspace_dir.join(RUDU_DIR);

    ensure_repository_cache(input, &cache_path, emit_event)?;
    fetch_pull_request_head(input, &cache_path, input.number, emit_event)?;

    let fetched_head = git_output_logged(
        input,
        emit_event,
        &["rev-parse", &pr_ref(input.number)],
        &cache_path,
        "resolve fetched pull request head",
    )?
    .trim()
    .to_string();

    if fetched_head != input.head_sha {
        return Err(format!(
            "Selected pull request head is stale. Rudu fetched {fetched_head}, but the app selected {}. Refresh the pull request and try again.",
            input.head_sha
        ));
    }

    emit_workspace_log(
        input,
        emit_event,
        "running",
        "Create Review Workspace directory",
        Some(format!("mkdir -p {}", shell_quote_path(&workspace_dir))),
    );
    fs::create_dir_all(&workspace_dir)
        .map_err(|error| format!("Failed to create review workspace directory: {error}"))?;
    emit_workspace_log(
        input,
        emit_event,
        "success",
        "Review Workspace directory ready",
        None,
    );
    prepare_worktree(input, &cache_path, &repo_dir, &fetched_head, emit_event)?;
    emit_workspace_log(
        input,
        emit_event,
        "running",
        "Create Rudu metadata directory",
        Some(format!("mkdir -p {}", shell_quote_path(&rudu_dir))),
    );
    fs::create_dir_all(&rudu_dir).map_err(|error| {
        format!("Failed to create Rudu review workspace metadata directory: {error}")
    })?;
    emit_workspace_log(
        input,
        emit_event,
        "success",
        "Rudu metadata directory ready",
        None,
    );

    Ok(ReviewWorkspace {
        workspace_dir,
        head_sha: fetched_head,
    })
}

pub(super) fn list_tracked_files(workspace_dir: &Path) -> Result<Vec<String>, String> {
    let repo_dir = workspace_dir.join(REPO_DIR);
    let output = git_output(
        &["ls-files", "-z"],
        &repo_dir,
        "list review workspace files",
    )?;
    Ok(output
        .split('\0')
        .filter_map(|path| {
            let path = path.trim();
            if path.is_empty() {
                None
            } else {
                Some(path.to_string())
            }
        })
        .collect())
}

fn workspaces_root() -> Result<PathBuf, String> {
    let home = std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .map(PathBuf::from)
        .ok_or_else(|| "Could not resolve the home directory for ~/rudu/workspaces.".to_string())?;
    Ok(home.join("rudu").join("workspaces"))
}

fn repository_cache_path(root: &Path, repo: &str) -> Result<PathBuf, String> {
    let (owner, name) = repo
        .split_once('/')
        .ok_or_else(|| "Repo must be in owner/name format".to_string())?;
    Ok(root
        .join("_repos")
        .join("github.com")
        .join(slug_segment(owner))
        .join(format!("{}.git", slug_segment(name))))
}

fn workspace_path(root: &Path, repo: &str, number: u32) -> Result<PathBuf, String> {
    Ok(root.join(slug_repo(repo)).join(format!("pr-{number}")))
}

fn ensure_repository_cache<F>(
    input: &ReviewSessionInput,
    cache_path: &Path,
    emit_event: &F,
) -> Result<(), String>
where
    F: Fn(ReviewWorkspaceEvent),
{
    if cache_path.join("HEAD").exists() {
        emit_workspace_log(
            input,
            emit_event,
            "success",
            "Repository Cache already exists",
            None,
        );
        return Ok(());
    }

    emit_workspace_log(
        input,
        emit_event,
        "running",
        "Create Repository Cache directory",
        cache_path
            .parent()
            .map(|parent| format!("mkdir -p {}", shell_quote_path(parent))),
    );
    if let Some(parent) = cache_path.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("Failed to create repository cache directory: {error}"))?;
    }

    let cache_path_arg = cache_path.to_string_lossy().to_string();
    let command = command_line(
        "gh",
        None,
        &[
            "repo",
            "clone",
            input.repo(),
            &cache_path_arg,
            "--",
            "--bare",
        ],
    );
    emit_workspace_log(
        input,
        emit_event,
        "running",
        "Clone Repository Cache",
        Some(command),
    );
    run_gh(&[
        "repo",
        "clone",
        input.repo(),
        &cache_path_arg,
        "--",
        "--bare",
    ])?;
    emit_workspace_log(
        input,
        emit_event,
        "success",
        "Repository Cache cloned",
        None,
    );
    Ok(())
}

fn fetch_pull_request_head<F>(
    input: &ReviewSessionInput,
    cache_path: &Path,
    number: u32,
    emit_event: &F,
) -> Result<(), String>
where
    F: Fn(ReviewWorkspaceEvent),
{
    let remote_ref = format!("refs/pull/{number}/head");
    let local_ref = pr_ref(number);
    let refspec = format!("{remote_ref}:{local_ref}");
    git_output_logged(
        input,
        emit_event,
        &["fetch", "--force", "origin", &refspec],
        cache_path,
        "fetch pull request head",
    )
    .map(|_| ())
}

fn prepare_worktree<F>(
    input: &ReviewSessionInput,
    cache_path: &Path,
    repo_dir: &Path,
    head_sha: &str,
    emit_event: &F,
) -> Result<(), String>
where
    F: Fn(ReviewWorkspaceEvent),
{
    if repo_dir.exists() {
        validate_existing_worktree(input, repo_dir, head_sha, emit_event)?;
        return Ok(());
    }

    emit_workspace_log(
        input,
        emit_event,
        "running",
        "Create worktree parent directory",
        repo_dir
            .parent()
            .map(|parent| format!("mkdir -p {}", shell_quote_path(parent))),
    );
    if let Some(parent) = repo_dir.parent() {
        fs::create_dir_all(parent).map_err(|error| {
            format!("Failed to create review workspace parent directory: {error}")
        })?;
    }

    let repo_path_arg = repo_dir.to_string_lossy().to_string();
    let _ = git_output_logged(
        input,
        emit_event,
        &["worktree", "prune"],
        cache_path,
        "prune stale review workspace worktrees",
    );
    git_output_logged(
        input,
        emit_event,
        &["worktree", "add", "--detach", &repo_path_arg, head_sha],
        cache_path,
        "create review workspace worktree",
    )
    .map(|_| ())
}

fn validate_existing_worktree<F>(
    input: &ReviewSessionInput,
    repo_dir: &Path,
    head_sha: &str,
    emit_event: &F,
) -> Result<(), String>
where
    F: Fn(ReviewWorkspaceEvent),
{
    let status = git_output_logged(
        input,
        emit_event,
        &["status", "--porcelain"],
        repo_dir,
        "inspect existing review workspace",
    )?;
    if !status.trim().is_empty() {
        return Err(format!(
            "Review workspace has local changes. Delete or clean {} before Rudu updates it.",
            repo_dir.display()
        ));
    }

    let current_head = git_output_logged(
        input,
        emit_event,
        &["rev-parse", "HEAD"],
        repo_dir,
        "read existing review workspace head",
    )?
    .trim()
    .to_string();

    if current_head == head_sha {
        return Ok(());
    }

    git_output_logged(
        input,
        emit_event,
        &["checkout", "--detach", head_sha],
        repo_dir,
        "update review workspace head",
    )?;

    let updated_head = git_output_logged(
        input,
        emit_event,
        &["rev-parse", "HEAD"],
        repo_dir,
        "verify updated review workspace head",
    )?
    .trim()
    .to_string();
    if updated_head != head_sha {
        return Err(format!(
            "Review workspace checkout verification failed. Expected {head_sha}, got {updated_head}."
        ));
    }

    Ok(())
}

fn git_output_logged<F>(
    input: &ReviewSessionInput,
    emit_event: &F,
    args: &[&str],
    current_dir: &Path,
    action: &str,
) -> Result<String, String>
where
    F: Fn(ReviewWorkspaceEvent),
{
    emit_workspace_log(
        input,
        emit_event,
        "running",
        action,
        Some(command_line("git", Some(current_dir), args)),
    );
    match git_output(args, current_dir, action) {
        Ok(output) => {
            emit_workspace_log(
                input,
                emit_event,
                "success",
                &format!("{action} complete"),
                None,
            );
            Ok(output)
        }
        Err(error) => {
            emit_workspace_log(
                input,
                emit_event,
                "error",
                &format!("{action} failed"),
                None,
            );
            Err(error)
        }
    }
}

fn git_output(args: &[&str], current_dir: &Path, action: &str) -> Result<String, String> {
    let output = Command::new("git")
        .args(args)
        .current_dir(current_dir)
        .output()
        .map_err(|error| format!("Failed to {action}: {error}"))?;

    if output.status.success() {
        return String::from_utf8(output.stdout).map_err(|error| {
            format!("git returned non-UTF-8 output while trying to {action}: {error}")
        });
    }

    Err(format!("Failed to {action}: {}", output_message(&output)))
}

fn output_message(output: &Output) -> String {
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    if !stderr.is_empty() {
        return stderr;
    }

    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if !stdout.is_empty() {
        return stdout;
    }

    format!("git exited with status {}", output.status)
}

fn pr_ref(number: u32) -> String {
    format!("refs/rudu/pr/{number}/head")
}

fn slug_repo(repo: &str) -> String {
    repo.split('/')
        .map(slug_segment)
        .collect::<Vec<_>>()
        .join("-")
}

fn slug_segment(value: &str) -> String {
    let mut output = String::new();
    let mut previous_dash = false;

    for ch in value.chars() {
        let next = if ch.is_ascii_alphanumeric() {
            previous_dash = false;
            Some(ch.to_ascii_lowercase())
        } else if !previous_dash {
            previous_dash = true;
            Some('-')
        } else {
            None
        };

        if let Some(next) = next {
            output.push(next);
        }
    }

    output.trim_matches('-').to_string()
}

fn command_line(program: &str, current_dir: Option<&Path>, args: &[&str]) -> String {
    let mut parts = vec![program.to_string()];
    if let Some(current_dir) = current_dir {
        parts.push("-C".to_string());
        parts.push(shell_quote_path(current_dir));
    }
    parts.extend(args.iter().map(|arg| shell_quote(arg)));
    parts.join(" ")
}

fn shell_quote_path(path: &Path) -> String {
    shell_quote(&path.to_string_lossy())
}

fn shell_quote(value: &str) -> String {
    if value
        .chars()
        .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '/' | '.' | '-' | '_' | ':' | '='))
    {
        return value.to_string();
    }

    format!("'{}'", value.replace('\'', "'\\''"))
}
