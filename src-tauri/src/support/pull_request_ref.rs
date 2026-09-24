pub fn parse_pull_request_ref(input: &str) -> Result<(String, u32), String> {
    let input = input.trim();
    if input.is_empty() {
        return Err("Pull request must be a GitHub URL or owner/repo#number.".to_string());
    }

    const GITHUB_PREFIXES: &[&str] = &[
        "https://github.com/",
        "http://github.com/",
        "https://www.github.com/",
        "http://www.github.com/",
        "github.com/",
        "www.github.com/",
    ];
    if let Some(path) = GITHUB_PREFIXES
        .iter()
        .find_map(|prefix| input.strip_prefix(prefix))
    {
        let path = path.trim_end_matches('/');
        let parts = path.split('/').collect::<Vec<_>>();
        if parts.len() >= 4 && parts[2] == "pull" {
            return parsed_ref(
                parts[0],
                parts[1],
                parts[3].split(['?', '#']).next().unwrap_or(""),
            );
        }
        return Err("Pull request URL must look like github.com/owner/repo/pull/123.".to_string());
    }

    let Some((repo, number)) = input.rsplit_once('#') else {
        return Err("Pull request must be a GitHub URL or owner/repo#number.".to_string());
    };
    let Some((owner, name)) = repo.split_once('/') else {
        return Err("Pull request shorthand must look like owner/repo#123.".to_string());
    };
    parsed_ref(owner, name, number)
}

fn parsed_ref(owner: &str, repo: &str, number: &str) -> Result<(String, u32), String> {
    if owner.is_empty() || repo.is_empty() || repo.contains('/') {
        return Err("Repository must be in owner/repo format.".to_string());
    }
    let number = number
        .parse::<u32>()
        .ok()
        .filter(|number| *number > 0)
        .ok_or_else(|| "Pull request number must be a positive integer.".to_string())?;
    Ok((format!("{owner}/{repo}"), number))
}

#[cfg(test)]
mod tests {
    use super::parse_pull_request_ref;

    #[test]
    fn parses_github_urls_and_shorthand() {
        for input in [
            "https://github.com/outerworld/rudu/pull/42",
            "http://www.github.com/outerworld/rudu/pull/42/",
            "github.com/outerworld/rudu/pull/42?diff=split",
            "https://github.com/outerworld/rudu/pull/42/files",
            "outerworld/rudu#42",
        ] {
            assert_eq!(
                parse_pull_request_ref(input).unwrap(),
                ("outerworld/rudu".to_string(), 42)
            );
        }
    }

    #[test]
    fn rejects_non_pr_refs() {
        for input in [
            "",
            "42",
            "outerworld/rudu#0",
            "outerworld/rudu#nope",
            "outerworld/extra/rudu#42",
            "github.com/outerworld/rudu/issues/42",
            "https://example.com/outerworld/rudu/pull/42",
        ] {
            assert!(parse_pull_request_ref(input).is_err(), "accepted {input}");
        }
    }
}
