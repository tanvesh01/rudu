use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};

use super::local_checkout::inspect_checkout;

pub const CLI_LAUNCH_EVENT: &str = "rudu://open-local-checkout";

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum CliLaunch {
    Normal,
    OpenLocalCheckout { path: String },
    Help,
    Version,
}

pub struct PendingCliLaunch(Mutex<Option<CliLaunch>>);

impl PendingCliLaunch {
    pub fn new(launch: CliLaunch) -> Self {
        Self(Mutex::new(match launch {
            CliLaunch::OpenLocalCheckout { .. } => Some(launch),
            _ => None,
        }))
    }

    pub fn take(&self) -> Option<CliLaunch> {
        self.0.lock().ok()?.take()
    }
}

pub fn parse_cli_launch(args: &[String], cwd: &Path) -> Result<CliLaunch, String> {
    match args {
        [] => Ok(CliLaunch::Normal),
        [flag] if flag == "--help" => Ok(CliLaunch::Help),
        [flag] if flag == "--version" => Ok(CliLaunch::Version),
        [path] if !path.starts_with('-') => open_local_checkout(path, cwd),
        _ => Err(format!(
            "{}\n{}",
            "Expected zero or one checkout directory.",
            usage()
        )),
    }
}

pub fn usage() -> &'static str {
    "Usage: rudu [<directory>]\n       rudu session <list|review|navigate|comment add|comment list> [--repo <path>] [options]\n       rudu skill path\n       rudu --help\n       rudu --version"
}

pub fn handle_cli_launch(app: &AppHandle, args: &[String], cwd: &Path) {
    let args = args.get(1..).unwrap_or_default();
    let Ok(launch) = parse_cli_launch(args, cwd) else {
        return;
    };
    let CliLaunch::OpenLocalCheckout { .. } = launch else {
        focus_main_window(app);
        return;
    };

    focus_main_window(app);
    let _ = app.emit(CLI_LAUNCH_EVENT, launch);
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
        "#!/bin/sh\nRUDU_APP={}\nif [ ! -x \"$RUDU_APP\" ]; then\n  printf '%s\\n' 'Rudu app not found. Open Rudu and reinstall the command-line launcher.' >&2\n  exit 1\nfi\ncase \"${{1-}}\" in\n  --help|--version|session|skill)\n    exec \"$RUDU_APP\" \"$@\"\n    ;;\n  *)\n    \"$RUDU_APP\" \"$@\" >/dev/null 2>&1 &\n    ;;\nesac\n",
        shell_quote(&executable.to_string_lossy())
    )
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
    use std::path::PathBuf;
    use std::process::Command;

    use super::{parse_cli_launch, CliLaunch};

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

    #[cfg(target_os = "macos")]
    #[test]
    fn launcher_preserves_stdio_subcommands_and_backgrounds_gui_launches() {
        let script = launcher_script(std::path::Path::new(
            "/Applications/Rudu.app/Contents/MacOS/rudu",
        ));

        assert!(script.contains("--help|--version|session|skill)\n    exec \"$RUDU_APP\" \"$@\"",));
        assert!(script.contains("\"$RUDU_APP\" \"$@\" >/dev/null 2>&1 &"));
    }
}
