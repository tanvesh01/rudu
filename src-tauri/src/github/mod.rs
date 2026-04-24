use std::process::Command;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use crate::models::{GraphQlResponse, PullRequestNodeIdQueryData};
use crate::support::parse_repo;

struct UserContext {
    owners: Vec<String>,
    fetched_at: Instant,
}

const USER_CONTEXT_TTL: Duration = Duration::from_secs(3600);

static USER_CONTEXT: Mutex<Option<UserContext>> = Mutex::new(None);

pub fn run_gh(args: &[&str]) -> Result<String, String> {
    let output = Command::new("gh")
        .args(args)
        .output()
        .map_err(|error| format!("Failed to execute gh: {error}"))?;

    if output.status.success() {
        return String::from_utf8(output.stdout)
            .map_err(|error| format!("gh returned non-UTF-8 output: {error}"));
    }

    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let message = if !stderr.is_empty() {
        stderr
    } else if !stdout.is_empty() {
        stdout
    } else {
        format!("gh exited with status {}", output.status)
    };

    Err(message)
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

pub fn get_pull_request_node_id_sync(repo: &str, number: u32) -> Result<String, String> {
    let (owner, name) = parse_repo(repo)?;
    let query = r#"
query($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      id
    }
  }
}
"#;

    let graphql_args = vec![
        "api".to_string(),
        "graphql".to_string(),
        "-f".to_string(),
        format!("owner={owner}"),
        "-f".to_string(),
        format!("name={name}"),
        "-F".to_string(),
        format!("number={number}"),
        "-f".to_string(),
        format!("query={query}"),
    ];
    let graphql_stdout = run_gh_graphql(&graphql_args)?;
    let graphql_response =
        serde_json::from_str::<GraphQlResponse<PullRequestNodeIdQueryData>>(&graphql_stdout)
            .map_err(|error| format!("Failed to parse pull request id: {error}"))?;

    if let Some(errors) = graphql_response.errors {
        let messages = errors
            .into_iter()
            .map(|error| error.message)
            .collect::<Vec<_>>()
            .join("\n");
        return Err(if messages.is_empty() {
            "GitHub returned an unknown GraphQL error".into()
        } else {
            messages
        });
    }

    graphql_response
        .data
        .and_then(|data| data.repository)
        .and_then(|repo| repo.pull_request)
        .map(|pull_request| pull_request.id)
        .filter(|id| !id.trim().is_empty())
        .ok_or_else(|| "Pull request not found".to_string())
}
