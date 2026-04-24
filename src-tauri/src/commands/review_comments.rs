use crate::github::{get_pull_request_node_id_sync, get_viewer_login_sync, run_gh_graphql};
use crate::models::{
    GhActor, GraphQlResponse, GraphQlReviewComment, GraphQlReviewThread, ReviewComment,
    ReviewThread, ReviewThreadsQueryData,
};
use crate::support::parse_repo;

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
    let pull_request_id = get_pull_request_node_id_sync(repo, number)?;

    if subject_type == "line" && line.is_none() {
        return Err("Line comments require a target line".into());
    }

    let query = r#"
mutation(
  $pullRequestId: ID!,
  $body: String!,
  $path: String!,
  $line: Int,
  $side: DiffSide,
  $startLine: Int,
  $startSide: DiffSide,
  $subjectType: PullRequestReviewThreadSubjectType
) {
  addPullRequestReviewThread(
    input: {
      pullRequestId: $pullRequestId,
      body: $body,
      path: $path,
      line: $line,
      side: $side,
      startLine: $startLine,
      startSide: $startSide,
      subjectType: $subjectType
    }
  ) {
    thread {
      id
    }
  }
}
"#;

    let mut args = vec![
        "api".to_string(),
        "graphql".to_string(),
        "-f".to_string(),
        format!("pullRequestId={pull_request_id}"),
        "-f".to_string(),
        format!("body={body}"),
        "-f".to_string(),
        format!("path={path}"),
        "-f".to_string(),
        format!("subjectType={}", subject_type.to_uppercase()),
        "-f".to_string(),
        format!("query={query}"),
    ];

    if let Some(line) = line {
        args.push("-F".to_string());
        args.push(format!("line={line}"));
    }
    if let Some(side) = side.filter(|side| !side.trim().is_empty()) {
        args.push("-f".to_string());
        args.push(format!("side={side}"));
    }
    if let Some(start_line) = start_line {
        args.push("-F".to_string());
        args.push(format!("startLine={start_line}"));
    }
    if let Some(start_side) = start_side.filter(|side| !side.trim().is_empty()) {
        args.push("-f".to_string());
        args.push(format!("startSide={start_side}"));
    }

    run_gh_graphql(&args)?;
    Ok(())
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

    let query = r#"
mutation($threadId: ID!, $body: String!) {
  addPullRequestReviewThreadReply(
    input: {
      pullRequestReviewThreadId: $threadId,
      body: $body
    }
  ) {
    comment {
      id
    }
  }
}
"#;

    let args = vec![
        "api".to_string(),
        "graphql".to_string(),
        "-f".to_string(),
        format!("threadId={thread_id}"),
        "-f".to_string(),
        format!("body={body}"),
        "-f".to_string(),
        format!("query={query}"),
    ];

    run_gh_graphql(&args)?;
    Ok(())
}

#[tauri::command]
pub async fn reply_to_pull_request_review_comment(
    thread_id: String,
    body: String,
) -> Result<(), String> {
    let thread_id = thread_id.trim().to_string();
    let body = body.to_string();
    run_blocking_task(move || reply_to_pull_request_review_comment_sync(thread_id, body))
        .await
}

fn update_pull_request_review_comment_sync(
    comment_id: String,
    body: String,
) -> Result<(), String> {
    let comment_id = comment_id.trim();
    let body = body.trim();
    if comment_id.is_empty() {
        return Err("Comment id is required".into());
    }
    if body.is_empty() {
        return Err("Comment body is required".into());
    }

    let query = r#"
mutation($commentId: ID!, $body: String!) {
  updatePullRequestReviewComment(
    input: {
      pullRequestReviewCommentId: $commentId,
      body: $body
    }
  ) {
    pullRequestReviewComment {
      id
    }
  }
}
"#;

    let args = vec![
        "api".to_string(),
        "graphql".to_string(),
        "-f".to_string(),
        format!("commentId={comment_id}"),
        "-f".to_string(),
        format!("body={body}"),
        "-f".to_string(),
        format!("query={query}"),
    ];

    run_gh_graphql(&args)?;
    Ok(())
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
    let (owner, name) = parse_repo(repo)?;
    let query = r#"
query($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      reviewThreads(first: 100) {
        nodes {
          id
          path
          isResolved
          isOutdated
          line
          originalLine
          startLine
          originalStartLine
          diffSide
          startDiffSide
          subjectType
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

    let review_threads = review_thread_nodes
        .into_iter()
        .filter_map(|thread| {
            let GraphQlReviewThread {
                id,
                path,
                is_resolved,
                is_outdated,
                line,
                original_line,
                start_line,
                original_start_line,
                diff_side,
                start_diff_side,
                subject_type,
                comments,
            } = thread;
            let nodes = comments.nodes;
            if nodes.is_empty() {
                return None;
            }

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
                path,
                is_resolved,
                is_outdated,
                line: line.or(original_line),
                start_line: start_line.or(original_start_line),
                side: Some(diff_side),
                start_side: start_diff_side,
                subject_type: Some(subject_type.to_ascii_lowercase()),
                comments,
            })
        })
        .collect();

    Ok(review_threads)
}

#[tauri::command]
pub async fn get_pull_request_review_threads(
    repo: String,
    number: u32,
) -> Result<Vec<ReviewThread>, String> {
    let repo = repo.trim().to_string();
    run_blocking_task(move || get_pull_request_review_threads_sync(repo, number)).await
}