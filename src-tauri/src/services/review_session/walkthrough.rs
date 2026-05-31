use std::fs;
use std::path::{Path, PathBuf};
use std::{collections::HashSet, fmt::Write as _};

use crate::models::{
    PullRequestOverview, ReviewSession, ReviewWalkthrough, ReviewWalkthroughAction,
    ReviewWalkthroughFile, ReviewWalkthroughGroup, ReviewWalkthroughScope,
};
use crate::services::diff_data::{DiffDataRequest, DiffDataService, GhDiffSource, SqliteDiffCache};
use crate::services::pull_request_details::PullRequestDetailsService;
use crate::services::review_graphql::GhGraphqlTransport;

use super::{emit_walkthrough_progress, ensure_session_indexed, ReviewWalkthroughEvent};

const MAX_PATCH_CHARS: usize = 120_000;
const MAX_PR_BODY_CHARS: usize = 8_000;

struct WalkthroughPrompt {
    changed_files: Vec<String>,
    prompt: String,
}

const ARCHITECTURE_REVIEW_GUIDE: &str = r#"Architecture review guide:
- Module: anything with an interface and implementation.
- Interface: everything callers must know, including types, invariants, ordering, error modes, config, and performance.
- Seam: where an interface lives; a place behavior can change without editing callers.
- Adapter: concrete implementation at a seam.
- Depth: leverage at an interface; deep modules hide meaningful behavior behind a smaller interface.
- Leverage: what callers get when one implementation pays back across many call sites and tests.
- Locality: bugs, changes, and verification concentrate in one place instead of spreading across callers.
- Deletion test: if deleting a module only moves complexity to many callers, it was earning its keep.
- The interface is the test surface: tests that explain an interface or shared contract may be high-leverage review entry points.
"#;

pub(super) fn generate<F>(
    root: &Path,
    session_id: String,
    emit_event: F,
) -> Result<ReviewWalkthrough, String>
where
    F: Fn(ReviewWalkthroughEvent),
{
    super::session::validate_session_id(&session_id)?;
    let session = super::session::read_by_id(root, &session_id)?;
    ensure_session_indexed(
        &session,
        "Prepare this review workspace before generating a walkthrough.",
    )?;
    emit_walkthrough_progress(
        &session.id,
        &emit_event,
        "preparing",
        "Preparing review context",
    );

    let workspace_dir = PathBuf::from(session.workspace_path.as_str());
    let repo_dir = workspace_dir.join("repo");
    let rudu_dir = workspace_dir.join(".rudu");
    fs::create_dir_all(&rudu_dir)
        .map_err(|error| format!("Failed to prepare walkthrough metadata directory: {error}"))?;

    let prompt = walkthrough_prompt(&session)?;
    emit_walkthrough_progress(
        &session.id,
        &emit_event,
        "running",
        super::walkthrough_generator::running_message(session.review_runtime),
    );
    let walkthrough = super::walkthrough_generator::run(
        super::walkthrough_generator::WalkthroughGeneratorRequest {
            session: &session,
            repo_dir: &repo_dir,
            rudu_dir: &rudu_dir,
            prompt: &prompt.prompt,
        },
    )?;

    emit_walkthrough_progress(
        &session.id,
        &emit_event,
        "formatting",
        "Formatting walkthrough",
    );
    let walkthrough = normalize_walkthrough_files(walkthrough, &prompt.changed_files, &session)?;

    Ok(walkthrough)
}

fn walkthrough_prompt(session: &ReviewSession) -> Result<WalkthroughPrompt, String> {
    let diff_request = DiffDataRequest::new(
        session.repo.clone(),
        session.number,
        session.head_sha.clone(),
    )?;
    let diff_bundle =
        DiffDataService::new(&GhDiffSource, &SqliteDiffCache).get_diff_bundle(&diff_request)?;
    let overview = PullRequestDetailsService::new(GhGraphqlTransport)
        .get_overview(&session.repo, session.number);

    let mut prompt = String::new();
    prompt.push_str("You are generating a Rudu Review Walkthrough.\n\n");
    prompt.push_str("Return only JSON matching the walkthrough output contract.\n");
    prompt.push_str("This is a high-leverage review order, not review findings.\n");
    prompt.push_str("Help a human reviewer spend attention where architectural judgment matters and avoid blocking on low-value churn.\n");
    prompt.push_str("You may inspect this read-only workspace to understand how the changed files fit the codebase.\n");
    prompt.push_str(
        "Do not edit files, run tests, build, install dependencies, or mutate git state.\n\n",
    );
    prompt.push_str("Use every changed path exactly once.\n");
    prompt.push_str("Order files from highest review leverage to lowest.\n");
    prompt.push_str("Rank by reviewability, not file type. A test may come before implementation when it is the clearest behavioral contract or usage example.\n\n");
    prompt.push_str("High leverage: architecture seams, public interfaces, exported types, schemas, Tauri commands, IPC, routing, persistence, auth/security, shared state, cross-cutting helpers, runtime/build behavior, files affecting multiple call sites, and tests that define important behavior.\n");
    prompt.push_str(
        "Medium leverage: local feature implementation, focused behavior changes, focused tests, and relevant config.\n",
    );
    prompt.push_str("Low leverage: leaf UI details, isolated fixtures, docs-only changes, generated files, snapshots, lockfiles, formatting-only or routine churn.\n\n");
    prompt.push_str("Group files by review strategy, not directory.\n");
    prompt.push_str("Use group titles like Review carefully, Trace the data flow, Verify behavior with tests, Scan local changes, or Low value / skim.\n");
    prompt.push_str(
        "Avoid generic titles like Frontend files, Tests, Miscellaneous, or Other changed files.\n\n",
    );
    prompt.push_str("For each file:\n");
    prompt.push_str("- reason: why this file belongs at this point, max 140 characters.\n");
    prompt.push_str("- context: what the reviewer should pay attention to, max 180 characters.\n");
    prompt.push_str("- action: review, scan, or skim.\n");
    prompt.push_str("- scope: shared, local, or routine.\n\n");
    prompt.push_str("Use scope=shared when the file affects shared behavior, public interfaces, contracts, persistence, routing, IPC, cross-cutting helpers, or multiple call sites.\n");
    prompt.push_str("Use scope=local when the change is mostly limited to one feature or focused behavior path.\n");
    prompt.push_str(
        "Use scope=routine when the reviewer can mostly skim it unless they own that area.\n",
    );
    prompt.push_str("Do not mark everything shared; a useful walkthrough separates shared, local, and routine work.\n");
    prompt.push_str("Do not invent bugs, produce review comments, say looks good, or nitpick syntax/naming/style unless it changes review leverage.\n\n");
    prompt.push_str(ARCHITECTURE_REVIEW_GUIDE);
    prompt.push_str("\nPull request:\n");
    let _ = writeln!(prompt, "Repository: {}", session.repo);
    let _ = writeln!(prompt, "Number: #{}", session.number);
    let _ = writeln!(prompt, "Head SHA: {}", session.head_sha);

    if let Ok(overview) = overview {
        append_overview(&mut prompt, &overview);
    }

    prompt.push_str("\nChanged files:\n");
    for file in &diff_bundle.changed_files {
        prompt.push_str("- ");
        prompt.push_str(file);
        prompt.push('\n');
    }

    prompt.push_str("\nPatch excerpt:\n");
    prompt.push_str(&clip_text(&diff_bundle.patch, MAX_PATCH_CHARS));
    if diff_bundle.patch.len() > MAX_PATCH_CHARS {
        prompt.push_str("\n\n[Patch clipped. Inspect files in the workspace when needed.]\n");
    }

    Ok(WalkthroughPrompt {
        changed_files: diff_bundle.changed_files,
        prompt,
    })
}

fn append_overview(prompt: &mut String, overview: &PullRequestOverview) {
    prompt.push_str(&format!("Title: {}\n", overview.title));
    if !overview.body.trim().is_empty() {
        prompt.push_str("Body:\n");
        prompt.push_str(&clip_text(&overview.body, MAX_PR_BODY_CHARS));
        if overview.body.len() > MAX_PR_BODY_CHARS {
            prompt.push_str("\n[Body clipped.]\n");
        }
        prompt.push('\n');
    }
}

fn normalize_walkthrough_files(
    walkthrough: ReviewWalkthrough,
    changed_files: &[String],
    session: &ReviewSession,
) -> Result<ReviewWalkthrough, String> {
    let changed_file_set = changed_files
        .iter()
        .map(String::as_str)
        .collect::<HashSet<_>>();
    let mut seen = HashSet::new();
    let mut groups = Vec::new();

    for group in walkthrough.groups {
        let mut files = Vec::new();
        for mut file in group.files {
            let path = file.path.trim().to_string();
            if path.is_empty() {
                return Err("Generated walkthrough included an empty file path.".to_string());
            }
            if path.contains("..") || path.starts_with('/') {
                return Err(format!(
                    "Generated walkthrough included an invalid file path for {}#{}.",
                    session.repo, session.number
                ));
            }
            if !changed_file_set.contains(path.as_str()) || seen.contains(path.as_str()) {
                continue;
            }

            seen.insert(path.clone());
            file.path = path;
            files.push(file);
        }

        if !files.is_empty() {
            groups.push(ReviewWalkthroughGroup {
                files,
                reason: clean_generated_text(&group.reason, "Review these files together."),
                title: clean_generated_text(&group.title, "Review walkthrough"),
            });
        }
    }

    let missing_files = changed_files
        .iter()
        .filter(|path| !seen.contains(path.as_str()))
        .map(|path| ReviewWalkthroughFile {
            action: ReviewWalkthroughAction::Scan,
            context: "Scan after the primary walkthrough; the generator did not place this file."
                .to_string(),
            path: path.to_string(),
            reason: "Review after the primary walkthrough; the generator did not place this file."
                .to_string(),
            scope: ReviewWalkthroughScope::Local,
        })
        .collect::<Vec<_>>();

    if !missing_files.is_empty() {
        groups.push(ReviewWalkthroughGroup {
            files: missing_files,
            reason: "Files not included in the generated walkthrough.".to_string(),
            title: "Other changed files".to_string(),
        });
    }

    if groups.is_empty() {
        return Err("Generated walkthrough did not include any changed files.".to_string());
    }

    Ok(ReviewWalkthrough {
        groups,
        summary: walkthrough.summary,
    })
}

fn clean_generated_text(value: &str, fallback: &str) -> String {
    let normalized = value
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .trim()
        .to_string();
    if normalized.is_empty() {
        fallback.to_string()
    } else {
        normalized
    }
}

fn clip_text(value: &str, max_chars: usize) -> String {
    if value.len() <= max_chars {
        return value.to_string();
    }

    let mut end = max_chars;
    while !value.is_char_boundary(end) {
        end -= 1;
    }
    value[..end].to_string()
}

#[cfg(test)]
mod tests {
    use super::clip_text;

    #[test]
    fn clip_text_preserves_utf8_boundaries() {
        assert_eq!(clip_text("ab🔥cd", 4), "ab");
    }

    #[test]
    fn clip_text_keeps_short_text() {
        assert_eq!(clip_text("hello", 10), "hello");
    }
}
