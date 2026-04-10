use std::collections::HashSet;
use std::process::Command;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use tauri::Manager;
use tauri_plugin_decorum::WebviewWindowExt;

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct RepoSummary {
    name: String,
    name_with_owner: String,
    description: Option<String>,
    is_private: Option<bool>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct PullRequestSummary {
    number: u32,
    title: String,
    state: String,
    author_login: String,
    updated_at: String,
    url: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GhPullRequest {
    number: u32,
    title: String,
    state: String,
    author: Option<GhActor>,
    updated_at: String,
    url: String,
}

#[derive(Debug, Deserialize)]
struct GhActor {
    login: String,
}

#[derive(Debug, Serialize)]
struct PrPatch {
    repo: String,
    number: u32,
    patch: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ReviewComment {
    id: String,
    database_id: Option<i64>,
    author_login: String,
    body: String,
    created_at: String,
    updated_at: String,
    url: String,
    reply_to_id: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ReviewThread {
    id: String,
    path: String,
    is_resolved: bool,
    is_outdated: bool,
    line: Option<u32>,
    start_line: Option<u32>,
    side: Option<String>,
    start_side: Option<String>,
    subject_type: Option<String>,
    comments: Vec<ReviewComment>,
}

#[derive(Debug, Deserialize)]
struct GraphQlResponse<T> {
    data: Option<T>,
    errors: Option<Vec<GraphQlError>>,
}

#[derive(Debug, Deserialize)]
struct GraphQlError {
    message: String,
}

#[derive(Debug, Deserialize)]
struct ReviewThreadsQueryData {
    repository: Option<ReviewThreadsRepository>,
}

#[derive(Debug, Deserialize)]
struct ReviewThreadsRepository {
    #[serde(rename = "pullRequest")]
    pull_request: Option<ReviewThreadsPullRequest>,
}

#[derive(Debug, Deserialize)]
struct ReviewThreadsPullRequest {
    #[serde(rename = "reviewThreads")]
    review_threads: ReviewThreadsConnection,
}

#[derive(Debug, Deserialize)]
struct ReviewThreadsConnection {
    #[serde(default)]
    nodes: Vec<GraphQlReviewThread>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GraphQlReviewThread {
    id: String,
    is_resolved: bool,
    is_outdated: bool,
    comments: GraphQlReviewCommentsConnection,
}

#[derive(Debug, Deserialize)]
struct GraphQlReviewCommentsConnection {
    #[serde(default)]
    nodes: Vec<GraphQlReviewComment>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GraphQlReviewComment {
    id: String,
    database_id: Option<i64>,
    body: String,
    created_at: String,
    updated_at: String,
    url: String,
    path: String,
    author: Option<GhActor>,
    reply_to: Option<GraphQlReplyTo>,
}

#[derive(Debug, Deserialize)]
struct GraphQlReplyTo {
    id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GhPullRequestReviewComment {
    id: i64,
    path: String,
    line: Option<u32>,
    start_line: Option<u32>,
    side: Option<String>,
    start_side: Option<String>,
    subject_type: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GhSearchRepo {
    name: String,
    full_name: String,
    description: Option<String>,
    is_private: Option<bool>,
}

struct UserContext {
    owners: Vec<String>,
    fetched_at: Instant,
}

const USER_CONTEXT_TTL: Duration = Duration::from_secs(3600);

static USER_CONTEXT: Mutex<Option<UserContext>> = Mutex::new(None);

fn run_gh(args: &[&str]) -> Result<String, String> {
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

fn ensure_user_context() -> Result<Vec<String>, String> {
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

fn parse_repo(repo: &str) -> Result<(&str, &str), String> {
    let repo = repo.trim();
    repo.split_once('/')
        .ok_or_else(|| "Repo must be in owner/name format".to_string())
}

fn run_gh_graphql(args: &[String]) -> Result<String, String> {
    let args_ref: Vec<&str> = args.iter().map(|arg| arg.as_str()).collect();
    run_gh(&args_ref)
}

#[tauri::command]
fn list_initial_repos(limit: Option<u32>) -> Result<Vec<RepoSummary>, String> {
    let limit = limit.unwrap_or(5);
    let limit_str = limit.to_string();

    let stdout = run_gh(&[
        "repo",
        "list",
        "--json",
        "name,nameWithOwner,description,isPrivate",
        "--limit",
        &limit_str,
    ])?;

    serde_json::from_str::<Vec<RepoSummary>>(&stdout)
        .map_err(|error| format!("Failed to parse repos: {error}"))
}

#[tauri::command]
fn search_repos(query: String, limit: Option<u32>) -> Result<Vec<RepoSummary>, String> {
    if query.trim().is_empty() {
        return list_initial_repos(limit);
    }

    let owners = ensure_user_context()?;
    let limit = limit.unwrap_or(20);
    let limit_str = limit.to_string();

    let mut args: Vec<String> = vec![
        "search".into(),
        "repos".into(),
        query.clone(),
        "--limit".into(),
        limit_str,
        "--json".into(),
        "name,fullName,description,isPrivate".into(),
        "--match".into(),
        "name".into(),
    ];

    for owner in &owners {
        args.push("--owner".into());
        args.push(owner.clone());
    }

    let args_ref: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
    let stdout = run_gh(&args_ref)?;

    let search_repos = serde_json::from_str::<Vec<GhSearchRepo>>(&stdout)
        .map_err(|error| format!("Failed to parse search results: {error}"))?;

    let mut repos = Vec::new();
    let mut seen = HashSet::new();

    for sr in search_repos {
        if seen.insert(sr.full_name.clone()) {
            repos.push(RepoSummary {
                name: sr.name,
                name_with_owner: sr.full_name,
                description: sr.description,
                is_private: sr.is_private,
            });
        }
    }

    Ok(repos)
}

#[tauri::command]
fn validate_repo(repo: String) -> Result<RepoSummary, String> {
    let repo = repo.trim();

    if repo.split('/').count() != 2 || repo.starts_with('/') || repo.ends_with('/') {
        return Err("Enter a repo as owner/name".into());
    }

    let stdout = run_gh(&[
        "repo",
        "view",
        repo,
        "--json",
        "name,nameWithOwner,description,isPrivate",
    ])?;

    serde_json::from_str::<RepoSummary>(&stdout)
        .map_err(|error| format!("Failed to parse repo details: {error}"))
}

#[tauri::command]
fn list_pull_requests(repo: String) -> Result<Vec<PullRequestSummary>, String> {
    let repo = repo.trim();
    let stdout = run_gh(&[
        "pr",
        "list",
        "-R",
        repo,
        "--state",
        "open",
        "--limit",
        "100",
        "--json",
        "number,title,state,author,updatedAt,url",
    ])?;

    let pull_requests = serde_json::from_str::<Vec<GhPullRequest>>(&stdout)
        .map_err(|error| format!("Failed to parse pull requests: {error}"))?;

    Ok(pull_requests
        .into_iter()
        .map(|pull_request| PullRequestSummary {
            number: pull_request.number,
            title: pull_request.title,
            state: pull_request.state,
            author_login: pull_request
                .author
                .map(|author| author.login)
                .unwrap_or_else(|| "unknown".into()),
            updated_at: pull_request.updated_at,
            url: pull_request.url,
        })
        .collect())
}

#[tauri::command]
fn get_pull_request_patch(repo: String, number: u32) -> Result<PrPatch, String> {
    let repo = repo.trim();
    let patch = run_gh(&[
        "pr",
        "diff",
        &number.to_string(),
        "-R",
        repo,
        "--patch",
        "--color",
        "never",
    ])?;

    Ok(PrPatch {
        repo: repo.into(),
        number,
        patch,
    })
}

#[tauri::command]
fn list_pull_request_changed_files(repo: String, number: u32) -> Result<Vec<String>, String> {
    let repo = repo.trim();
    let stdout = run_gh(&[
        "pr",
        "diff",
        &number.to_string(),
        "-R",
        repo,
        "--name-only",
        "--color",
        "never",
    ])?;

    let mut seen = HashSet::new();
    let mut files = Vec::new();

    for line in stdout.lines() {
        let path = line.trim();

        if !path.is_empty() && seen.insert(path.to_string()) {
            files.push(path.to_string());
        }
    }

    Ok(files)
}

#[tauri::command]
fn get_pull_request_review_threads(repo: String, number: u32) -> Result<Vec<ReviewThread>, String> {
    let repo = repo.trim();
    let (owner, name) = parse_repo(repo)?;
    let query = r#"
query($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      reviewThreads(first: 100) {
        nodes {
          id
          isResolved
          isOutdated
          comments(first: 100) {
            nodes {
              id
              databaseId
              body
              createdAt
              updatedAt
              url
              path
              author {
                login
              }
              replyTo {
                id
              }
            }
          }
        }
      }
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
        serde_json::from_str::<GraphQlResponse<ReviewThreadsQueryData>>(&graphql_stdout)
            .map_err(|error| format!("Failed to parse review threads: {error}"))?;

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

    let review_thread_nodes = graphql_response
        .data
        .and_then(|data| data.repository)
        .and_then(|repository| repository.pull_request)
        .map(|pull_request| pull_request.review_threads.nodes)
        .unwrap_or_default();

    let comments_stdout = run_gh(&[
        "api",
        &format!("repos/{owner}/{name}/pulls/{number}/comments?per_page=100"),
    ])?;
    let review_comments = serde_json::from_str::<Vec<GhPullRequestReviewComment>>(&comments_stdout)
        .map_err(|error| format!("Failed to parse review comment anchors: {error}"))?;

    let mut comments_by_id = std::collections::HashMap::new();
    for comment in review_comments {
        comments_by_id.insert(comment.id, comment);
    }

    let review_threads = review_thread_nodes
        .into_iter()
        .filter_map(|thread| {
            let anchor_comment = thread
                .comments
                .nodes
                .iter()
                .find(|comment| comment.reply_to.is_none())
                .or_else(|| thread.comments.nodes.first())?;

            let anchor = anchor_comment
                .database_id
                .and_then(|database_id| comments_by_id.get(&database_id));
            let anchor_path = anchor
                .map(|comment| comment.path.clone())
                .unwrap_or_else(|| anchor_comment.path.clone());
            let anchor_line = anchor.and_then(|comment| comment.line);
            let anchor_start_line = anchor.and_then(|comment| comment.start_line);
            let anchor_side = anchor.and_then(|comment| comment.side.clone());
            let anchor_start_side = anchor.and_then(|comment| comment.start_side.clone());
            let anchor_subject_type = anchor.and_then(|comment| comment.subject_type.clone());

            let comments = thread
                .comments
                .nodes
                .into_iter()
                .map(|comment| ReviewComment {
                    id: comment.id,
                    database_id: comment.database_id,
                    author_login: comment
                        .author
                        .map(|author| author.login)
                        .unwrap_or_else(|| "unknown".into()),
                    body: comment.body,
                    created_at: comment.created_at,
                    updated_at: comment.updated_at,
                    url: comment.url,
                    reply_to_id: comment.reply_to.map(|reply_to| reply_to.id),
                })
                .collect::<Vec<_>>();

            Some(ReviewThread {
                id: thread.id,
                path: anchor_path,
                is_resolved: thread.is_resolved,
                is_outdated: thread.is_outdated,
                line: anchor_line,
                start_line: anchor_start_line,
                side: anchor_side,
                start_side: anchor_start_side,
                subject_type: anchor_subject_type,
                comments,
            })
        })
        .collect();

    Ok(review_threads)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_decorum::init())
        .invoke_handler(tauri::generate_handler![
            list_initial_repos,
            search_repos,
            validate_repo,
            list_pull_requests,
            get_pull_request_patch,
            list_pull_request_changed_files,
            get_pull_request_review_threads
        ])
        .setup(|app| {
            if let Some(main_window) = app.get_webview_window("main") {
                if let Err(e) = main_window.create_overlay_titlebar() {
                    eprintln!("Failed to create overlay titlebar: {}", e);
                }
                #[cfg(target_os = "macos")]
                {
                    if let Err(e) = main_window.set_traffic_lights_inset(12.0, 16.0) {
                        eprintln!("Failed to set traffic lights inset: {}", e);
                    }
                }
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
