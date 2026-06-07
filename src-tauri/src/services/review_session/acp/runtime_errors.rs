use serde_json::Value;

pub(super) fn runtime_error_from_stderr_line(line: &str) -> Option<String> {
    if !line.contains("service=llm") && !line.contains("AI_APICallError") {
        return None;
    }

    let provider = token_after(line, "providerID=");
    let model = token_after(line, "modelID=");
    let model_label = provider
        .as_deref()
        .zip(model.as_deref())
        .map(|(provider, model)| format!("{provider}/{model}"))
        .or(model);

    let detail = extract_error_json(line)
        .and_then(|json| serde_json::from_str::<Value>(json).ok())
        .and_then(|value| runtime_error_detail_from_json(&value))
        .or_else(|| token_after(line, "error="));

    match (model_label, detail) {
        (Some(model), Some(detail)) => Some(format!("{model} failed: {detail}")),
        (Some(model), None) => Some(format!("{model} failed.")),
        (None, Some(detail)) => Some(detail),
        (None, None) => None,
    }
}

fn token_after(line: &str, marker: &str) -> Option<String> {
    let start = line.find(marker)? + marker.len();
    let token = line[start..]
        .split_whitespace()
        .next()
        .unwrap_or_default()
        .trim_matches(|character| character == ',' || character == ';')
        .trim();
    (!token.is_empty()).then(|| token.to_string())
}

fn extract_error_json(line: &str) -> Option<&str> {
    let start = line.find("error=")? + "error=".len();
    let json = &line[start..];
    let mut in_string = false;
    let mut escaped = false;
    let mut depth = 0usize;
    let mut object_start = None;

    for (index, character) in json.char_indices() {
        if object_start.is_none() {
            if character == '{' {
                object_start = Some(index);
                depth = 1;
            }
            continue;
        }

        if escaped {
            escaped = false;
            continue;
        }

        if character == '\\' && in_string {
            escaped = true;
            continue;
        }

        if character == '"' {
            in_string = !in_string;
            continue;
        }

        if in_string {
            continue;
        }

        match character {
            '{' => depth += 1,
            '}' => {
                depth = depth.saturating_sub(1);
                if depth == 0 {
                    let start = object_start?;
                    return Some(&json[start..=index]);
                }
            }
            _ => {}
        }
    }

    None
}

fn runtime_error_detail_from_json(value: &Value) -> Option<String> {
    find_string_key(value, "responseBody")
        .and_then(|body| {
            serde_json::from_str::<Value>(body)
                .ok()
                .and_then(|body| find_string_key(&body, "error").map(ToOwned::to_owned))
                .or_else(|| Some(body.to_string()))
        })
        .or_else(|| find_string_key(value, "message").map(ToOwned::to_owned))
        .map(|message| message.trim().to_string())
        .filter(|message| !message.is_empty())
}

fn find_string_key<'a>(value: &'a Value, key: &str) -> Option<&'a str> {
    match value {
        Value::Object(object) => object.get(key).and_then(Value::as_str).or_else(|| {
            object
                .values()
                .find_map(|value| find_string_key(value, key))
        }),
        Value::Array(values) => values.iter().find_map(|value| find_string_key(value, key)),
        _ => None,
    }
}
