use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use tauri::Manager;
use tauri::path::BaseDirectory;
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
    head_sha: String,
    base_sha: Option<String>,
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
    head_ref_oid: String,
    base_ref_oid: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GhActor {
    login: String,
    avatar_url: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct PrPatch {
    repo: String,
    number: u32,
    head_sha: String,
    patch: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ReviewComment {
    id: String,
    database_id: Option<i64>,
    author_login: String,
    author_avatar_url: Option<String>,
    author_association: Option<String>,
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
    author_association: Option<String>,
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
static CACHE_DB_PATH: OnceLock<PathBuf> = OnceLock::new();

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

async fn run_blocking_task<T, F>(task: F) -> Result<T, String>
where
    T: Send + 'static,
    F: FnOnce() -> Result<T, String> + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(task)
        .await
        .map_err(|error| format!("Blocking task failed: {error}"))?
}

fn now_unix_timestamp() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_secs() as i64)
        .unwrap_or(0)
}

fn bool_to_sql(value: Option<bool>) -> Option<i64> {
    value.map(|item| if item { 1 } else { 0 })
}

fn sql_to_bool(value: Option<i64>) -> Option<bool> {
    value.map(|item| item != 0)
}

fn cache_db_path() -> Result<&'static PathBuf, String> {
    CACHE_DB_PATH
        .get()
        .ok_or_else(|| "Cache database path is not initialized".to_string())
}

fn open_cache_connection() -> Result<Connection, String> {
    let path = cache_db_path()?;
    Connection::open(path)
        .map_err(|error| format!("Failed to open cache database at {}: {error}", path.display()))
}

fn initialize_cache_database(path: &Path) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("Failed to create cache directory {}: {error}", parent.display()))?;
    }

    let conn = Connection::open(path)
        .map_err(|error| format!("Failed to initialize cache database at {}: {error}", path.display()))?;

    conn.execute_batch(
        "
        PRAGMA journal_mode = WAL;
        PRAGMA synchronous = NORMAL;

        CREATE TABLE IF NOT EXISTS repos (
            name_with_owner TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            description TEXT,
            is_private INTEGER,
            added_at INTEGER NOT NULL,
            last_opened_at INTEGER
        );

        CREATE TABLE IF NOT EXISTS repo_pull_requests (
            repo_name_with_owner TEXT NOT NULL,
            pr_number INTEGER NOT NULL,
            title TEXT NOT NULL,
            state TEXT NOT NULL,
            author_login TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            url TEXT NOT NULL,
            head_sha TEXT NOT NULL,
            base_sha TEXT,
            cached_at INTEGER NOT NULL,
            last_seen_at INTEGER NOT NULL,
            PRIMARY KEY (repo_name_with_owner, pr_number)
        );

        CREATE INDEX IF NOT EXISTS idx_repo_pull_requests_repo_updated
            ON repo_pull_requests (repo_name_with_owner, updated_at DESC);

        CREATE TABLE IF NOT EXISTS pr_patch_cache (
            repo_name_with_owner TEXT NOT NULL,
            pr_number INTEGER NOT NULL,
            head_sha TEXT NOT NULL,
            patch_text TEXT NOT NULL,
            cached_at INTEGER NOT NULL,
            last_accessed_at INTEGER NOT NULL,
            PRIMARY KEY (repo_name_with_owner, pr_number, head_sha)
        );

        CREATE TABLE IF NOT EXISTS pr_changed_files_cache (
            repo_name_with_owner TEXT NOT NULL,
            pr_number INTEGER NOT NULL,
            head_sha TEXT NOT NULL,
            files_json TEXT NOT NULL,
            cached_at INTEGER NOT NULL,
            last_accessed_at INTEGER NOT NULL,
            PRIMARY KEY (repo_name_with_owner, pr_number, head_sha)
        );
        ",
    )
    .map_err(|error| format!("Failed to initialize cache schema: {error}"))?;

    Ok(())
}

fn fetch_pull_requests_from_github(repo: &str) -> Result<Vec<PullRequestSummary>, String> {
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
        "number,title,state,author,updatedAt,url,headRefOid,baseRefOid",
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
            head_sha: pull_request.head_ref_oid,
            base_sha: pull_request.base_ref_oid,
        })
        .collect())
}

fn read_cached_pull_requests(repo: &str) -> Result<Vec<PullRequestSummary>, String> {
    let conn = open_cache_connection()?;
    let mut statement = conn
        .prepare(
            "
            SELECT
                pr_number,
                title,
                state,
                author_login,
                updated_at,
                url,
                head_sha,
                base_sha
            FROM repo_pull_requests
            WHERE repo_name_with_owner = ?1
            ORDER BY updated_at DESC
            ",
        )
        .map_err(|error| format!("Failed to prepare cached pull requests query: {error}"))?;

    let rows = statement
        .query_map(params![repo], |row| {
            Ok(PullRequestSummary {
                number: row.get(0)?,
                title: row.get(1)?,
                state: row.get(2)?,
                author_login: row.get(3)?,
                updated_at: row.get(4)?,
                url: row.get(5)?,
                head_sha: row.get(6)?,
                base_sha: row.get(7)?,
            })
        })
        .map_err(|error| format!("Failed to read cached pull requests: {error}"))?;

    let mut results = Vec::new();
    for row in rows {
        results.push(row.map_err(|error| format!("Failed to parse cached pull request row: {error}"))?);
    }

    Ok(results)
}

fn write_pull_requests_cache(repo: &str, pull_requests: &[PullRequestSummary]) -> Result<(), String> {
    let mut conn = open_cache_connection()?;
    let tx = conn
        .transaction()
        .map_err(|error| format!("Failed to start pull request cache transaction: {error}"))?;

    tx.execute(
        "DELETE FROM repo_pull_requests WHERE repo_name_with_owner = ?1",
        params![repo],
    )
    .map_err(|error| format!("Failed to clear cached pull requests: {error}"))?;

    let timestamp = now_unix_timestamp();

    for pull_request in pull_requests {
        tx.execute(
            "
            INSERT INTO repo_pull_requests (
                repo_name_with_owner,
                pr_number,
                title,
                state,
                author_login,
                updated_at,
                url,
                head_sha,
                base_sha,
                cached_at,
                last_seen_at
            )
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?10)
            ",
            params![
                repo,
                pull_request.number,
                pull_request.title,
                pull_request.state,
                pull_request.author_login,
                pull_request.updated_at,
                pull_request.url,
                pull_request.head_sha,
                pull_request.base_sha,
                timestamp,
            ],
        )
        .map_err(|error| format!("Failed to cache pull request {}: {error}", pull_request.number))?;
    }

    tx.commit()
        .map_err(|error| format!("Failed to commit pull request cache transaction: {error}"))
}

fn get_cached_patch(repo: &str, number: u32, head_sha: &str) -> Result<Option<String>, String> {
    let conn = open_cache_connection()?;
    let patch = conn
        .query_row(
            "
            SELECT patch_text
            FROM pr_patch_cache
            WHERE repo_name_with_owner = ?1
              AND pr_number = ?2
              AND head_sha = ?3
            ",
            params![repo, number, head_sha],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(|error| format!("Failed to query cached patch: {error}"))?;

    if patch.is_some() {
        conn.execute(
            "
            UPDATE pr_patch_cache
            SET last_accessed_at = ?4
            WHERE repo_name_with_owner = ?1
              AND pr_number = ?2
              AND head_sha = ?3
            ",
            params![repo, number, head_sha, now_unix_timestamp()],
        )
        .map_err(|error| format!("Failed to update patch cache access time: {error}"))?;
    }

    Ok(patch)
}

fn store_patch(repo: &str, number: u32, head_sha: &str, patch: &str) -> Result<(), String> {
    let conn = open_cache_connection()?;
    let timestamp = now_unix_timestamp();
    conn.execute(
        "
        INSERT INTO pr_patch_cache (
            repo_name_with_owner,
            pr_number,
            head_sha,
            patch_text,
            cached_at,
            last_accessed_at
        )
        VALUES (?1, ?2, ?3, ?4, ?5, ?5)
        ON CONFLICT(repo_name_with_owner, pr_number, head_sha)
        DO UPDATE SET
            patch_text = excluded.patch_text,
            cached_at = excluded.cached_at,
            last_accessed_at = excluded.last_accessed_at
        ",
        params![repo, number, head_sha, patch, timestamp],
    )
    .map_err(|error| format!("Failed to persist patch cache: {error}"))?;

    Ok(())
}

fn get_cached_changed_files(
    repo: &str,
    number: u32,
    head_sha: &str,
) -> Result<Option<Vec<String>>, String> {
    let conn = open_cache_connection()?;
    let files_json = conn
        .query_row(
            "
            SELECT files_json
            FROM pr_changed_files_cache
            WHERE repo_name_with_owner = ?1
              AND pr_number = ?2
              AND head_sha = ?3
            ",
            params![repo, number, head_sha],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(|error| format!("Failed to query cached changed files: {error}"))?;

    let Some(files_json) = files_json else {
        return Ok(None);
    };

    conn.execute(
        "
        UPDATE pr_changed_files_cache
        SET last_accessed_at = ?4
        WHERE repo_name_with_owner = ?1
          AND pr_number = ?2
          AND head_sha = ?3
        ",
        params![repo, number, head_sha, now_unix_timestamp()],
    )
    .map_err(|error| format!("Failed to update changed files cache access time: {error}"))?;

    let files = serde_json::from_str::<Vec<String>>(&files_json)
        .map_err(|error| format!("Failed to parse cached changed files: {error}"))?;

    Ok(Some(files))
}

fn store_changed_files(
    repo: &str,
    number: u32,
    head_sha: &str,
    files: &[String],
) -> Result<(), String> {
    let conn = open_cache_connection()?;
    let files_json = serde_json::to_string(files)
        .map_err(|error| format!("Failed to serialize changed files for cache: {error}"))?;
    let timestamp = now_unix_timestamp();

    conn.execute(
        "
        INSERT INTO pr_changed_files_cache (
            repo_name_with_owner,
            pr_number,
            head_sha,
            files_json,
            cached_at,
            last_accessed_at
        )
        VALUES (?1, ?2, ?3, ?4, ?5, ?5)
        ON CONFLICT(repo_name_with_owner, pr_number, head_sha)
        DO UPDATE SET
            files_json = excluded.files_json,
            cached_at = excluded.cached_at,
            last_accessed_at = excluded.last_accessed_at
        ",
        params![repo, number, head_sha, files_json, timestamp],
    )
    .map_err(|error| format!("Failed to persist changed files cache: {error}"))?;

    Ok(())
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
fn list_saved_repos() -> Result<Vec<RepoSummary>, String> {
    let conn = open_cache_connection()?;
    let mut statement = conn
        .prepare(
            "
            SELECT name, name_with_owner, description, is_private
            FROM repos
            ORDER BY added_at ASC
            ",
        )
        .map_err(|error| format!("Failed to prepare saved repos query: {error}"))?;

    let rows = statement
        .query_map([], |row| {
            Ok(RepoSummary {
                name: row.get(0)?,
                name_with_owner: row.get(1)?,
                description: row.get(2)?,
                is_private: sql_to_bool(row.get(3)?),
            })
        })
        .map_err(|error| format!("Failed to load saved repos: {error}"))?;

    let mut repos = Vec::new();
    for row in rows {
        repos.push(row.map_err(|error| format!("Failed to parse saved repo row: {error}"))?);
    }

    Ok(repos)
}

#[tauri::command]
fn save_repo(repo: RepoSummary) -> Result<RepoSummary, String> {
    let conn = open_cache_connection()?;
    let timestamp = now_unix_timestamp();

    conn.execute(
        "
        INSERT INTO repos (
            name,
            name_with_owner,
            description,
            is_private,
            added_at,
            last_opened_at
        )
        VALUES (?1, ?2, ?3, ?4, ?5, ?5)
        ON CONFLICT(name_with_owner)
        DO UPDATE SET
            name = excluded.name,
            description = excluded.description,
            is_private = excluded.is_private
        ",
        params![
            &repo.name,
            &repo.name_with_owner,
            &repo.description,
            bool_to_sql(repo.is_private),
            timestamp,
        ],
    )
    .map_err(|error| format!("Failed to save repo {}: {error}", repo.name_with_owner))?;

    Ok(repo)
}

#[tauri::command]
fn list_cached_pull_requests(repo: String) -> Result<Vec<PullRequestSummary>, String> {
    let repo = repo.trim();
    if repo.is_empty() {
        return Err("Repo is required".into());
    }

    read_cached_pull_requests(repo)
}

fn refresh_pull_requests_sync(repo: String) -> Result<Vec<PullRequestSummary>, String> {
    let repo = repo.trim();
    if repo.is_empty() {
        return Err("Repo is required".into());
    }

    let pull_requests = fetch_pull_requests_from_github(repo)?;
    write_pull_requests_cache(repo, &pull_requests)?;

    let conn = open_cache_connection()?;
    conn.execute(
        "
        UPDATE repos
        SET last_opened_at = ?2
        WHERE name_with_owner = ?1
        ",
        params![repo, now_unix_timestamp()],
    )
    .map_err(|error| format!("Failed to update repo access timestamp: {error}"))?;

    Ok(pull_requests)
}

#[tauri::command]
async fn list_pull_requests(repo: String) -> Result<Vec<PullRequestSummary>, String> {
    let repo = repo.trim().to_string();
    run_blocking_task(move || refresh_pull_requests_sync(repo)).await
}

fn get_pull_request_patch_sync(repo: String, number: u32, head_sha: String) -> Result<PrPatch, String> {
    let repo = repo.trim();
    let head_sha = head_sha.trim();

    if head_sha.is_empty() {
        return Err("Head SHA is required for patch lookup".into());
    }

    if let Some(cached_patch) = get_cached_patch(repo, number, head_sha)? {
        return Ok(PrPatch {
            repo: repo.into(),
            number,
            head_sha: head_sha.into(),
            patch: cached_patch,
        });
    }

    let patch = run_gh(&[
        "pr",
        "diff",
        &number.to_string(),
        "-R",
        repo,
        "--color",
        "never",
    ])?;

    store_patch(repo, number, head_sha, &patch)?;

    Ok(PrPatch {
        repo: repo.into(),
        number,
        head_sha: head_sha.into(),
        patch,
    })
}

#[tauri::command]
async fn get_pull_request_patch(repo: String, number: u32, head_sha: String) -> Result<PrPatch, String> {
    let repo = repo.trim().to_string();
    let head_sha = head_sha.trim().to_string();
    run_blocking_task(move || get_pull_request_patch_sync(repo, number, head_sha)).await
}

fn list_pull_request_changed_files_sync(
    repo: String,
    number: u32,
    head_sha: String,
) -> Result<Vec<String>, String> {
    let repo = repo.trim();
    let head_sha = head_sha.trim();

    if head_sha.is_empty() {
        return Err("Head SHA is required for changed files lookup".into());
    }

    if let Some(files) = get_cached_changed_files(repo, number, head_sha)? {
        return Ok(files);
    }

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

    store_changed_files(repo, number, head_sha, &files)?;

    Ok(files)
}

#[tauri::command]
async fn list_pull_request_changed_files(
    repo: String,
    number: u32,
    head_sha: String,
) -> Result<Vec<String>, String> {
    let repo = repo.trim().to_string();
    let head_sha = head_sha.trim().to_string();
    run_blocking_task(move || list_pull_request_changed_files_sync(repo, number, head_sha)).await
}

fn get_pull_request_review_threads_sync(
    repo: String,
    number: u32,
) -> Result<Vec<ReviewThread>, String> {
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
              authorAssociation
              author {
                login
                avatarUrl(size: 64)
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
            let GraphQlReviewThread {
                id,
                is_resolved,
                is_outdated,
                comments,
            } = thread;
            let nodes = comments.nodes;

            let anchor_comment = nodes
                .iter()
                .find(|comment| comment.reply_to.is_none())
                .or_else(|| nodes.first())?;

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

            let comments = nodes
                .into_iter()
                .map(|comment| {
                    let GraphQlReviewComment {
                        id,
                        database_id,
                        body,
                        created_at,
                        updated_at,
                        url,
                        path: _,
                        author,
                        author_association,
                        reply_to,
                    } = comment;

                    ReviewComment {
                        id,
                        database_id,
                        author_login: author
                            .as_ref()
                            .map(|author| author.login.clone())
                            .unwrap_or_else(|| "unknown".into()),
                        author_avatar_url: author.and_then(|author| author.avatar_url),
                        author_association,
                        body,
                        created_at,
                        updated_at,
                        url,
                        reply_to_id: reply_to.map(|reply_to| reply_to.id),
                    }
                })
                .collect::<Vec<_>>();

            Some(ReviewThread {
                id,
                path: anchor_path,
                is_resolved,
                is_outdated,
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

#[tauri::command]
async fn get_pull_request_review_threads(
    repo: String,
    number: u32,
) -> Result<Vec<ReviewThread>, String> {
    let repo = repo.trim().to_string();
    run_blocking_task(move || get_pull_request_review_threads_sync(repo, number)).await
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
            list_saved_repos,
            save_repo,
            list_cached_pull_requests,
            list_pull_requests,
            get_pull_request_patch,
            list_pull_request_changed_files,
            get_pull_request_review_threads
        ])
        .setup(|app| {
            let cache_db_path = match app.path().resolve("cache.sqlite", BaseDirectory::AppData) {
                Ok(path) => path,
                Err(error) => {
                    return Err(std::io::Error::new(
                        std::io::ErrorKind::Other,
                        format!("Failed to resolve cache database path: {error}"),
                    )
                    .into())
                }
            };

            if CACHE_DB_PATH.set(cache_db_path.clone()).is_err() {
                return Err(std::io::Error::new(
                    std::io::ErrorKind::Other,
                    "Cache database path was already initialized",
                )
                .into());
            }

            if let Err(error) = initialize_cache_database(&cache_db_path) {
                return Err(std::io::Error::new(std::io::ErrorKind::Other, error).into());
            }

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
