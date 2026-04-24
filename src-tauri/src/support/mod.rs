pub fn parse_repo(repo: &str) -> Result<(&str, &str), String> {
    let repo = repo.trim();
    repo.split_once('/')
        .ok_or_else(|| "Repo must be in owner/name format".to_string())
}

pub fn now_unix_timestamp() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_secs() as i64)
        .unwrap_or(0)
}

pub fn bool_to_sql(value: Option<bool>) -> Option<i64> {
    value.map(|item| if item { 1 } else { 0 })
}

pub fn sql_to_bool(value: Option<i64>) -> Option<bool> {
    value.map(|item| item != 0)
}
