use std::collections::{HashMap, HashSet};

use serde::Deserialize;

use crate::cache::{read_cached_pull_request_chapters, store_pull_request_chapters};
use crate::models::{
    ChapterKeyChange, ChapterPrologue, ChapterReviewFocus, ChapterReviewStep, LlmSettings,
    PullRequestChapter, PullRequestChapterFile, PullRequestChapters,
};
use crate::services::diff_data::{DiffDataRequest, DiffDataService, GhDiffSource, SqliteDiffCache};
use crate::services::llm::{complete_json, load_llm_settings, parse_json_response};
use crate::support::now_unix_timestamp;

pub const CHAPTER_PROMPT_VERSION: &str = "chapters-v1";

const MAX_PATCH_CHARS: usize = 120_000;
const MAX_CHAPTERS: usize = 8;

#[derive(Debug, Clone)]
struct FileStat {
    path: String,
    additions: u32,
    deletions: u32,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RawChapterResponse {
    prologue: Option<RawPrologue>,
    chapters: Option<Vec<RawChapter>>,
}

#[derive(Debug, Deserialize)]
#[serde(untagged)]
enum RawPrologue {
    Object(RawPrologueObject),
    Summary(String),
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RawPrologueObject {
    summary: Option<String>,
    #[serde(alias = "key_changes")]
    key_changes: Option<Vec<RawTextItem>>,
    #[serde(alias = "review_focus")]
    review_focus: Option<Vec<RawFocusItem>>,
}

#[derive(Debug, Deserialize)]
#[serde(untagged)]
enum RawTextItem {
    Object(RawTextItemObject),
    Text(String),
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RawTextItemObject {
    title: Option<String>,
    #[serde(alias = "description")]
    detail: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(untagged)]
enum RawFocusItem {
    Object(RawFocusItemObject),
    Text(String),
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RawFocusItemObject {
    title: Option<String>,
    #[serde(alias = "description")]
    detail: Option<String>,
    path: Option<String>,
    severity: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RawChapter {
    title: Option<String>,
    summary: Option<String>,
    files: Option<Vec<RawChapterFile>>,
    #[serde(alias = "review_steps")]
    review_steps: Option<Vec<RawReviewStep>>,
    risks: Option<Vec<RawFocusItem>>,
}

#[derive(Debug, Deserialize)]
#[serde(untagged)]
enum RawChapterFile {
    Object(RawChapterFileObject),
    Path(String),
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RawChapterFileObject {
    path: Option<String>,
    #[serde(alias = "detail")]
    reason: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(untagged)]
enum RawReviewStep {
    Object(RawReviewStepObject),
    Text(String),
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RawReviewStepObject {
    title: Option<String>,
    #[serde(alias = "description")]
    detail: Option<String>,
    files: Option<Vec<String>>,
}

fn normalize_path(path: &str) -> String {
    path.trim()
        .trim_start_matches("a/")
        .trim_start_matches("b/")
        .to_string()
}

fn trim_text(value: Option<String>) -> String {
    value.unwrap_or_default().trim().to_string()
}

fn parse_diff_path(line: &str) -> Option<String> {
    if !line.starts_with("diff --git ") {
        return None;
    }

    let mut parts = line.split_whitespace();
    parts.next()?;
    parts.next()?;
    let _left = parts.next()?;
    let right = parts.next()?;

    Some(normalize_path(right))
}

fn build_file_stats(changed_files: &[String], patch: &str) -> HashMap<String, FileStat> {
    let mut stats = HashMap::new();
    for path in changed_files {
        let normalized = normalize_path(path);
        stats.insert(
            normalized.clone(),
            FileStat {
                path: normalized,
                additions: 0,
                deletions: 0,
            },
        );
    }

    let mut current_path: Option<String> = None;
    for line in patch.lines() {
        if let Some(path) = parse_diff_path(line) {
            current_path = Some(path);
            continue;
        }

        let Some(path) = current_path.as_ref() else {
            continue;
        };
        let Some(stat) = stats.get_mut(path) else {
            continue;
        };

        if line.starts_with('+') && !line.starts_with("+++") {
            stat.additions = stat.additions.saturating_add(1);
        } else if line.starts_with('-') && !line.starts_with("---") {
            stat.deletions = stat.deletions.saturating_add(1);
        }
    }

    stats
}

fn clipped_patch(patch: &str) -> (String, bool) {
    if patch.len() <= MAX_PATCH_CHARS {
        return (patch.to_string(), false);
    }

    let mut end = MAX_PATCH_CHARS;
    while !patch.is_char_boundary(end) {
        end -= 1;
    }

    (patch[..end].to_string(), true)
}

fn system_prompt() -> &'static str {
    r#"You generate pull request review chapters for experienced engineers.
Return only strict JSON. Do not use markdown fences.
Group related files into reviewable chapters that reduce noise.
Every cited file path must come from the changed file list supplied by the user.
Prefer concrete review steps over generic advice.

Required JSON shape:
{
  "prologue": {
    "summary": "One concise paragraph explaining the story of the PR.",
    "keyChanges": [
      { "title": "Short change title", "detail": "Specific natural-language explanation." }
    ],
    "reviewFocus": [
      { "title": "Risk or review focus", "detail": "Why it matters.", "path": "optional/file/path", "severity": "low|medium|high" }
    ]
  },
  "chapters": [
    {
      "title": "Chapter title",
      "summary": "What changed and why this chapter should be reviewed together.",
      "files": [
        { "path": "changed/file/path", "reason": "Why this file belongs here." }
      ],
      "reviewSteps": [
        { "title": "Review step", "detail": "Specific action for the reviewer.", "files": ["changed/file/path"] }
      ],
      "risks": [
        { "title": "Risk", "detail": "What could break.", "path": "optional/file/path", "severity": "low|medium|high" }
      ]
    }
  ]
}"#
}

fn user_prompt(
    repo: &str,
    number: u32,
    head_sha: &str,
    file_stats: &HashMap<String, FileStat>,
    patch: &str,
) -> Result<String, String> {
    let mut files = file_stats.values().collect::<Vec<_>>();
    files.sort_by(|a, b| a.path.cmp(&b.path));

    let files_json = serde_json::to_string_pretty(
        &files
            .iter()
            .map(|stat| {
                serde_json::json!({
                    "path": &stat.path,
                    "additions": stat.additions,
                    "deletions": stat.deletions,
                })
            })
            .collect::<Vec<_>>(),
    )
    .map_err(|error| format!("Failed to serialize changed files for prompt: {error}"))?;

    let (patch, was_clipped) = clipped_patch(patch);
    let clipping_note = if was_clipped {
        "The patch was clipped for model context. Prefer chapter grouping from the changed file list when later hunks are absent."
    } else {
        "The full patch is included."
    };

    Ok(format!(
        r#"Repository: {repo}
Pull request: #{number}
Head SHA: {head_sha}
Prompt version: {CHAPTER_PROMPT_VERSION}
Patch note: {clipping_note}

Changed files with line stats:
{files_json}

Unified diff:
```diff
{patch}
```"#
    ))
}

fn known_path<'a>(
    path: Option<String>,
    file_stats: &'a HashMap<String, FileStat>,
) -> Option<&'a FileStat> {
    let path = path?;
    let path = normalize_path(&path);
    file_stats.get(&path)
}

fn known_path_string(path: String, known_paths: &HashSet<String>) -> Option<String> {
    let path = normalize_path(&path);
    if known_paths.contains(&path) {
        Some(path)
    } else {
        None
    }
}

fn normalize_focus_items(
    items: Option<Vec<RawFocusItem>>,
    file_stats: &HashMap<String, FileStat>,
) -> Vec<ChapterReviewFocus> {
    let known_paths = file_stats.keys().cloned().collect::<HashSet<_>>();

    items
        .unwrap_or_default()
        .into_iter()
        .filter_map(|item| {
            let (title, detail, path, severity) = match item {
                RawFocusItem::Object(item) => (
                    trim_text(item.title),
                    trim_text(item.detail),
                    item.path,
                    item.severity,
                ),
                RawFocusItem::Text(detail) => {
                    (String::new(), detail.trim().to_string(), None, None)
                }
            };
            if title.is_empty() && detail.is_empty() {
                return None;
            }

            Some(ChapterReviewFocus {
                title: if title.is_empty() {
                    "Review focus".into()
                } else {
                    title
                },
                detail,
                path: path.and_then(|path| known_path_string(path, &known_paths)),
                severity: severity
                    .map(|severity| severity.trim().to_ascii_lowercase())
                    .filter(|severity| matches!(severity.as_str(), "low" | "medium" | "high")),
            })
        })
        .take(6)
        .collect()
}

fn normalize_key_changes(items: Option<Vec<RawTextItem>>) -> Vec<ChapterKeyChange> {
    items
        .unwrap_or_default()
        .into_iter()
        .filter_map(|item| {
            let (title, detail) = match item {
                RawTextItem::Object(item) => (trim_text(item.title), trim_text(item.detail)),
                RawTextItem::Text(detail) => (String::new(), detail.trim().to_string()),
            };
            if title.is_empty() && detail.is_empty() {
                return None;
            }

            Some(ChapterKeyChange {
                title: if title.is_empty() {
                    "Change".into()
                } else {
                    title
                },
                detail,
            })
        })
        .take(6)
        .collect()
}

fn normalize_review_steps(
    steps: Option<Vec<RawReviewStep>>,
    known_paths: &HashSet<String>,
) -> Vec<ChapterReviewStep> {
    steps
        .unwrap_or_default()
        .into_iter()
        .filter_map(|step| {
            let (title, detail, files) = match step {
                RawReviewStep::Object(step) => (
                    trim_text(step.title),
                    trim_text(step.detail),
                    step.files.unwrap_or_default(),
                ),
                RawReviewStep::Text(detail) => {
                    (String::new(), detail.trim().to_string(), Vec::new())
                }
            };
            if title.is_empty() && detail.is_empty() {
                return None;
            }

            let files = files
                .into_iter()
                .filter_map(|path| known_path_string(path, known_paths))
                .collect::<Vec<_>>();

            Some(ChapterReviewStep {
                title: if title.is_empty() {
                    "Review step".into()
                } else {
                    title
                },
                detail,
                files,
            })
        })
        .take(6)
        .collect()
}

fn fallback_prologue(file_stats: &HashMap<String, FileStat>) -> ChapterPrologue {
    let additions = file_stats.values().map(|stat| stat.additions).sum::<u32>();
    let deletions = file_stats.values().map(|stat| stat.deletions).sum::<u32>();

    ChapterPrologue {
        summary: format!(
            "This pull request changes {} files with +{} / -{} lines. Generate chapters to group the diff into a review sequence.",
            file_stats.len(),
            additions,
            deletions
        ),
        key_changes: vec![ChapterKeyChange {
            title: "Changed files collected".into(),
            detail: "Rudu loaded the PR patch and file list; no model-authored grouping was available.".into(),
        }],
        review_focus: Vec::new(),
    }
}

fn fallback_chapter(id: String, title: String, files: Vec<FileStat>) -> PullRequestChapter {
    let additions = files.iter().map(|stat| stat.additions).sum::<u32>();
    let deletions = files.iter().map(|stat| stat.deletions).sum::<u32>();

    PullRequestChapter {
        id,
        title,
        summary: "Review these changed files together because they were not assigned to a more specific chapter.".into(),
        files: files
            .into_iter()
            .map(|stat| PullRequestChapterFile {
                path: stat.path,
                reason: "Unassigned changed file.".into(),
                additions: stat.additions,
                deletions: stat.deletions,
            })
            .collect(),
        review_steps: vec![ChapterReviewStep {
            title: "Scan changed files".into(),
            detail: "Check the diff for intent, missing tests, and interactions with the rest of the PR.".into(),
            files: Vec::new(),
        }],
        risks: Vec::new(),
        additions,
        deletions,
    }
}

fn normalize_prologue(
    raw: Option<RawPrologue>,
    file_stats: &HashMap<String, FileStat>,
) -> ChapterPrologue {
    raw.map(|prologue| match prologue {
        RawPrologue::Object(prologue) => ChapterPrologue {
            summary: trim_text(prologue.summary),
            key_changes: normalize_key_changes(prologue.key_changes),
            review_focus: normalize_focus_items(prologue.review_focus, file_stats),
        },
        RawPrologue::Summary(summary) => ChapterPrologue {
            summary: summary.trim().to_string(),
            key_changes: Vec::new(),
            review_focus: Vec::new(),
        },
    })
    .filter(|prologue| {
        !prologue.summary.is_empty()
            || !prologue.key_changes.is_empty()
            || !prologue.review_focus.is_empty()
    })
    .unwrap_or_else(|| fallback_prologue(file_stats))
}

fn normalize_chapters(
    raw: RawChapterResponse,
    file_stats: &HashMap<String, FileStat>,
    repo: String,
    number: u32,
    head_sha: String,
    settings: &LlmSettings,
) -> PullRequestChapters {
    let prologue = normalize_prologue(raw.prologue, file_stats);

    let known_paths = file_stats.keys().cloned().collect::<HashSet<_>>();
    let mut assigned_paths = HashSet::new();
    let mut chapters = Vec::new();

    for raw_chapter in raw
        .chapters
        .unwrap_or_default()
        .into_iter()
        .take(MAX_CHAPTERS)
    {
        let mut chapter_files = Vec::new();
        let mut chapter_file_paths = HashSet::new();

        for raw_file in raw_chapter.files.unwrap_or_default() {
            let (path, reason) = match raw_file {
                RawChapterFile::Object(file) => (file.path, trim_text(file.reason)),
                RawChapterFile::Path(path) => (Some(path), String::new()),
            };

            let Some(stat) = known_path(path, file_stats) else {
                continue;
            };
            if !chapter_file_paths.insert(stat.path.clone()) {
                continue;
            }

            assigned_paths.insert(stat.path.clone());
            chapter_files.push(PullRequestChapterFile {
                path: stat.path.clone(),
                reason,
                additions: stat.additions,
                deletions: stat.deletions,
            });
        }

        if chapter_files.is_empty() {
            continue;
        }

        let additions = chapter_files.iter().map(|file| file.additions).sum::<u32>();
        let deletions = chapter_files.iter().map(|file| file.deletions).sum::<u32>();
        let title = trim_text(raw_chapter.title);
        let chapter_id = format!("chapter-{}", chapters.len() + 1);

        chapters.push(PullRequestChapter {
            id: chapter_id,
            title: if title.is_empty() {
                format!("Chapter {}", chapters.len() + 1)
            } else {
                title
            },
            summary: trim_text(raw_chapter.summary),
            files: chapter_files,
            review_steps: normalize_review_steps(raw_chapter.review_steps, &known_paths),
            risks: normalize_focus_items(raw_chapter.risks, file_stats),
            additions,
            deletions,
        });
    }

    let unassigned = file_stats
        .values()
        .filter(|stat| !assigned_paths.contains(&stat.path))
        .cloned()
        .collect::<Vec<_>>();

    if !unassigned.is_empty() {
        chapters.push(fallback_chapter(
            format!("chapter-{}", chapters.len() + 1),
            if chapters.is_empty() {
                "Review changed files".into()
            } else {
                "Other changes".into()
            },
            unassigned,
        ));
    }

    PullRequestChapters {
        repo,
        number,
        head_sha,
        provider: settings.provider.clone(),
        model: settings.model.clone(),
        prompt_version: CHAPTER_PROMPT_VERSION.into(),
        generated_at: now_unix_timestamp(),
        prologue,
        chapters,
    }
}

pub fn read_cached_chapters(
    repo: String,
    number: u32,
    head_sha: String,
) -> Result<Option<PullRequestChapters>, String> {
    let req = DiffDataRequest::new(repo, number, head_sha)?;
    read_cached_pull_request_chapters(&req.repo, req.number, &req.head_sha, CHAPTER_PROMPT_VERSION)
}

pub fn generate_chapters(
    repo: String,
    number: u32,
    head_sha: String,
) -> Result<PullRequestChapters, String> {
    let req = DiffDataRequest::new(repo, number, head_sha)?;
    let diff_service = DiffDataService::new(&GhDiffSource, &SqliteDiffCache);
    let patch = diff_service.get_patch(&req)?;
    let changed_files = diff_service.get_changed_files(&req)?;

    if changed_files.is_empty() {
        return Err("This pull request has no changed files to chapter.".into());
    }

    let file_stats = build_file_stats(&changed_files, &patch.patch);
    let settings = load_llm_settings()?;
    if !settings.has_api_key {
        return Err("Configure an LLM provider API key before summarizing with AI.".into());
    }

    let prompt = user_prompt(
        &req.repo,
        req.number,
        &req.head_sha,
        &file_stats,
        &patch.patch,
    )?;
    let response = complete_json(&settings, system_prompt(), &prompt, 5000)?;
    let value = parse_json_response(&response)?;
    let raw = serde_json::from_value::<RawChapterResponse>(value).map_err(|error| {
        format!("LLM chapter response did not match the expected shape: {error}")
    })?;

    let chapters = normalize_chapters(
        raw,
        &file_stats,
        req.repo,
        req.number,
        req.head_sha,
        &settings,
    );
    store_pull_request_chapters(&chapters)?;

    Ok(chapters)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn test_settings() -> LlmSettings {
        LlmSettings {
            provider: "openai".into(),
            model: "test-model".into(),
            base_url: None,
            has_api_key: true,
        }
    }

    fn test_file_stats() -> HashMap<String, FileStat> {
        let mut stats = HashMap::new();
        stats.insert(
            "src/lib.rs".into(),
            FileStat {
                path: "src/lib.rs".into(),
                additions: 12,
                deletions: 3,
            },
        );
        stats
    }

    #[test]
    fn normalizes_string_prologue_response() {
        let raw = serde_json::from_value::<RawChapterResponse>(json!({
            "prologue": "This PR introduces a multi-agent orchestration skill.",
            "chapters": [
                {
                    "title": "Review orchestration",
                    "summary": "Adds a workflow for reviewing large PRs.",
                    "files": ["src/lib.rs"],
                    "reviewSteps": ["Confirm generated review plans cite changed files."],
                    "risks": ["The workflow could group unrelated changes together."]
                }
            ]
        }))
        .expect("string prologue responses should parse");

        let chapters = normalize_chapters(
            raw,
            &test_file_stats(),
            "owner/repo".into(),
            42,
            "abc123".into(),
            &test_settings(),
        );

        assert_eq!(
            chapters.prologue.summary,
            "This PR introduces a multi-agent orchestration skill."
        );
        assert_eq!(chapters.chapters.len(), 1);
        assert_eq!(chapters.chapters[0].files[0].path, "src/lib.rs");
        assert_eq!(
            chapters.chapters[0].review_steps[0].detail,
            "Confirm generated review plans cite changed files."
        );
        assert_eq!(
            chapters.chapters[0].risks[0].detail,
            "The workflow could group unrelated changes together."
        );
    }
}
