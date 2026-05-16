use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, Output};

use crate::github::run_gh;

use super::RemoteReviewInput;

const REPO_DIR: &str = "repo";
const RUDU_DIR: &str = ".rudu";

pub(super) struct ReviewWorkspace {
    pub(super) workspace_dir: PathBuf,
    pub(super) rudu_dir: PathBuf,
    pub(super) head_sha: String,
}

pub(super) fn prepare(input: &RemoteReviewInput) -> Result<ReviewWorkspace, String> {
    let root = workspaces_root()?;
    let cache_path = repository_cache_path(&root, &input.repo)?;
    let workspace_dir = workspace_path(&root, &input.repo, input.number)?;
    let repo_dir = workspace_dir.join(REPO_DIR);
    let rudu_dir = workspace_dir.join(RUDU_DIR);

    ensure_repository_cache(&input.repo, &cache_path)?;
    fetch_pull_request_head(&cache_path, input.number)?;

    let fetched_head = git_output(
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

    fs::create_dir_all(&workspace_dir)
        .map_err(|error| format!("Failed to create review workspace directory: {error}"))?;
    prepare_worktree(&cache_path, &repo_dir, &fetched_head)?;
    fs::create_dir_all(&rudu_dir)
        .map_err(|error| format!("Failed to create Rudu review workspace metadata directory: {error}"))?;

    Ok(ReviewWorkspace {
        workspace_dir,
        rudu_dir,
        head_sha: fetched_head,
    })
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

fn ensure_repository_cache(repo: &str, cache_path: &Path) -> Result<(), String> {
    if cache_path.join("HEAD").exists() {
        return Ok(());
    }

    if let Some(parent) = cache_path.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("Failed to create repository cache directory: {error}"))?;
    }

    let cache_path_arg = cache_path.to_string_lossy().to_string();
    run_gh(&["repo", "clone", repo, &cache_path_arg, "--", "--bare"]).map(|_| ())
}

fn fetch_pull_request_head(cache_path: &Path, number: u32) -> Result<(), String> {
    let remote_ref = format!("refs/pull/{number}/head");
    let local_ref = pr_ref(number);
    let refspec = format!("{remote_ref}:{local_ref}");
    git_output(
        &["fetch", "--force", "origin", &refspec],
        cache_path,
        "fetch pull request head",
    )
    .map(|_| ())
}

fn prepare_worktree(cache_path: &Path, repo_dir: &Path, head_sha: &str) -> Result<(), String> {
    if repo_dir.exists() {
        validate_existing_worktree(repo_dir, head_sha)?;
        return Ok(());
    }

    if let Some(parent) = repo_dir.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("Failed to create review workspace parent directory: {error}"))?;
    }

    let repo_path_arg = repo_dir.to_string_lossy().to_string();
    let _ = git_output(
        &["worktree", "prune"],
        cache_path,
        "prune stale review workspace worktrees",
    );
    git_output(
        &["worktree", "add", "--detach", &repo_path_arg, head_sha],
        cache_path,
        "create review workspace worktree",
    )
    .map(|_| ())
}

fn validate_existing_worktree(repo_dir: &Path, head_sha: &str) -> Result<(), String> {
    let status = git_output(
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

    let current_head = git_output(
        &["rev-parse", "HEAD"],
        repo_dir,
        "read existing review workspace head",
    )?
    .trim()
    .to_string();

    if current_head == head_sha {
        return Ok(());
    }

    git_output(&["checkout", "--detach", head_sha], repo_dir, "update review workspace head")?;

    let updated_head = git_output(
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

fn git_output(args: &[&str], current_dir: &Path, action: &str) -> Result<String, String> {
    let output = Command::new("git")
        .args(args)
        .current_dir(current_dir)
        .output()
        .map_err(|error| format!("Failed to {action}: {error}"))?;

    if output.status.success() {
        return String::from_utf8(output.stdout)
            .map_err(|error| format!("git returned non-UTF-8 output while trying to {action}: {error}"));
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
    repo.split('/').map(slug_segment).collect::<Vec<_>>().join("-")
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
