use crate::github::get_viewer_login_sync;
use crate::models::ReviewThread;
use crate::services::review_graphql::{
    CreatePullRequestReviewCommentInput, GhGraphqlTransport, ReviewGraphqlClient,
    ReviewThreadService,
};

async fn run_blocking_task<T, F>(task: F) -> Result<T, String>
where
    T: Send + 'static,
    F: FnOnce() -> Result<T, String> + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(task)
        .await
        .map_err(|error| format!("Blocking task failed: {error}"))?
}

fn create_pull_request_review_comment_sync(
    repo: String,
    number: u32,
    body: String,
    path: String,
    line: Option<u32>,
    side: Option<String>,
    start_line: Option<u32>,
    start_side: Option<String>,
    subject_type: Option<String>,
) -> Result<(), String> {
    let repo = repo.trim();
    let body = body.trim();
    let path = path.trim();

    if body.is_empty() {
        return Err("Comment body is required".into());
    }
    if path.is_empty() {
        return Err("File path is required".into());
    }

    let subject_type = subject_type.unwrap_or_else(|| "line".to_string());

    if subject_type == "line" && line.is_none() {
        return Err("Line comments require a target line".into());
    }

    review_thread_service().create_thread_comment(
        repo,
        number,
        CreatePullRequestReviewCommentInput {
            body: body.to_string(),
            path: path.to_string(),
            line,
            side,
            start_line,
            start_side,
            subject_type,
        },
    )
}

#[tauri::command]
pub async fn create_pull_request_review_comment(
    repo: String,
    number: u32,
    body: String,
    path: String,
    line: Option<u32>,
    side: Option<String>,
    start_line: Option<u32>,
    start_side: Option<String>,
    subject_type: Option<String>,
) -> Result<(), String> {
    let repo = repo.trim().to_string();
    let body = body.to_string();
    let path = path.trim().to_string();
    run_blocking_task(move || {
        create_pull_request_review_comment_sync(
            repo,
            number,
            body,
            path,
            line,
            side,
            start_line,
            start_side,
            subject_type,
        )
    })
    .await
}

fn reply_to_pull_request_review_comment_sync(
    thread_id: String,
    body: String,
) -> Result<(), String> {
    let thread_id = thread_id.trim();
    let body = body.trim();
    if thread_id.is_empty() {
        return Err("Thread id is required".into());
    }
    if body.is_empty() {
        return Err("Reply body is required".into());
    }

    review_thread_service().reply_to_thread(thread_id, body)
}

#[tauri::command]
pub async fn reply_to_pull_request_review_comment(
    thread_id: String,
    body: String,
) -> Result<(), String> {
    let thread_id = thread_id.trim().to_string();
    let body = body.to_string();
    run_blocking_task(move || reply_to_pull_request_review_comment_sync(thread_id, body)).await
}

fn update_pull_request_review_comment_sync(comment_id: String, body: String) -> Result<(), String> {
    let comment_id = comment_id.trim();
    let body = body.trim();
    if comment_id.is_empty() {
        return Err("Comment id is required".into());
    }
    if body.is_empty() {
        return Err("Comment body is required".into());
    }

    review_thread_service().update_comment(comment_id, body)
}

#[tauri::command]
pub async fn update_pull_request_review_comment(
    comment_id: String,
    body: String,
) -> Result<(), String> {
    let comment_id = comment_id.trim().to_string();
    let body = body.to_string();
    run_blocking_task(move || update_pull_request_review_comment_sync(comment_id, body)).await
}

#[tauri::command]
pub async fn get_viewer_login() -> Result<String, String> {
    run_blocking_task(get_viewer_login_sync).await
}

fn get_pull_request_review_threads_sync(
    repo: String,
    number: u32,
) -> Result<Vec<ReviewThread>, String> {
    let repo = repo.trim();
    review_thread_service().list_review_threads(repo, number)
}

fn review_thread_service() -> ReviewThreadService<GhGraphqlTransport> {
    ReviewThreadService::new(ReviewGraphqlClient::new(GhGraphqlTransport))
}

#[tauri::command]
pub async fn get_pull_request_review_threads(
    repo: String,
    number: u32,
) -> Result<Vec<ReviewThread>, String> {
    let repo = repo.trim().to_string();
    run_blocking_task(move || get_pull_request_review_threads_sync(repo, number)).await
}
