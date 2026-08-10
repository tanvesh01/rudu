use std::collections::BTreeMap;
use std::io::Write;
use std::path::Path;
use std::process::{Command, Stdio};

use crate::support::hash_text;

use crate::cache::{
    find_local_checkout, read_local_checkouts,
    remove_local_checkout as remove_cached_local_checkout, save_local_checkout,
};
use crate::models::{
    LocalCheckout, LocalCheckoutPatch, LocalCheckoutStatus, LocalDiffSource, LocalFileChange,
};

#[derive(Debug, PartialEq, Eq)]
pub struct CheckoutInspection {
    pub root_path: String,
    pub folder_name: String,
    pub branch: String,
    pub github_repo: Option<String>,
    pub repository_key: String,
}

#[derive(Debug, PartialEq, Eq)]
pub struct WorkingTreeDiff {
    pub branch: String,
    pub head_sha: String,
    pub patch: String,
    pub changes: Vec<LocalFileChange>,
}

#[derive(Debug, PartialEq, Eq)]
pub struct WorkingTreeStatus {
    pub branch: String,
    pub head_sha: String,
    pub revision: String,
    pub changed_files: Vec<String>,
    pub changes: Vec<LocalFileChange>,
}

pub fn inspect_checkout(selected_path: &Path) -> Result<CheckoutInspection, String> {
    if !selected_path.exists() {
        return Err(format!(
            "Local checkout path does not exist: {}",
            selected_path.display()
        ));
    }

    let root_path = git_output(
        selected_path,
        &["rev-parse", "--show-toplevel"],
        "find the Git working-tree root",
    )?;
    let root = Path::new(root_path.trim())
        .canonicalize()
        .map_err(|error| format!("Failed to resolve local checkout path: {error}"))?;
    let folder_name = root
        .file_name()
        .ok_or_else(|| "Local checkout root has no folder name".to_string())?
        .to_string_lossy()
        .to_string();
    let branch = git_output(
        &root,
        &["branch", "--show-current"],
        "read the current branch",
    )?
    .trim()
    .to_string();
    let github_repo = find_github_repo(&root);
    let repository_key = github_repo
        .clone()
        .unwrap_or_else(|| local_repository_key(&root));

    Ok(CheckoutInspection {
        root_path: root.to_string_lossy().to_string(),
        folder_name,
        branch,
        github_repo,
        repository_key,
    })
}

pub fn checkout_from_inspection(inspection: CheckoutInspection) -> LocalCheckout {
    LocalCheckout {
        id: hash_text(&inspection.root_path),
        path: inspection.root_path,
        repository_key: inspection.repository_key,
        folder_name: inspection.folder_name,
        branch: inspection.branch,
        github_repo: inspection.github_repo,
        available: true,
    }
}

pub fn add_local_checkout(path: String) -> Result<LocalCheckout, String> {
    let path = path.trim();
    if path.is_empty() {
        return Err("Local checkout path is required".to_string());
    }
    let checkout = checkout_from_inspection(inspect_checkout(Path::new(path))?);
    save_local_checkout(&checkout)?;
    Ok(checkout)
}

pub fn list_local_checkouts() -> Result<Vec<LocalCheckout>, String> {
    let mut checkouts = read_local_checkouts()?;
    for checkout in &mut checkouts {
        match inspect_checkout(Path::new(&checkout.path)) {
            Ok(inspection) => {
                let refreshed = checkout_from_inspection(inspection);
                checkout.branch = refreshed.branch;
                checkout.folder_name = refreshed.folder_name;
                checkout.github_repo = refreshed.github_repo;
                checkout.repository_key = refreshed.repository_key;
                checkout.available = true;
            }
            Err(_) => checkout.available = false,
        }
    }
    Ok(checkouts)
}

pub fn get_local_checkout_status(
    id: String,
    source: Option<LocalDiffSource>,
) -> Result<LocalCheckoutStatus, String> {
    let checkout = find_checkout(&id)?;
    let root = Path::new(&checkout.path);
    if let Some(source) = source {
        let inspection = inspect_checkout(root)?;
        let head_sha = git_output(root, &["rev-parse", "HEAD"], "resolve HEAD")?
            .trim()
            .to_string();
        let review = load_diff_source(root, &source)?;
        return Ok(LocalCheckoutStatus {
            checkout_id: checkout.id,
            branch: inspection.branch,
            head_sha,
            revision: review.revision,
            changed_files: review.changed_files.clone(),
            changes: review.changed_files.into_iter().map(empty_change).collect(),
        });
    }

    let status = load_working_tree_status(root)?;
    Ok(LocalCheckoutStatus {
        checkout_id: checkout.id,
        branch: status.branch,
        head_sha: status.head_sha,
        revision: status.revision,
        changed_files: status.changed_files,
        changes: status.changes,
    })
}

pub fn get_local_checkout_patch(
    id: String,
    revision: String,
    source: Option<LocalDiffSource>,
) -> Result<LocalCheckoutPatch, String> {
    let checkout = find_checkout(&id)?;
    let root = Path::new(&checkout.path);
    let patch = if let Some(source) = source {
        let review = load_diff_source(root, &source)?;
        if review.revision != revision {
            return Err("Diff source changed while loading the patch; retrying".to_string());
        }
        review.patch
    } else {
        load_patch_for_revision(root, &revision)?
    };

    Ok(LocalCheckoutPatch {
        checkout_id: checkout.id,
        revision,
        patch,
    })
}

pub fn remove_local_checkout(id: String) -> Result<(), String> {
    let id = id.trim();
    if id.is_empty() {
        return Err("Local checkout id is required".to_string());
    }
    remove_cached_local_checkout(id)
}

fn find_checkout(id: &str) -> Result<LocalCheckout, String> {
    find_local_checkout(id.trim())?.ok_or_else(|| "Local checkout was not found".to_string())
}

pub fn load_working_tree_diff(root: &Path) -> Result<WorkingTreeDiff, String> {
    let status = load_working_tree_status(root)?;
    let patch = load_working_tree_patch(root)?;

    Ok(WorkingTreeDiff {
        branch: status.branch,
        head_sha: status.head_sha,
        patch,
        changes: status.changes,
    })
}

pub fn load_working_tree_status(root: &Path) -> Result<WorkingTreeStatus, String> {
    let inspection = inspect_checkout(root)?;
    let root = Path::new(&inspection.root_path);
    let head_sha = git_output(root, &["rev-parse", "HEAD"], "resolve HEAD")?
        .trim()
        .to_string();
    let mut changes = BTreeMap::<String, LocalFileChange>::new();

    for path in git_paths(
        root,
        &["diff", "--cached", "--name-only", "-z", "HEAD", "--"],
        "list staged files",
    )? {
        changes
            .entry(path.clone())
            .or_insert_with(|| empty_change(path))
            .staged = true;
    }
    for path in git_paths(
        root,
        &["diff", "--name-only", "-z", "--"],
        "list unstaged files",
    )? {
        changes
            .entry(path.clone())
            .or_insert_with(|| empty_change(path))
            .unstaged = true;
    }
    let untracked_paths = list_untracked_files(root)?;
    for path in &untracked_paths {
        changes
            .entry(path.clone())
            .or_insert_with(|| empty_change(path.clone()))
            .untracked = true;
    }

    let changed_files = net_changed_files(root)?;
    let porcelain = git_output(
        root,
        &["status", "--porcelain=v2", "-z", "--untracked-files=all"],
        "fingerprint working-tree status",
    )?;
    let mut fingerprint = format!("{}\0{}\0{}", inspection.branch, head_sha, porcelain);
    for path in &changed_files {
        fingerprint.push('\0');
        fingerprint.push_str(path);
        fingerprint.push('\0');
        fingerprint.push_str(
            &git_output_optional(root, &["hash-object", "--", path])
                .unwrap_or_else(|| "deleted".to_string()),
        );
    }

    Ok(WorkingTreeStatus {
        branch: inspection.branch,
        head_sha,
        revision: hash_text(&fingerprint),
        changed_files,
        changes: changes.into_values().collect(),
    })
}

fn load_working_tree_patch(root: &Path) -> Result<String, String> {
    let inspection = inspect_checkout(root)?;
    let root = Path::new(&inspection.root_path);
    let mut patch = git_output(
        root,
        &["diff", "--binary", "--find-renames", "HEAD", "--"],
        "load tracked working-tree changes",
    )?;
    for path in list_untracked_files(root)? {
        let untracked_patch = git_output_allowing_changes(
            root,
            &["diff", "--no-index", "--binary", "--", "/dev/null", &path],
            "load an untracked file diff",
        )?;
        if !patch.is_empty() && !patch.ends_with('\n') {
            patch.push('\n');
        }
        patch.push_str(&untracked_patch);
    }

    Ok(patch)
}

fn net_changed_files(root: &Path) -> Result<Vec<String>, String> {
    let mut paths = git_paths(
        root,
        &["diff", "--find-renames", "--name-only", "-z", "HEAD", "--"],
        "list working-tree changes relative to HEAD",
    )?;
    paths.extend(list_untracked_files(root)?);
    paths.sort();
    paths.dedup();
    Ok(paths)
}

fn list_untracked_files(root: &Path) -> Result<Vec<String>, String> {
    git_paths(
        root,
        &["ls-files", "--others", "--exclude-standard", "-z", "--"],
        "list untracked files",
    )
}

struct LoadedDiffSource {
    patch: String,
    revision: String,
    changed_files: Vec<String>,
}

pub fn validate_diff_source(root: &Path, source: &LocalDiffSource) -> Result<(), String> {
    load_diff_source(root, source).map(drop)
}

fn load_diff_source(root: &Path, source: &LocalDiffSource) -> Result<LoadedDiffSource, String> {
    let (mut patch, mut changed_files) = match source {
        LocalDiffSource::GitDiff {
            target,
            staged,
            include_untracked,
            paths,
        } => {
            let patch_args = git_diff_args(
                target.as_deref(),
                *staged,
                paths,
                &["--binary", "--find-renames"],
            );
            let names_args =
                git_diff_args(target.as_deref(), *staged, paths, &["--name-only", "-z"]);
            let mut patch = git_output_owned(root, &patch_args, "load selected Git diff")?;
            let mut changed_files = git_paths_owned(root, &names_args, "list selected Git files")?;

            if *include_untracked && !staged && target.as_deref().is_none_or(is_single_revision) {
                for path in list_untracked_files_for_paths(root, paths)? {
                    append_patch(
                        &mut patch,
                        &git_output_allowing_changes(
                            root,
                            &["diff", "--no-index", "--binary", "--", "/dev/null", &path],
                            "load an untracked file diff",
                        )?,
                    );
                    changed_files.push(path);
                }
            }
            (patch, changed_files)
        }
        LocalDiffSource::GitShow { target, paths } => {
            let target = target.as_deref().unwrap_or("HEAD");
            let mut patch_args = vec![
                "show".to_string(),
                "--format=".to_string(),
                "--binary".to_string(),
                "--find-renames".to_string(),
                target.to_string(),
                "--".to_string(),
            ];
            patch_args.extend(paths.iter().cloned());
            let mut names_args = vec![
                "show".to_string(),
                "--format=".to_string(),
                "--name-only".to_string(),
                "-z".to_string(),
                target.to_string(),
                "--".to_string(),
            ];
            names_args.extend(paths.iter().cloned());
            (
                git_output_owned(root, &patch_args, "load selected commit")?,
                git_paths_owned(root, &names_args, "list selected commit files")?,
            )
        }
        LocalDiffSource::Patch { path } => {
            let path = resolve_input_path(root, path);
            let patch = std::fs::read_to_string(&path)
                .map_err(|error| format!("Could not read patch {}: {error}", path.display()))?;
            let changed_files = patch_paths(root, &patch)?;
            (patch, changed_files)
        }
        LocalDiffSource::Files { old_path, new_path } => {
            let old_path = resolve_input_path(root, old_path);
            let new_path = resolve_input_path(root, new_path);
            let patch = git_output_allowing_changes(
                root,
                &[
                    "diff",
                    "--no-index",
                    "--binary",
                    "--",
                    &old_path.to_string_lossy(),
                    &new_path.to_string_lossy(),
                ],
                "compare files",
            )?;
            let changed_files = patch_paths(root, &patch)?;
            (patch, changed_files)
        }
    };

    patch = patch.replace("\r\n", "\n");
    changed_files.sort();
    changed_files.dedup();
    Ok(LoadedDiffSource {
        revision: hash_text(&patch),
        patch,
        changed_files,
    })
}

fn git_diff_args(
    target: Option<&str>,
    staged: bool,
    paths: &[String],
    options: &[&str],
) -> Vec<String> {
    let mut args = vec!["diff".to_string()];
    args.extend(options.iter().map(|value| value.to_string()));
    if staged {
        args.push("--cached".to_string());
    }
    if let Some(target) = target {
        args.push(target.to_string());
    }
    args.push("--".to_string());
    args.extend(paths.iter().cloned());
    args
}

fn is_single_revision(target: &str) -> bool {
    !target.contains("..") && !target.ends_with("^!") && !target.ends_with("^@")
}

fn list_untracked_files_for_paths(root: &Path, paths: &[String]) -> Result<Vec<String>, String> {
    let mut args = vec![
        "ls-files".to_string(),
        "--others".to_string(),
        "--exclude-standard".to_string(),
        "-z".to_string(),
        "--".to_string(),
    ];
    args.extend(paths.iter().cloned());
    git_paths_owned(root, &args, "list untracked files")
}

fn append_patch(patch: &mut String, extra: &str) {
    if !patch.is_empty() && !patch.ends_with('\n') {
        patch.push('\n');
    }
    patch.push_str(extra);
}

fn resolve_input_path(root: &Path, input: &str) -> std::path::PathBuf {
    let path = Path::new(input);
    if path.is_absolute() {
        path.to_path_buf()
    } else {
        root.join(path)
    }
}

fn patch_paths(root: &Path, patch: &str) -> Result<Vec<String>, String> {
    let mut child = Command::new("git")
        .args(["apply", "--numstat", "-z", "--"])
        .current_dir(root)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| format!("Failed to inspect patch: {error}"))?;
    child
        .stdin
        .take()
        .ok_or_else(|| "Failed to open patch input".to_string())?
        .write_all(patch.as_bytes())
        .map_err(|error| format!("Failed to inspect patch: {error}"))?;
    let output = child
        .wait_with_output()
        .map_err(|error| format!("Failed to inspect patch: {error}"))?;
    if !output.status.success() {
        return Err(format!(
            "Failed to inspect patch: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        ));
    }

    let parts = output
        .stdout
        .split(|byte| *byte == 0)
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>();
    let mut paths = Vec::new();
    let mut index = 0;
    while index < parts.len() {
        let fields = parts[index]
            .splitn(3, |byte| *byte == b'\t')
            .collect::<Vec<_>>();
        let Some(path) = fields.get(2) else { break };
        if path.is_empty() && index + 2 < parts.len() {
            paths.push(String::from_utf8_lossy(parts[index + 2]).to_string());
            index += 3;
        } else {
            paths.push(String::from_utf8_lossy(path).to_string());
            index += 1;
        }
    }
    Ok(paths)
}

fn git_output_owned(cwd: &Path, args: &[String], action: &str) -> Result<String, String> {
    let args = args.iter().map(String::as_str).collect::<Vec<_>>();
    git_output(cwd, &args, action)
}

fn git_paths_owned(cwd: &Path, args: &[String], action: &str) -> Result<Vec<String>, String> {
    Ok(git_output_owned(cwd, args, action)?
        .split('\0')
        .filter(|path| !path.is_empty())
        .map(ToString::to_string)
        .collect())
}

fn load_patch_for_revision(root: &Path, expected_revision: &str) -> Result<String, String> {
    let before = load_working_tree_status(root)?;
    if before.revision != expected_revision {
        return Err("Working tree changed while loading the patch; retrying".to_string());
    }

    let patch = load_working_tree_patch(root)?;
    let after = load_working_tree_status(root)?;
    if after.revision != expected_revision {
        return Err("Working tree changed while loading the patch; retrying".to_string());
    }

    Ok(patch)
}

fn empty_change(path: String) -> LocalFileChange {
    LocalFileChange {
        path,
        staged: false,
        unstaged: false,
        untracked: false,
    }
}

fn git_paths(cwd: &Path, args: &[&str], action: &str) -> Result<Vec<String>, String> {
    Ok(git_output(cwd, args, action)?
        .split('\0')
        .filter(|path| !path.is_empty())
        .map(ToString::to_string)
        .collect())
}

fn git_output(cwd: &Path, args: &[&str], action: &str) -> Result<String, String> {
    git_output_with_statuses(cwd, args, action, &[0])
}

fn git_output_allowing_changes(cwd: &Path, args: &[&str], action: &str) -> Result<String, String> {
    git_output_with_statuses(cwd, args, action, &[0, 1])
}

fn git_output_with_statuses(
    cwd: &Path,
    args: &[&str],
    action: &str,
    accepted_statuses: &[i32],
) -> Result<String, String> {
    let output = Command::new("git")
        .args(args)
        .current_dir(cwd)
        .output()
        .map_err(|error| format!("Failed to {action}: {error}"))?;

    let status_code = output.status.code().unwrap_or(-1);
    if !accepted_statuses.contains(&status_code) {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(if stderr.is_empty() {
            format!("Failed to {action}")
        } else {
            format!("Failed to {action}: {stderr}")
        });
    }

    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

fn git_output_optional(cwd: &Path, args: &[&str]) -> Option<String> {
    let output = Command::new("git")
        .args(args)
        .current_dir(cwd)
        .output()
        .ok()?;
    output
        .status
        .success()
        .then(|| String::from_utf8_lossy(&output.stdout).trim().to_string())
}

fn find_github_repo(root: &Path) -> Option<String> {
    let remote_names = git_output_optional(root, &["remote"])?;
    let mut names = remote_names.lines().collect::<Vec<_>>();
    names.sort_by_key(|name| *name != "origin");

    names.into_iter().find_map(|name| {
        git_output_optional(root, &["remote", "get-url", name])
            .and_then(|remote| github_repo_from_remote(&remote))
    })
}

fn github_repo_from_remote(remote: &str) -> Option<String> {
    let remote = remote.trim().trim_end_matches('/').trim_end_matches(".git");
    let path = if let Some(path) = remote.strip_prefix("git@github.com:") {
        path
    } else {
        remote.split_once("github.com/")?.1
    };
    let mut segments = path.split('/').filter(|segment| !segment.is_empty());
    let owner = segments.next()?;
    let repo = segments.next()?;
    if segments.next().is_some() {
        return None;
    }
    Some(format!("{owner}/{repo}"))
}

fn local_repository_key(root: &Path) -> String {
    let common_dir = git_output_optional(root, &["rev-parse", "--git-common-dir"])
        .map(|path| {
            let path = Path::new(&path);
            let path = if path.is_absolute() {
                path.to_path_buf()
            } else {
                root.join(path)
            };
            path.canonicalize().unwrap_or(path)
        })
        .unwrap_or_else(|| root.to_path_buf());
    format!("local:{}", hash_text(&common_dir.to_string_lossy()))
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::path::PathBuf;
    use std::process::Command;
    use std::time::{SystemTime, UNIX_EPOCH};

    use super::{
        inspect_checkout, load_diff_source, load_working_tree_diff, CheckoutInspection,
        LocalFileChange,
    };
    use crate::models::LocalDiffSource;
    use crate::support::hash_text;

    fn temp_repo(name: &str) -> PathBuf {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock is after unix epoch")
            .as_nanos();
        let root = std::env::temp_dir().join(format!(
            "rudu-local-checkout-{name}-{}-{nonce}",
            std::process::id()
        ));
        fs::create_dir_all(&root).expect("create temporary repository directory");

        let output = Command::new("git")
            .args(["init", "-b", "main"])
            .arg(&root)
            .output()
            .expect("run git init");
        assert!(
            output.status.success(),
            "git init failed: {}",
            String::from_utf8_lossy(&output.stderr)
        );
        root
    }

    fn git(root: &PathBuf, args: &[&str]) {
        let output = Command::new("git")
            .args(args)
            .current_dir(root)
            .output()
            .expect("run git command");
        assert!(
            output.status.success(),
            "git {args:?} failed: {}",
            String::from_utf8_lossy(&output.stderr)
        );
    }

    fn commit_initial_file(root: &PathBuf) {
        fs::write(root.join("tracked.txt"), "base\n").expect("write tracked file");
        git(root, &["add", "tracked.txt"]);
        git(
            root,
            &[
                "-c",
                "user.name=Rudu Tests",
                "-c",
                "user.email=rudu@example.com",
                "commit",
                "-m",
                "initial",
            ],
        );
    }

    #[test]
    fn inspection_resolves_a_nested_selection_to_the_git_root() {
        let root = temp_repo("nested-selection");
        let nested = root.join("src/components");
        fs::create_dir_all(&nested).expect("create nested selection");

        let inspection = inspect_checkout(&nested).expect("inspect local checkout");

        assert_eq!(
            inspection,
            CheckoutInspection {
                root_path: fs::canonicalize(&root)
                    .expect("canonicalize temporary repository")
                    .to_string_lossy()
                    .to_string(),
                folder_name: root
                    .file_name()
                    .expect("temporary repository has a folder name")
                    .to_string_lossy()
                    .to_string(),
                branch: "main".to_string(),
                github_repo: None,
                repository_key: format!(
                    "local:{}",
                    hash_text(
                        &fs::canonicalize(root.join(".git"))
                            .expect("canonicalize git directory")
                            .to_string_lossy()
                    )
                ),
            }
        );

        fs::remove_dir_all(root).expect("remove temporary repository");
    }

    #[test]
    fn working_tree_diff_combines_staged_unstaged_and_untracked_changes() {
        let root = temp_repo("combined-diff");
        commit_initial_file(&root);

        fs::write(root.join("tracked.txt"), "staged\n").expect("write staged change");
        git(&root, &["add", "tracked.txt"]);
        fs::write(root.join("tracked.txt"), "unstaged\n").expect("write unstaged change");
        fs::write(root.join("untracked.txt"), "brand new\n").expect("write untracked file");

        let diff = load_working_tree_diff(&root).expect("load working-tree diff");

        assert_eq!(diff.branch, "main");
        assert!(!diff.head_sha.is_empty());
        assert_eq!(
            diff.changes,
            vec![
                LocalFileChange {
                    path: "tracked.txt".to_string(),
                    staged: true,
                    unstaged: true,
                    untracked: false,
                },
                LocalFileChange {
                    path: "untracked.txt".to_string(),
                    staged: false,
                    unstaged: false,
                    untracked: true,
                },
            ]
        );
        assert!(diff
            .patch
            .contains("diff --git a/tracked.txt b/tracked.txt"));
        assert!(diff
            .patch
            .contains("diff --git a/untracked.txt b/untracked.txt"));

        fs::remove_dir_all(root).expect("remove temporary repository");
    }

    #[test]
    fn explicit_git_sources_cover_worktree_staged_range_and_show() {
        let root = temp_repo("explicit-sources");
        commit_initial_file(&root);
        fs::write(root.join("tracked.txt"), "staged\n").expect("write staged change");
        git(&root, &["add", "tracked.txt"]);
        fs::write(root.join("tracked.txt"), "unstaged\n").expect("write unstaged change");
        fs::write(root.join("untracked.txt"), "new\n").expect("write untracked file");

        let unstaged = load_diff_source(
            &root,
            &LocalDiffSource::GitDiff {
                target: None,
                staged: false,
                include_untracked: true,
                paths: vec![],
            },
        )
        .expect("load unstaged diff");
        assert_eq!(
            unstaged.changed_files,
            vec!["tracked.txt".to_string(), "untracked.txt".to_string()]
        );

        let staged = load_diff_source(
            &root,
            &LocalDiffSource::GitDiff {
                target: None,
                staged: true,
                include_untracked: true,
                paths: vec![],
            },
        )
        .expect("load staged diff");
        assert_eq!(staged.changed_files, vec!["tracked.txt".to_string()]);
        assert!(!staged.patch.contains("untracked.txt"));

        let combined = load_diff_source(
            &root,
            &LocalDiffSource::GitDiff {
                target: Some("HEAD".to_string()),
                staged: false,
                include_untracked: true,
                paths: vec![],
            },
        )
        .expect("load combined diff");
        assert_eq!(
            combined.changed_files,
            vec!["tracked.txt".to_string(), "untracked.txt".to_string()]
        );
        fs::write(root.join("change.patch"), &combined.patch).expect("write patch file");
        let from_patch = load_diff_source(
            &root,
            &LocalDiffSource::Patch {
                path: "change.patch".to_string(),
            },
        )
        .expect("load patch file");
        assert_eq!(from_patch.changed_files, combined.changed_files);

        git(&root, &["add", "tracked.txt"]);
        git(
            &root,
            &[
                "-c",
                "user.name=Rudu Tests",
                "-c",
                "user.email=rudu@example.com",
                "commit",
                "-m",
                "second",
            ],
        );
        let shown = load_diff_source(
            &root,
            &LocalDiffSource::GitShow {
                target: None,
                paths: vec![],
            },
        )
        .expect("show latest commit");
        assert_eq!(shown.changed_files, vec!["tracked.txt".to_string()]);

        fs::remove_dir_all(root).expect("remove temporary repository");
    }

    #[test]
    fn inspection_recognizes_a_github_origin_identity() {
        let root = temp_repo("github-origin");
        git(
            &root,
            &[
                "remote",
                "add",
                "origin",
                "git@github.com:outerworld/rudu.git",
            ],
        );

        let inspection = inspect_checkout(&root).expect("inspect local checkout");

        assert_eq!(inspection.github_repo, Some("outerworld/rudu".to_string()));

        fs::remove_dir_all(root).expect("remove temporary repository");
    }

    #[test]
    fn inspection_recognizes_a_github_remote_when_origin_is_absent() {
        let root = temp_repo("github-upstream");
        git(
            &root,
            &[
                "remote",
                "add",
                "upstream",
                "https://github.com/Outerworld/Rudu.git",
            ],
        );

        let inspection = inspect_checkout(&root).expect("inspect local checkout");

        assert_eq!(inspection.github_repo, Some("Outerworld/Rudu".to_string()));

        fs::remove_dir_all(root).expect("remove temporary repository");
    }

    #[test]
    fn status_excludes_a_tracked_file_whose_staged_change_is_reversed() {
        let root = temp_repo("reversed-staged-change");
        commit_initial_file(&root);
        fs::write(root.join("tracked.txt"), "staged\n").expect("write staged change");
        git(&root, &["add", "tracked.txt"]);
        fs::write(root.join("tracked.txt"), "base\n").expect("reverse staged change");

        let diff = load_working_tree_diff(&root).expect("load working-tree diff");
        let changed_files = super::net_changed_files(&root).expect("load net changed files");

        assert_eq!(
            diff.changes,
            vec![LocalFileChange {
                path: "tracked.txt".to_string(),
                staged: true,
                unstaged: true,
                untracked: false,
            }]
        );
        assert!(diff.patch.is_empty());
        assert!(changed_files.is_empty());

        fs::remove_dir_all(root).expect("remove temporary repository");
    }

    #[test]
    fn patch_load_rejects_a_stale_working_tree_revision() {
        let root = temp_repo("stale-revision");
        commit_initial_file(&root);
        let initial = super::load_working_tree_status(&root).expect("load initial status");
        fs::write(root.join("tracked.txt"), "changed\n").expect("change tracked file");

        let error = super::load_patch_for_revision(&root, &initial.revision)
            .expect_err("stale revision must fail");

        assert!(error.contains("Working tree changed"));
        fs::remove_dir_all(root).expect("remove temporary repository");
    }
}
