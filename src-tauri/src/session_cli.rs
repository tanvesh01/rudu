//! `rudu session <action> ...` — CLI client for the running app's session server.

use std::path::Path;

use crate::services::session_server::{call_session_server, SessionAction, SessionRequest};
use crate::support::parse_pull_request_ref;

/// Path of the review skill, embedded so `rudu skill path` works from the installed app.
const SKILL_MARKDOWN: &str = include_str!("../../skills/rudu/SKILL.md");

pub fn run_session_command(args: &[String]) -> Result<String, String> {
    let mut request = parse_session_args(args)?;
    absolutize_repo(
        &mut request,
        &std::env::current_dir().map_err(|error| error.to_string())?,
    );
    call_session_server(&request)
}

pub fn run_skill_path() -> Result<String, String> {
    let path = std::env::temp_dir().join("rudu-skill.md");
    std::fs::write(&path, SKILL_MARKDOWN)
        .map_err(|error| format!("Could not write {}: {error}", path.display()))?;
    Ok(path.to_string_lossy().to_string())
}

fn absolutize_repo(request: &mut SessionRequest, cwd: &Path) {
    let Some(repo) = request.repo.as_deref() else {
        return;
    };
    let repo = Path::new(repo);
    if repo.is_relative() {
        request.repo = Some(cwd.join(repo).to_string_lossy().to_string());
    }
}

fn parse_session_args(args: &[String]) -> Result<SessionRequest, String> {
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
    let get_flags = |name: &str| -> Vec<String> {
        flags
            .iter()
            .filter_map(|(flag, value)| (*flag == name).then_some(*value).flatten())
            .map(str::to_string)
            .collect()
    };
    let has_flag = |name: &str| flags.iter().any(|(flag, _)| *flag == name);
    let repo = get_flag("repo").map(str::to_string);
    let pr = get_flag("pr").map(str::to_string);
    if (has_flag("repo") && repo.is_none()) || (has_flag("pr") && pr.is_none()) {
        return Err("--repo and --pr require a value.".to_string());
    }
    if repo.is_some() && pr.is_some() {
        return Err("Use --repo or --pr, but not both.".to_string());
    }
    if let Some(pr) = pr.as_deref() {
        parse_pull_request_ref(pr)?;
    }
    let line = |name: &str| get_flag(name).and_then(|value| value.parse().ok());
    let note_ids = get_flags("note");
    let delete_all = has_flag("all");

    if matches!(positional.as_slice(), ["note", "add"] | ["note", "reply"])
        && get_flag("author").is_none_or(|author| author.trim().is_empty())
    {
        return Err("note add and note reply require --author <name>.".to_string());
    }
    if matches!(
        positional.as_slice(),
        ["note", "delete"] | ["comment", "delete"]
    ) && ((note_ids.is_empty() && !delete_all) || (!note_ids.is_empty() && delete_all))
    {
        return Err("Use one or more --note IDs or --all, but not both.".to_string());
    }
    if has_flag("new-line") && has_flag("old-line") {
        return Err("Use exactly one of --new-line or --old-line.".to_string());
    }

    let action = match positional.as_slice() {
        ["list"] => SessionAction::List,
        ["review"] => SessionAction::Review,
        ["navigate"] => SessionAction::Navigate,
        ["note", "add"] => SessionAction::NoteAdd,
        ["note", "reply"] => SessionAction::NoteReply,
        ["note", "delete"] => SessionAction::NoteDelete,
        ["note", "list"] => SessionAction::NoteList,
        ["note", "promote"] => SessionAction::NotePromote,
        ["comment", "draft"] => SessionAction::CommentDraft,
        ["comment", "delete"] => SessionAction::CommentDelete,
        ["comment", "list"] => SessionAction::CommentList,
        ["comment", "publish"] => SessionAction::CommentPublish,
        _ => {
            return Err(
                "Usage: rudu session list | review | navigate | note add | note reply | note delete | note list | note promote | comment draft | comment delete | comment list | comment publish\n\
                 Run `rudu skill path` for the full agent workflow."
                    .to_string(),
            )
        }
    };
    Ok(SessionRequest {
        action,
        repo,
        pr,
        file: get_flag("file").map(str::to_string),
        new_line: line("new-line"),
        old_line: line("old-line"),
        body: get_flag("body").map(str::to_string),
        note: get_flag("note").map(str::to_string),
        author: get_flag("author").map(str::to_string),
        notes: note_ids,
        all: delete_all,
        include_patch: has_flag("include-patch"),
        note_type: get_flag("type").map(str::to_string),
    })
}

#[cfg(test)]
mod tests {
    use std::path::Path;

    use super::{absolutize_repo, parse_session_args, SessionAction, SessionRequest};

    fn parse(values: &[&str]) -> SessionRequest {
        parse_session_args(
            &values
                .iter()
                .map(|value| value.to_string())
                .collect::<Vec<_>>(),
        )
        .expect("parse session action")
    }

    #[test]
    fn parses_session_actions() {
        let add = parse(&[
            "note",
            "add",
            "--repo",
            ".",
            "--file",
            "src/main.rs",
            "--new-line",
            "42",
            "--body",
            "why?",
            "--author",
            "Pi",
        ]);
        assert_eq!(add.action, SessionAction::NoteAdd);
        assert_eq!(add.repo.as_deref(), Some("."));
        assert_eq!(add.file.as_deref(), Some("src/main.rs"));
        assert_eq!(add.new_line, Some(42));
        assert_eq!(add.body.as_deref(), Some("why?"));
        assert_eq!(add.author.as_deref(), Some("Pi"));
        assert_eq!(serde_json::to_value(add).unwrap()["action"], "note-add");

        let reply = parse(&[
            "note", "reply", "--note", "note-1", "--body", "because", "--author", "Pi",
        ]);
        assert_eq!(reply.action, SessionAction::NoteReply);
        assert_eq!(reply.note.as_deref(), Some("note-1"));

        let selected = parse(&["note", "delete", "--note", "one", "--note", "two"]);
        assert_eq!(selected.notes, ["one", "two"]);
        assert!(!selected.all);

        let all = parse(&["note", "delete", "--all"]);
        assert!(all.notes.is_empty());
        assert!(all.all);
        assert_eq!(
            parse(&["comment", "delete", "--all"]).action,
            SessionAction::CommentDelete
        );

        let old_line = parse(&["note", "add", "--old-line", "11", "--author", "Pi"]);
        assert_eq!(old_line.old_line, Some(11));

        let review = parse(&["review", "--include-patch"]);
        assert_eq!(review.action, SessionAction::Review);
        assert!(review.include_patch);

        let pull_request = parse(&["review", "--pr", "outerworld/rudu#42"]);
        assert_eq!(pull_request.pr.as_deref(), Some("outerworld/rudu#42"));

        assert_eq!(
            parse(&["comment", "publish"]).action,
            SessionAction::CommentPublish
        );
    }

    #[test]
    fn resolves_relative_repo_from_the_callers_working_directory() {
        let mut request = parse(&["review", "--repo", "."]);

        absolutize_repo(&mut request, Path::new("/tmp/caller-repo"));

        assert_eq!(request.repo.as_deref(), Some("/tmp/caller-repo/."));
    }

    #[test]
    fn rejects_invalid_actions() {
        let error = |values: &[&str]| {
            parse_session_args(
                &values
                    .iter()
                    .map(|value| value.to_string())
                    .collect::<Vec<_>>(),
            )
            .is_err()
        };
        assert!(error(&["note", "add", "--body", "missing author"]));
        assert!(error(&[
            "note",
            "reply",
            "--note",
            "note-1",
            "--body",
            "missing author",
        ]));
        assert!(error(&["note", "delete"]));
        assert!(error(&["note", "delete", "--note", "note-1", "--all"]));
        assert!(error(&[
            "note",
            "add",
            "--new-line",
            "1",
            "--old-line",
            "1"
        ]));
        assert!(error(&["review", "--repo"]));
        assert!(error(&["review", "--pr"]));
        assert!(error(&["review", "--pr", "not-a-pr"]));
        assert!(error(&[
            "review",
            "--repo",
            ".",
            "--pr",
            "outerworld/rudu#42",
        ]));
        assert!(error(&["frobnicate"]));
    }
}
