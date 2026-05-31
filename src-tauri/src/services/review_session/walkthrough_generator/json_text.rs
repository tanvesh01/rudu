use crate::models::ReviewWalkthrough;

pub(super) fn parse_with_repair<F>(
    raw_output: &str,
    mut repair: F,
) -> Result<ReviewWalkthrough, String>
where
    F: FnMut(&str, &str) -> Result<String, String>,
{
    match parse_walkthrough(raw_output) {
        Ok(walkthrough) => Ok(walkthrough),
        Err(initial_error) => {
            let repair_output = repair(raw_output, &initial_error)
                .map_err(|error| format!("OpenCode walkthrough repair retry failed: {error}"))?;
            parse_walkthrough(&repair_output).map_err(|repair_error| {
                format!(
                    "OpenCode walkthrough repair output was invalid: {repair_error}. Initial output error: {initial_error}"
                )
            })
        }
    }
}

fn parse_walkthrough(raw_output: &str) -> Result<ReviewWalkthrough, String> {
    let json = extract_json_object(raw_output)?;
    serde_json::from_str::<ReviewWalkthrough>(&json)
        .map_err(|error| format!("JSON did not match the walkthrough shape: {error}"))
}

fn extract_json_object(raw_output: &str) -> Result<String, String> {
    for (start, char_value) in raw_output.char_indices() {
        if char_value != '{' {
            continue;
        }
        let Some(candidate) = balanced_json_object_candidate(raw_output, start) else {
            continue;
        };
        if serde_json::from_str::<serde_json::Value>(&candidate).is_ok() {
            return Ok(candidate);
        }
    }

    Err("Could not extract a valid JSON object from OpenCode text output.".to_string())
}

fn balanced_json_object_candidate(raw_output: &str, start: usize) -> Option<String> {
    let mut depth = 0usize;
    let mut in_string = false;
    let mut escaped = false;

    for (relative_index, char_value) in raw_output[start..].char_indices() {
        if in_string {
            if escaped {
                escaped = false;
                continue;
            }
            match char_value {
                '\\' => escaped = true,
                '"' => in_string = false,
                _ => {}
            }
            continue;
        }

        match char_value {
            '"' => in_string = true,
            '{' => depth += 1,
            '}' => {
                depth = depth.saturating_sub(1);
                if depth == 0 {
                    let end = start + relative_index + char_value.len_utf8();
                    return Some(raw_output[start..end].to_string());
                }
            }
            _ => {}
        }
    }

    None
}

#[cfg(test)]
mod tests {
    use std::cell::Cell;

    use super::{extract_json_object, parse_with_repair};

    const VALID_WALKTHROUGH: &str = r#"{
      "summary": { "focus": "Review data flow", "skim": "Generated files" },
      "groups": [
        {
          "title": "Review carefully",
          "reason": "Shared behavior",
          "files": [
            {
              "path": "src/lib.rs",
              "action": "review",
              "scope": "shared",
              "reason": "Public interface",
              "context": "Check contract"
            }
          ]
        }
      ]
    }"#;

    #[test]
    fn extracts_plain_json_object() {
        assert_eq!(
            extract_json_object(r#"{"ok":true}"#).unwrap(),
            r#"{"ok":true}"#
        );
    }

    #[test]
    fn extracts_fenced_json_object() {
        let raw = "```json\n{\"ok\":true}\n```";
        assert_eq!(extract_json_object(raw).unwrap(), r#"{"ok":true}"#);
    }

    #[test]
    fn extracts_prose_wrapped_json_object() {
        let raw = "Here is the walkthrough:\n{\"ok\":true}\nDone.";
        assert_eq!(extract_json_object(raw).unwrap(), r#"{"ok":true}"#);
    }

    #[test]
    fn extracts_json_with_nested_braces() {
        let raw = r#"ignore {not json} then {"outer":{"inner":"watch {this}"}}"#;
        assert_eq!(
            extract_json_object(raw).unwrap(),
            r#"{"outer":{"inner":"watch {this}"}}"#
        );
    }

    #[test]
    fn rejects_output_without_json_object() {
        assert!(extract_json_object("no json here").is_err());
    }

    #[test]
    fn repair_retry_runs_once_after_invalid_initial_output() {
        let calls = Cell::new(0);
        let walkthrough = parse_with_repair("not json", |raw, error| {
            calls.set(calls.get() + 1);
            assert_eq!(raw, "not json");
            assert!(error.contains("Could not extract"));
            Ok(VALID_WALKTHROUGH.to_string())
        })
        .unwrap();

        assert_eq!(calls.get(), 1);
        assert_eq!(walkthrough.groups[0].files[0].path, "src/lib.rs");
    }

    #[test]
    fn repair_retry_is_skipped_for_valid_output() {
        let calls = Cell::new(0);
        let walkthrough = parse_with_repair(VALID_WALKTHROUGH, |_, _| {
            calls.set(calls.get() + 1);
            Ok(VALID_WALKTHROUGH.to_string())
        })
        .unwrap();

        assert_eq!(calls.get(), 0);
        assert_eq!(walkthrough.summary.focus, "Review data flow");
    }
}
