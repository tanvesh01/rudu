use std::collections::VecDeque;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};

use crate::models::LocalDiffSource;
use crate::support::parse_pull_request_ref;

use super::local_checkout::{inspect_checkout, validate_diff_source};

pub const CLI_LAUNCH_EVENT: &str = "rudu://cli-launch";

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum CliLaunch {
    Normal,
    OpenLocalCheckout {
        path: String,
    },
    OpenDiff {
        path: String,
        source: LocalDiffSource,
    },
    OpenPullRequest {
        repo: String,
        number: u32,
    },
    Help,
    Version,
}

pub struct CliLaunchQueue(Mutex<VecDeque<CliLaunch>>);

impl CliLaunchQueue {
    pub fn new(launch: CliLaunch) -> Self {
        let queue = match launch {
            CliLaunch::OpenLocalCheckout { .. }
            | CliLaunch::OpenDiff { .. }
            | CliLaunch::OpenPullRequest { .. } => [launch].into(),
            _ => VecDeque::new(),
        };
        Self(Mutex::new(queue))
    }

    pub fn push(&self, launch: CliLaunch) {
        if let Ok(mut queue) = self.0.lock() {
            queue.push_back(launch);
        }
    }

    pub fn take(&self) -> Option<CliLaunch> {
        self.0.lock().ok()?.pop_front()
    }
}

pub fn parse_cli_launch(args: &[String], cwd: &Path) -> Result<CliLaunch, String> {
    match args {
        [] => Ok(CliLaunch::Normal),
        [flag] if flag == "--help" => Ok(CliLaunch::Help),
        [flag] if flag == "--version" => Ok(CliLaunch::Version),
        [command, rest @ ..] if command == "diff" => parse_diff_launch(rest, cwd),
        [command, rest @ ..] if command == "show" => parse_show_launch(rest, cwd),
        [command, rest @ ..] if command == "patch" => parse_patch_launch(rest, cwd),
        [command, rest @ ..] if command == "pr" => parse_pull_request_launch(rest),
        [path] if !path.starts_with('-') => open_local_checkout(path, cwd),
        _ => Err(format!(
            "{}\n{}",
            "Expected zero or one checkout directory.",
            usage()
        )),
    }
}

pub fn usage() -> &'static str {
    "Usage: rudu [<directory>]\n       rudu diff [<target>] [--staged] [--exclude-untracked] [-- <pathspec>...]\n       rudu show [<ref>] [-- <pathspec>...]\n       rudu patch <file|->\n       rudu pr <github-url|owner/repo#number>\n       rudu session <list|review|navigate|note add|note reply|note list|comment draft|comment delete|comment list|comment publish> [--repo <path>|--pr <ref>] [options]\n       rudu skill path\n       rudu --help\n       rudu --version"
}

pub fn validate_cli_launch(launch: &CliLaunch) -> Result<(), String> {
    match launch {
        CliLaunch::OpenDiff { path, source } => validate_diff_source(Path::new(path), source),
        _ => Ok(()),
    }
}

pub fn handle_cli_launch(app: &AppHandle, args: &[String], cwd: &Path) {
    let args = args.get(1..).unwrap_or_default();
    let Ok(launch) = parse_cli_launch(args, cwd) else {
        return;
    };
    if !matches!(
        launch,
        CliLaunch::OpenLocalCheckout { .. }
            | CliLaunch::OpenDiff { .. }
            | CliLaunch::OpenPullRequest { .. }
    ) {
        focus_main_window(app);
        return;
    }

    focus_main_window(app);
    app.state::<CliLaunchQueue>().push(launch);
    let _ = app.emit(CLI_LAUNCH_EVENT, ());
}

pub fn focus_main_window(app: &AppHandle) {
    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    let _ = window.show();
    let _ = window.unminimize();
    let _ = window.set_focus();
}

pub fn install_cli_launcher(_app: &AppHandle) -> Result<String, String> {
    #[cfg(not(target_os = "macos"))]
    {
        let _ = _app;
        return Err("The Rudu command-line launcher is supported on macOS only.".to_string());
    }

    #[cfg(target_os = "macos")]
    {
        use std::os::unix::fs::PermissionsExt;

        let home = std::env::var_os("HOME").map(PathBuf::from).ok_or_else(|| {
            "Could not resolve the home directory for the Rudu CLI launcher.".to_string()
        })?;
        let bin_dir = home.join(".local/bin");
        fs::create_dir_all(&bin_dir)
            .map_err(|error| format!("Could not create {}: {error}", bin_dir.display()))?;
        let executable = std::env::current_exe()
            .map_err(|error| format!("Could not locate the Rudu app executable: {error}"))?;
        let launcher_path = bin_dir.join("rudu");
        let script = launcher_script(&executable);
        fs::write(&launcher_path, script)
            .map_err(|error| format!("Could not write {}: {error}", launcher_path.display()))?;
        let mut permissions = fs::metadata(&launcher_path)
            .map_err(|error| format!("Could not read {}: {error}", launcher_path.display()))?
            .permissions();
        permissions.set_mode(0o755);
        fs::set_permissions(&launcher_path, permissions).map_err(|error| {
            format!(
                "Could not make {} executable: {error}",
                launcher_path.display()
            )
        })?;
        Ok(launcher_path.to_string_lossy().to_string())
    }
}

#[cfg(target_os = "macos")]
fn shell_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\\\"'\\\"'"))
}

#[cfg(target_os = "macos")]
fn launcher_script(executable: &Path) -> String {
    format!(
        "#!/bin/sh\nRUDU_APP={}\nif [ ! -x \"$RUDU_APP\" ]; then\n  printf '%s\\n' 'Rudu app not found. Open Rudu and reinstall the command-line launcher.' >&2\n  exit 1\nfi\nif [ \"${{1-}}\" = patch ] && [ \"${{2-}}\" = - ]; then\n  PATCH_FILE=$(mktemp \"${{TMPDIR:-/tmp}}/rudu-patch.XXXXXX\") || exit 1\n  cat >\"$PATCH_FILE\" || exit 1\n  shift 2\n  set -- patch \"$PATCH_FILE\" \"$@\"\nfi\ncase \"${{1-}}\" in\n  --help|--version|session|skill)\n    exec \"$RUDU_APP\" \"$@\"\n    ;;\n  *)\n    \"$RUDU_APP\" --validate-launch \"$@\" || exit $?\n    RUDU_APP_BUNDLE=${{RUDU_APP%/Contents/MacOS/*}}\n    if [ \"$RUDU_APP_BUNDLE\" = \"$RUDU_APP\" ]; then\n      \"$RUDU_APP\" \"$@\" >/dev/null 2>&1 &\n    else\n      exec /usr/bin/open --env \"RUDU_CLI_CWD=$PWD\" -n \"$RUDU_APP_BUNDLE\" --args \"$@\"\n    fi\n    ;;\nesac\n",
        shell_quote(&executable.to_string_lossy())
    )
}

fn parse_pull_request_launch(args: &[String]) -> Result<CliLaunch, String> {
    let [pull_request] = args else {
        return Err(format!("Expected one pull request.\n{}", usage()));
    };
    let (repo, number) = parse_pull_request_ref(pull_request)?;
    Ok(CliLaunch::OpenPullRequest { repo, number })
}

fn parse_diff_launch(args: &[String], cwd: &Path) -> Result<CliLaunch, String> {
    let (args, explicit_paths) = split_pathspec(args);
    let staged = args
        .iter()
        .any(|arg| arg == "--staged" || arg == "--cached");
    let include_untracked = !args.iter().any(|arg| arg == "--exclude-untracked");
    let positional = args
        .iter()
        .filter(|arg| {
            !matches!(
                arg.as_str(),
                "--staged" | "--cached" | "--exclude-untracked"
            )
        })
        .collect::<Vec<_>>();
    if let Some(flag) = positional.iter().find(|arg| arg.starts_with('-')) {
        return Err(format!("Unknown diff option: {flag}\n{}", usage()));
    }

    if positional.len() == 2 {
        let old_path = resolve_cli_path(positional[0], cwd);
        let new_path = resolve_cli_path(positional[1], cwd);
        if old_path.is_file() && new_path.is_file() && explicit_paths.is_empty() && !staged {
            return open_diff(
                cwd,
                LocalDiffSource::Files {
                    old_path: old_path.to_string_lossy().to_string(),
                    new_path: new_path.to_string_lossy().to_string(),
                },
            );
        }
    }

    let target = positional.first().map(|value| value.to_string());
    let mut paths = positional
        .iter()
        .skip(1)
        .map(|value| value.to_string())
        .collect::<Vec<_>>();
    paths.extend(explicit_paths);
    open_diff(
        cwd,
        LocalDiffSource::GitDiff {
            target,
            staged,
            include_untracked,
            paths,
        },
    )
}

fn parse_show_launch(args: &[String], cwd: &Path) -> Result<CliLaunch, String> {
    let (args, explicit_paths) = split_pathspec(args);
    if args.iter().any(|arg| arg.starts_with('-')) {
        return Err(format!("Unknown show option.\n{}", usage()));
    }
    let target = args.first().cloned();
    let mut paths = args.iter().skip(1).cloned().collect::<Vec<_>>();
    paths.extend(explicit_paths);
    open_diff(cwd, LocalDiffSource::GitShow { target, paths })
}

fn parse_patch_launch(args: &[String], cwd: &Path) -> Result<CliLaunch, String> {
    let [path] = args else {
        return Err(format!("Expected one patch file.\n{}", usage()));
    };
    let path = resolve_cli_path(path, cwd);
    if !path.is_file() {
        return Err(format!("Patch file does not exist: {}", path.display()));
    }
    open_diff(
        cwd,
        LocalDiffSource::Patch {
            path: path.to_string_lossy().to_string(),
        },
    )
}

fn split_pathspec(args: &[String]) -> (&[String], Vec<String>) {
    let Some(separator) = args.iter().position(|arg| arg == "--") else {
        return (args, vec![]);
    };
    (&args[..separator], args[separator + 1..].to_vec())
}

fn resolve_cli_path(input: &str, cwd: &Path) -> PathBuf {
    let path = PathBuf::from(input);
    if path.is_absolute() {
        path
    } else {
        cwd.join(path)
    }
}

fn open_diff(cwd: &Path, source: LocalDiffSource) -> Result<CliLaunch, String> {
    let inspection = inspect_checkout(cwd)?;
    Ok(CliLaunch::OpenDiff {
        path: inspection.root_path,
        source,
    })
}

fn open_local_checkout(input: &str, cwd: &Path) -> Result<CliLaunch, String> {
    let selected_path = PathBuf::from(input);
    let selected_path = if selected_path.is_absolute() {
        selected_path
    } else {
        cwd.join(selected_path)
    };

    if !selected_path.exists() {
        return Err(format!(
            "Local checkout path does not exist: {}",
            selected_path.display()
        ));
    }
    if !selected_path.is_dir() {
        return Err(format!(
            "Local checkout path must be a directory: {}",
            selected_path.display()
        ));
    }

    let inspection = inspect_checkout(&selected_path)?;
    Ok(CliLaunch::OpenLocalCheckout {
        path: inspection.root_path,
    })
}

#[cfg(test)]
mod tests {
    use std::fs;
    #[cfg(target_os = "macos")]
    use std::io::Write;
    use std::path::PathBuf;
    use std::process::Command;
    #[cfg(target_os = "macos")]
    use std::process::Stdio;

    use super::{parse_cli_launch, validate_cli_launch, CliLaunch, CliLaunchQueue};
    use crate::models::LocalDiffSource;

    #[cfg(target_os = "macos")]
    use super::launcher_script;

    fn temp_repo(name: &str) -> PathBuf {
        let root =
            std::env::temp_dir().join(format!("rudu-cli-launcher-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).expect("create temporary repository");
        let output = Command::new("git")
            .args(["init", "--initial-branch=main"])
            .current_dir(&root)
            .output()
            .expect("run git init");
        assert!(output.status.success(), "git init must succeed");
        root
    }

    #[test]
    fn parses_a_nested_checkout_path_as_its_canonical_git_root() {
        let root = temp_repo("nested-path");
        let nested = root.join("packages/widget");
        fs::create_dir_all(&nested).expect("create nested path");

        let launch = parse_cli_launch(&[nested.to_string_lossy().to_string()], &root)
            .expect("parse local checkout path");

        assert_eq!(
            launch,
            CliLaunch::OpenLocalCheckout {
                path: fs::canonicalize(&root)
                    .expect("canonicalize repository")
                    .to_string_lossy()
                    .to_string(),
            }
        );

        fs::remove_dir_all(root).expect("remove temporary repository");
    }

    #[test]
    fn parses_pull_request_launches() {
        let cwd = std::path::Path::new("/tmp");
        for pull_request in [
            "https://github.com/outerworld/rudu/pull/42",
            "outerworld/rudu#42",
        ] {
            assert_eq!(
                parse_cli_launch(&["pr".to_string(), pull_request.to_string()], cwd).unwrap(),
                CliLaunch::OpenPullRequest {
                    repo: "outerworld/rudu".to_string(),
                    number: 42,
                }
            );
        }
        assert!(parse_cli_launch(&["pr".to_string()], cwd).is_err());
        assert!(parse_cli_launch(
            &[
                "pr".to_string(),
                "outerworld/rudu#42".to_string(),
                "extra".to_string(),
            ],
            cwd,
        )
        .is_err());
    }

    #[test]
    fn parses_hunk_style_diff_show_patch_and_file_sources() {
        let root = temp_repo("diff-sources");
        let old_path = root.join("old.txt");
        let new_path = root.join("new.txt");
        let patch_path = root.join("change.patch");
        fs::write(&old_path, "old\n").expect("write old file");
        fs::write(&new_path, "new\n").expect("write new file");
        fs::write(&patch_path, "diff --git a/a b/a\n").expect("write patch");
        let root_path = fs::canonicalize(&root)
            .expect("canonicalize repository")
            .to_string_lossy()
            .to_string();

        assert_eq!(
            parse_cli_launch(
                &[
                    "diff".to_string(),
                    "main...HEAD".to_string(),
                    "--".to_string(),
                    "src".to_string(),
                ],
                &root,
            )
            .expect("parse range diff"),
            CliLaunch::OpenDiff {
                path: root_path.clone(),
                source: LocalDiffSource::GitDiff {
                    target: Some("main...HEAD".to_string()),
                    staged: false,
                    include_untracked: true,
                    paths: vec!["src".to_string()],
                },
            }
        );
        assert_eq!(
            parse_cli_launch(&["show".to_string()], &root).expect("parse show"),
            CliLaunch::OpenDiff {
                path: root_path.clone(),
                source: LocalDiffSource::GitShow {
                    target: None,
                    paths: vec![],
                },
            }
        );
        assert!(matches!(
            parse_cli_launch(
                &[
                    "patch".to_string(),
                    patch_path.to_string_lossy().to_string()
                ],
                &root,
            )
            .expect("parse patch"),
            CliLaunch::OpenDiff {
                source: LocalDiffSource::Patch { .. },
                ..
            }
        ));
        let files_launch = parse_cli_launch(
            &[
                "diff".to_string(),
                old_path.to_string_lossy().to_string(),
                new_path.to_string_lossy().to_string(),
            ],
            &root,
        )
        .expect("parse files");
        assert!(matches!(
            files_launch,
            CliLaunch::OpenDiff {
                source: LocalDiffSource::Files { .. },
                ..
            }
        ));
        let payload = serde_json::to_value(files_launch).expect("serialize launch");
        assert!(payload["source"]["oldPath"].is_string());

        fs::remove_dir_all(root).expect("remove temporary repository");
    }

    #[test]
    fn validation_rejects_an_unknown_diff_ref() {
        let root = temp_repo("invalid-diff-ref");
        let launch = parse_cli_launch(
            &["diff".to_string(), "missing-base...HEAD".to_string()],
            &root,
        )
        .expect("parse range diff");

        assert!(validate_cli_launch(&launch)
            .expect_err("missing ref must fail before launch")
            .contains("load selected Git diff"));

        fs::remove_dir_all(root).expect("remove temporary repository");
    }

    #[test]
    fn rejects_file_paths_and_extra_arguments_without_launching() {
        let root = temp_repo("invalid-input");
        let file = root.join("file.txt");
        fs::write(&file, "not a directory").expect("write file");

        let file_error = parse_cli_launch(&[file.to_string_lossy().to_string()], &root)
            .expect_err("file path must be rejected");
        assert!(file_error.contains("directory"));

        let extra_error = parse_cli_launch(
            &[root.to_string_lossy().to_string(), "extra".to_string()],
            &root,
        )
        .expect_err("extra argument must be rejected");
        assert!(extra_error.contains("Usage"));

        fs::remove_dir_all(root).expect("remove temporary repository");
    }

    #[test]
    fn queues_cli_launches_in_order() {
        let launch = |path: &str| CliLaunch::OpenLocalCheckout {
            path: path.to_string(),
        };
        let queue = CliLaunchQueue::new(launch("first"));
        queue.push(launch("second"));

        assert_eq!(queue.take(), Some(launch("first")));
        assert_eq!(queue.take(), Some(launch("second")));
        assert_eq!(queue.take(), None);
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn launcher_preserves_stdio_and_hands_off_validated_gui_launches() {
        let script = launcher_script(std::path::Path::new(
            "/Applications/Rudu.app/Contents/MacOS/rudu",
        ));

        assert!(script.contains("--help|--version|session|skill)\n    exec \"$RUDU_APP\" \"$@\"",));
        assert!(script.contains("cat >\"$PATCH_FILE\""));
        assert!(script.contains("\"$RUDU_APP\" --validate-launch \"$@\" || exit $?"));
        assert!(script.contains(
            "exec /usr/bin/open --env \"RUDU_CLI_CWD=$PWD\" -n \"$RUDU_APP_BUNDLE\" --args \"$@\""
        ));

        let mut shell = Command::new("sh")
            .arg("-n")
            .stdin(Stdio::piped())
            .spawn()
            .expect("start shell parser");
        shell
            .stdin
            .take()
            .unwrap()
            .write_all(script.as_bytes())
            .unwrap();
        assert!(shell.wait().unwrap().success());
    }
}
