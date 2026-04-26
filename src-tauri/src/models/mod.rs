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

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct LlmProviderInfo {
    pub id: String,
    pub name: String,
    pub adapter: String,
    pub default_model: String,
    pub default_base_url: Option<String>,
    pub base_url_required: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct LlmSettings {
    pub provider: String,
    pub model: String,
    pub base_url: Option<String>,
    pub has_api_key: bool,
}

#[derive(Debug, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SaveLlmSettingsInput {
    pub provider: String,
    pub model: String,
    pub base_url: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ChapterKeyChange {
    pub title: String,
    pub detail: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ChapterReviewFocus {
    pub title: String,
    pub detail: String,
    pub path: Option<String>,
    pub severity: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ChapterPrologue {
    pub summary: String,
    pub key_changes: Vec<ChapterKeyChange>,
    pub review_focus: Vec<ChapterReviewFocus>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PullRequestChapterFile {
    pub path: String,
    pub reason: String,
    pub additions: u32,
    pub deletions: u32,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ChapterReviewStep {
    pub title: String,
    pub detail: String,
    pub files: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PullRequestChapter {
    pub id: String,
    pub title: String,
    pub summary: String,
    pub files: Vec<PullRequestChapterFile>,
    pub review_steps: Vec<ChapterReviewStep>,
    pub risks: Vec<ChapterReviewFocus>,
    pub additions: u32,
    pub deletions: u32,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PullRequestChapters {
    pub repo: String,
    pub number: u32,
    pub head_sha: String,
    pub provider: String,
    pub model: String,
    pub prompt_version: String,
    pub generated_at: i64,
    pub prologue: ChapterPrologue,
    pub chapters: Vec<PullRequestChapter>,
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
    pub path: String,
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
