//! `rudu session <action> ...` — CLI client for the running app's session server.

use serde_json::{json, Value};

use crate::services::session_server::call_session_server;

/// Path of the review skill, embedded so `rudu skill path` works from the installed app.
const SKILL_MARKDOWN: &str = include_str!("../../skills/rudu/SKILL.md");

pub fn run_session_command(args: &[String]) -> Result<String, String> {
    let request = parse_session_args(args)?;
    call_session_server(&request)
}

pub fn run_skill_path() -> Result<String, String> {
    let path = std::env::temp_dir().join("rudu-skill.md");
    std::fs::write(&path, SKILL_MARKDOWN)
        .map_err(|error| format!("Could not write {}: {error}", path.display()))?;
    Ok(path.to_string_lossy().to_string())
}

fn parse_session_args(args: &[String]) -> Result<Value, String> {
    let mut positional: Vec<&str> = Vec::new();
    let mut flags: Vec<(&str, Option<&str>)> = Vec::new();
    let mut index = 0;
    while index < args.len() {
        let arg = args[index].as_str();
        if let Some(flag) = arg.strip_prefix("--") {
            let next = args.get(index + 1).map(String::as_str);
            match next {
                Some(value) if !value.starts_with("--") => {
                    flags.push((flag, Some(value)));
                    index += 2;
                }
                _ => {
                    flags.push((flag, None));
                    index += 1;
                }
            }
        } else {
            positional.push(arg);
            index += 1;
        }
    }

    let get_flag = |name: &str| -> Option<&str> {
        flags
            .iter()
            .find(|(flag, _)| *flag == name)
            .and_then(|(_, value)| *value)
    };
    let has_flag = |name: &str| flags.iter().any(|(flag, _)| *flag == name);
    let repo = get_flag("repo").map(|value| json!(value));

    let mut request = match positional.as_slice() {
        ["list"] => json!({"action": "list"}),
        ["review"] => json!({
            "action": "review",
            "includePatch": has_flag("include-patch"),
        }),
        ["navigate"] => json!({
            "action": "navigate",
            "file": get_flag("file"),
            "newLine": get_flag("new-line").and_then(|value| value.parse::<u32>().ok()),
            "oldLine": get_flag("old-line").and_then(|value| value.parse::<u32>().ok()),
        }),
        ["comment", "add"] => json!({
            "action": "comment-add",
            "file": get_flag("file"),
            "newLine": get_flag("new-line").and_then(|value| value.parse::<u32>().ok()),
            "oldLine": get_flag("old-line").and_then(|value| value.parse::<u32>().ok()),
            "body": get_flag("body"),
        }),
        ["comment", "list"] => json!({
            "action": "comment-list",
            "file": get_flag("file"),
            "type": get_flag("type"),
        }),
        _ => {
            return Err(
                "Usage: rudu session list | review | navigate | comment add | comment list\n\
                 Run `rudu skill path` for the full agent workflow."
                    .to_string(),
            )
        }
    };

    if has_flag("new-line") && has_flag("old-line") {
        return Err("Use exactly one of --new-line or --old-line.".to_string());
    }
    if let Some(object) = request.as_object_mut() {
        object.retain(|_, value| !value.is_null());
        if let Some(repo) = repo {
            object.insert("repo".to_string(), repo);
        }
    }
    Ok(request)
}

#[cfg(test)]
mod tests {
    use super::parse_session_args;

    fn args(values: &[&str]) -> Vec<String> {
        values.iter().map(|value| value.to_string()).collect()
    }

    #[test]
    fn parses_comment_add_with_repo() {
        let request = parse_session_args(&args(&[
            "comment",
            "add",
            "--repo",
            ".",
            "--file",
            "src/main.rs",
            "--new-line",
            "42",
            "--body",
            "why?",
        ]))
        .expect("parse comment add");
        assert_eq!(
            request,
            serde_json::json!({
                "action": "comment-add",
                "file": "src/main.rs",
                "newLine": 42,
                "body": "why?",
                "repo": ".",
            })
        );
    }

    #[test]
    fn parses_comment_add_with_old_line() {
        let request = parse_session_args(&args(&[
            "comment",
            "add",
            "--file",
            "src/main.rs",
            "--old-line",
            "11",
            "--body",
            "reply",
        ]))
        .expect("parse deletion comment");
        assert_eq!(
            request,
            serde_json::json!({
                "action": "comment-add",
                "file": "src/main.rs",
                "oldLine": 11,
                "body": "reply",
            })
        );
    }

    #[test]
    fn rejects_both_diff_sides() {
        assert!(parse_session_args(&args(&[
            "comment",
            "add",
            "--new-line",
            "1",
            "--old-line",
            "1",
        ]))
        .is_err());
    }

    #[test]
    fn parses_review_include_patch_flag() {
        let request =
            parse_session_args(&args(&["review", "--include-patch"])).expect("parse review");
        assert_eq!(
            request,
            serde_json::json!({"action": "review", "includePatch": true})
        );
    }

    #[test]
    fn rejects_unknown_verbs() {
        assert!(parse_session_args(&args(&["frobnicate"])).is_err());
    }
}
