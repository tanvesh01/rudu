use std::process::{Command, Output};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use crate::models::{GhCliStatus, GhCliStatusKind};

struct UserContext {
    owners: Vec<String>,
    fetched_at: Instant,
}

const USER_CONTEXT_TTL: Duration = Duration::from_secs(3600);

static USER_CONTEXT: Mutex<Option<UserContext>> = Mutex::new(None);

fn output_message(output: &Output) -> String {
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();

    if !stderr.is_empty() {
        return stderr;
    }

    if !stdout.is_empty() {
        return stdout;
    }

    format!("gh exited with status {}", output.status)
}

fn gh_command_candidates() -> Vec<String> {
    let mut candidates = Vec::new();

    if let Some(configured_path) = std::env::var_os("RUDU_GH_PATH") {
        let configured_path = configured_path.to_string_lossy().trim().to_string();
        if !configured_path.is_empty() {
            candidates.push(configured_path);
        }
    }

    candidates.push("gh".to_string());

    #[cfg(target_os = "macos")]
    {
        candidates.push("/opt/homebrew/bin/gh".to_string());
        candidates.push("/usr/local/bin/gh".to_string());
    }

    candidates
}

fn run_gh_output(args: &[&str]) -> Result<Output, std::io::Error> {
    let mut last_not_found_error = None;

    for candidate in gh_command_candidates() {
        match Command::new(&candidate).args(args).output() {
            Ok(output) => return Ok(output),
            Err(error) if gh_cli_missing(&error) => {
                last_not_found_error = Some(error);
            }
            Err(error) => return Err(error),
        }
    }

    Err(last_not_found_error.unwrap_or_else(|| {
        std::io::Error::new(
            std::io::ErrorKind::NotFound,
            "GitHub CLI is not installed or could not be located",
        )
    }))
}

pub fn run_gh(args: &[&str]) -> Result<String, String> {
    let output = run_gh_output(args).map_err(|error| format!("Failed to execute gh: {error}"))?;

    if output.status.success() {
        return String::from_utf8(output.stdout)
            .map_err(|error| format!("gh returned non-UTF-8 output: {error}"));
    }

    Err(output_message(&output))
}

fn gh_cli_missing(error: &std::io::Error) -> bool {
    error.kind() == std::io::ErrorKind::NotFound
}

fn is_not_authenticated_message(message: &str) -> bool {
    let message = message.to_ascii_lowercase();
    message.contains("not logged")
        || message.contains("gh auth login")
        || message.contains("authenticate")
        || message.contains("github.com") && message.contains("login")
}

pub fn get_gh_cli_status_sync() -> GhCliStatus {
    let version_output = run_gh_output(&["--version"]);
    let version_output = match version_output {
        Ok(output) => output,
        Err(error) => {
            if gh_cli_missing(&error) {
                return GhCliStatus {
                    status: GhCliStatusKind::MissingCli,
                    message: Some("GitHub CLI is not installed or not available on PATH.".into()),
                };
            }

            return GhCliStatus {
                status: GhCliStatusKind::UnknownError,
                message: Some(format!("Couldn't verify GitHub CLI: {error}")),
            };
        }
    };

    if !version_output.status.success() {
        return GhCliStatus {
            status: GhCliStatusKind::UnknownError,
            message: Some(output_message(&version_output)),
        };
    }

    let auth_output = run_gh_output(&["auth", "status"]);
    let auth_output = match auth_output {
        Ok(output) => output,
        Err(error) => {
            if gh_cli_missing(&error) {
                return GhCliStatus {
                    status: GhCliStatusKind::MissingCli,
                    message: Some("GitHub CLI is not installed or not available on PATH.".into()),
                };
            }

            return GhCliStatus {
                status: GhCliStatusKind::UnknownError,
                message: Some(format!("Couldn't check GitHub auth status: {error}")),
            };
        }
    };

    if auth_output.status.success() {
        return GhCliStatus {
            status: GhCliStatusKind::Ready,
            message: None,
        };
    }

    let message = output_message(&auth_output);
    if is_not_authenticated_message(&message) {
        return GhCliStatus {
            status: GhCliStatusKind::NotAuthenticated,
            message: Some("Authenticate GitHub CLI with `gh auth login`.".into()),
        };
    }

    GhCliStatus {
        status: GhCliStatusKind::UnknownError,
        message: Some(message),
    }
}

pub fn ensure_user_context() -> Result<Vec<String>, String> {
    {
        let ctx = USER_CONTEXT.lock().map_err(|e| e.to_string())?;
        if let Some(ref ctx) = *ctx {
            if ctx.fetched_at.elapsed() < USER_CONTEXT_TTL {
                return Ok(ctx.owners.clone());
            }
        }
    }

    let username = run_gh(&["api", "user", "--jq", ".login"])?;
    let username = username.trim().to_string();

    let mut owners = vec![username];

    if let Ok(orgs_stdout) = run_gh(&["api", "user/orgs", "--jq", ".[].login"]) {
        for org in orgs_stdout.lines() {
            let org = org.trim();
            if !org.is_empty() {
                owners.push(org.to_string());
            }
        }
    }

    let mut ctx = USER_CONTEXT.lock().map_err(|e| e.to_string())?;
    *ctx = Some(UserContext {
        owners: owners.clone(),
        fetched_at: Instant::now(),
    });

    Ok(owners)
}

pub fn run_gh_graphql(args: &[String]) -> Result<String, String> {
    let args_ref: Vec<&str> = args.iter().map(|arg| arg.as_str()).collect();
    run_gh(&args_ref)
}

pub fn get_viewer_login_sync() -> Result<String, String> {
    ensure_user_context()?
        .into_iter()
        .next()
        .ok_or_else(|| "Unable to determine GitHub viewer login".to_string())
}
