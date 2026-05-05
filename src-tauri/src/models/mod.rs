use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize, Clone, Copy)]
#[serde(rename_all = "snake_case")]
pub enum GhCliStatusKind {
    Ready,
    MissingCli,
    NotAuthenticated,
    UnknownError,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct GhCliStatus {
    pub status: GhCliStatusKind,
    pub message: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct RepoSummary {
    pub name: String,
    pub name_with_owner: String,
    pub description: Option<String>,
    pub is_private: Option<bool>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PullRequestSummary {
    #[serde(flatten)]
    pub core: PullRequestCore,
    pub is_draft: bool,
    pub merge_state_status: String,
    pub mergeable: String,
    pub additions: u32,
    pub deletions: u32,
    pub author_login: String,
    pub head_sha: String,
    pub base_sha: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PullRequestCore {
    pub number: u32,
    pub title: String,
    pub state: String,
    pub updated_at: String,
    pub url: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GhPullRequest {
    #[serde(flatten)]
    pub core: PullRequestCore,
    pub is_draft: bool,
    pub merge_state_status: Option<String>,
    pub mergeable: Option<String>,
    pub additions: Option<u32>,
    pub deletions: Option<u32>,
    pub author: Option<GhActor>,
    pub head_ref_oid: String,
    pub base_ref_oid: Option<String>,
    pub merged_at: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GhActor {
    pub login: String,
    pub avatar_url: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PrPatch {
    pub repo: String,
    pub number: u32,
    pub head_sha: String,
    pub patch: String,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PullRequestDiffBundle {
    pub repo: String,
    pub number: u32,
    pub head_sha: String,
    pub patch: String,
    pub changed_files: Vec<String>,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PullRequestOverview {
    pub repo: String,
    pub number: u32,
    pub title: String,
    pub body: String,
    pub state: String,
    pub is_draft: bool,
    pub url: String,
    pub updated_at: String,
    pub author_login: String,
    pub author_avatar_url: Option<String>,
}

#[derive(Debug, Serialize, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum PullRequestCheckStatus {
    Pass,
    Fail,
    Pending,
    Skipped,
    Cancelled,
    Neutral,
    Unknown,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PullRequestCheck {
    pub order: u32,
    pub title: String,
    pub status: PullRequestCheckStatus,
    pub logo_url: Option<String>,
    pub started_at: Option<String>,
    pub completed_at: Option<String>,
    pub created_at: Option<String>,
    pub is_terminal: bool,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PullRequestChecks {
    pub repo: String,
    pub number: u32,
    pub status: PullRequestCheckStatus,
    pub checks: Vec<PullRequestCheck>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReviewComment {
    pub id: String,
    pub database_id: Option<i64>,
    pub author_login: String,
    pub author_avatar_url: Option<String>,
    pub author_association: Option<String>,
    pub body: String,
    pub created_at: String,
    pub updated_at: String,
    pub url: String,
    pub reply_to_id: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReviewThread {
    pub id: String,
    pub path: String,
    pub is_resolved: bool,
    pub is_outdated: bool,
    pub line: Option<u32>,
    pub start_line: Option<u32>,
    pub side: Option<String>,
    pub start_side: Option<String>,
    pub subject_type: Option<String>,
    pub comments: Vec<ReviewComment>,
}

#[derive(Debug, Deserialize)]
pub struct GraphQlResponse<T> {
    pub data: Option<T>,
    pub errors: Option<Vec<GraphQlError>>,
}

#[derive(Debug, Deserialize)]
pub struct GraphQlError {
    pub message: String,
}

#[derive(Debug, Deserialize)]
pub struct ReviewThreadsQueryData {
    pub repository: Option<ReviewThreadsRepository>,
}

#[derive(Debug, Deserialize)]
pub struct PullRequestNodeIdQueryData {
    pub repository: Option<PullRequestNodeIdRepository>,
}

#[derive(Debug, Deserialize)]
pub struct PullRequestOverviewQueryData {
    pub repository: Option<PullRequestOverviewRepository>,
}

#[derive(Debug, Deserialize)]
pub struct PullRequestOverviewRepository {
    #[serde(rename = "pullRequest")]
    pub pull_request: Option<GraphQlPullRequestOverview>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphQlPullRequestOverview {
    pub number: u32,
    pub title: String,
    pub body: String,
    pub state: String,
    pub is_draft: bool,
    pub url: String,
    pub updated_at: String,
    pub author: Option<GhActor>,
}

#[derive(Debug, Deserialize)]
pub struct PullRequestChecksQueryData {
    pub repository: Option<PullRequestChecksRepository>,
}

#[derive(Debug, Deserialize)]
pub struct PullRequestChecksRepository {
    #[serde(rename = "pullRequest")]
    pub pull_request: Option<GraphQlPullRequestChecks>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphQlPullRequestChecks {
    pub status_check_rollup: Option<GraphQlStatusCheckRollup>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphQlStatusCheckRollup {
    pub state: Option<String>,
    pub contexts: GraphQlStatusCheckContextConnection,
}

#[derive(Debug, Deserialize)]
pub struct GraphQlStatusCheckContextConnection {
    #[serde(default)]
    pub nodes: Vec<GraphQlStatusCheckContext>,
}

#[derive(Debug, Deserialize)]
#[serde(tag = "__typename")]
pub enum GraphQlStatusCheckContext {
    #[serde(rename = "CheckRun")]
    CheckRun {
        name: String,
        status: Option<String>,
        conclusion: Option<String>,
        #[serde(rename = "startedAt")]
        started_at: Option<String>,
        #[serde(rename = "completedAt")]
        completed_at: Option<String>,
        #[serde(rename = "checkSuite")]
        check_suite: Option<GraphQlCheckSuite>,
    },
    #[serde(rename = "StatusContext")]
    StatusContext {
        context: String,
        state: Option<String>,
        #[serde(rename = "avatarUrl")]
        avatar_url: Option<String>,
        #[serde(rename = "createdAt")]
        created_at: Option<String>,
    },
    #[serde(other)]
    Unknown,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphQlCheckSuite {
    pub app: Option<GraphQlCheckApp>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphQlCheckApp {
    pub logo_url: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct PullRequestNodeIdRepository {
    #[serde(rename = "pullRequest")]
    pub pull_request: Option<PullRequestNodeIdPullRequest>,
}

#[derive(Debug, Deserialize)]
pub struct PullRequestNodeIdPullRequest {
    pub id: String,
}

#[derive(Debug, Deserialize)]
pub struct ReviewThreadsRepository {
    #[serde(rename = "pullRequest")]
    pub pull_request: Option<ReviewThreadsPullRequest>,
}

#[derive(Debug, Deserialize)]
pub struct ReviewThreadsPullRequest {
    #[serde(rename = "reviewThreads")]
    pub review_threads: ReviewThreadsConnection,
}

#[derive(Debug, Deserialize)]
pub struct ReviewThreadsConnection {
    #[serde(default)]
    pub nodes: Vec<GraphQlReviewThread>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphQlReviewThread {
    pub id: String,
    pub path: String,
    pub is_resolved: bool,
    pub is_outdated: bool,
    pub line: Option<u32>,
    pub original_line: Option<u32>,
    pub start_line: Option<u32>,
    pub original_start_line: Option<u32>,
    pub diff_side: String,
    pub start_diff_side: Option<String>,
    pub subject_type: String,
    pub comments: GraphQlReviewCommentsConnection,
}

#[derive(Debug, Deserialize)]
pub struct GraphQlReviewCommentsConnection {
    #[serde(default)]
    pub nodes: Vec<GraphQlReviewComment>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphQlReviewComment {
    pub id: String,
    pub database_id: Option<i64>,
    pub body: String,
    pub created_at: String,
    pub updated_at: String,
    pub url: String,
    pub author: Option<GhActor>,
    pub author_association: Option<String>,
    pub reply_to: Option<GraphQlReplyTo>,
}

#[derive(Debug, Deserialize)]
pub struct GraphQlReplyTo {
    pub id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GhSearchRepo {
    pub name: String,
    pub full_name: String,
    pub description: Option<String>,
    pub is_private: Option<bool>,
}
