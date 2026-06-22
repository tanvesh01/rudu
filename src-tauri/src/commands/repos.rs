use std::collections::HashSet;
use std::thread;

use crate::cache::{read_saved_repos, save_repo_to_cache};
use crate::github::{ensure_user_context_snapshot, run_gh};
use crate::models::{GhRepoDetails, GhSearchRepo, RepoDiscoveryResult, RepoLanguage, RepoSummary};

async fn run_blocking_task<T, F>(task: F) -> Result<T, String>
where
    T: Send + 'static,
    F: FnOnce() -> Result<T, String> + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(task)
        .await
        .map_err(|error| format!("Blocking task failed: {error}"))?
}

#[tauri::command]
pub async fn list_initial_repos(limit: Option<u32>) -> Result<RepoDiscoveryResult, String> {
    run_blocking_task(move || list_initial_repos_sync(limit)).await
}

fn list_initial_repos_sync(limit: Option<u32>) -> Result<RepoDiscoveryResult, String> {
    let limit = limit.unwrap_or(5);
    let user_context = ensure_user_context_snapshot()?;
    let per_owner_limit = per_owner_limit(limit, user_context.owners.len());
    let owner_results = list_owner_repos(&user_context.owners, per_owner_limit);
    let (repos_by_owner, warning) = collect_owner_results(owner_results, user_context.warning);

    let repos = round_robin_repos(repos_by_owner, limit as usize);

    Ok(RepoDiscoveryResult {
        repos: with_contributor_counts(repos),
        warning,
    })
}

#[tauri::command]
pub async fn search_repos(
    query: String,
    limit: Option<u32>,
) -> Result<RepoDiscoveryResult, String> {
    run_blocking_task(move || search_repos_sync(query, limit)).await
}

fn search_repos_sync(query: String, limit: Option<u32>) -> Result<RepoDiscoveryResult, String> {
    let query = query.trim().to_string();
    if query.is_empty() {
        return list_initial_repos_sync(limit);
    }

    let user_context = ensure_user_context_snapshot()?;
    let limit = limit.unwrap_or(20);
    let owner_results = search_owner_repos(&user_context.owners, &query, limit);
    let (repos_by_owner, warning) = collect_owner_results(owner_results, user_context.warning);

    let mut repos = round_robin_repos(repos_by_owner, limit as usize);
    if let Some(exact_repo) = exact_repo_query(&query).and_then(|repo| view_repo(repo).ok()) {
        repos.insert(0, exact_repo);
    }

    let repos = unique_repos(repos, limit as usize);

    Ok(RepoDiscoveryResult {
        repos: with_contributor_counts(repos),
        warning,
    })
}

#[tauri::command]
pub async fn validate_repo(repo: String) -> Result<RepoSummary, String> {
    run_blocking_task(move || validate_repo_sync(repo)).await
}

fn validate_repo_sync(repo: String) -> Result<RepoSummary, String> {
    let repo = repo.trim();

    if repo.split('/').count() != 2 || repo.starts_with('/') || repo.ends_with('/') {
        return Err("Enter a repo as owner/name".into());
    }

    view_repo(repo)
}

#[tauri::command]
pub fn list_saved_repos() -> Result<Vec<RepoSummary>, String> {
    read_saved_repos()
}

#[tauri::command]
pub fn save_repo(repo: RepoSummary) -> Result<RepoSummary, String> {
    save_repo_to_cache(&repo)?;
    Ok(repo)
}

struct OwnerRepoResult {
    repos: Result<Vec<RepoSummary>, String>,
}

fn per_owner_limit(limit: u32, owner_count: usize) -> u32 {
    let owner_count = owner_count.max(1) as u32;
    limit.div_ceil(owner_count).max(1)
}

fn list_owner_repos(owners: &[String], limit: u32) -> Vec<OwnerRepoResult> {
    run_owner_repo_tasks(owners, move |owner| {
        let limit = limit.to_string();
        let stdout = run_gh(&[
            "repo",
            "list",
            owner,
            "--json",
            "name,nameWithOwner,description,isPrivate,languages,stargazerCount,forkCount,issues,pullRequests",
            "--limit",
            &limit,
        ])?;

        let repos = serde_json::from_str::<Vec<GhRepoDetails>>(&stdout)
            .map_err(|error| format!("Failed to parse repos for {owner}: {error}"))?;

        Ok(repos.into_iter().map(repo_from_details).collect())
    })
}

fn search_owner_repos(owners: &[String], query: &str, limit: u32) -> Vec<OwnerRepoResult> {
    let query = query.to_string();
    run_owner_repo_tasks(owners, move |owner| {
        let limit = limit.to_string();
        let stdout = run_gh(&[
            "search",
            "repos",
            &query,
            "--owner",
            owner,
            "--limit",
            &limit,
            "--json",
            "name,fullName,description,isPrivate,language,stargazersCount,forksCount,openIssuesCount",
            "--match",
            "name",
        ])?;

        let search_repos = serde_json::from_str::<Vec<GhSearchRepo>>(&stdout)
            .map_err(|error| format!("Failed to parse search results for {owner}: {error}"))?;

        Ok(search_repos
            .into_iter()
            .map(repo_from_search_result)
            .collect())
    })
}

fn run_owner_repo_tasks<F>(owners: &[String], task: F) -> Vec<OwnerRepoResult>
where
    F: Fn(&str) -> Result<Vec<RepoSummary>, String> + Sync,
{
    thread::scope(|scope| {
        let handles: Vec<_> = owners
            .iter()
            .map(|owner| {
                let owner = owner.clone();
                let task = &task;
                scope.spawn(move || OwnerRepoResult {
                    repos: task(&owner),
                })
            })
            .collect();

        handles
            .into_iter()
            .map(|handle| {
                handle.join().unwrap_or_else(|_| OwnerRepoResult {
                    repos: Err("Failed to load repositories".into()),
                })
            })
            .collect()
    })
}

fn collect_owner_results(
    owner_results: Vec<OwnerRepoResult>,
    context_warning: Option<String>,
) -> (Vec<Vec<RepoSummary>>, Option<String>) {
    let mut repos_by_owner = Vec::new();
    let mut had_repo_load_failure = false;

    for result in owner_results {
        match result.repos {
            Ok(repos) => repos_by_owner.push(repos),
            Err(_) => had_repo_load_failure = true,
        }
    }

    let warning = if had_repo_load_failure {
        Some("Some repositories couldn't be loaded; results may be incomplete.".to_string())
    } else {
        context_warning
    };

    (repos_by_owner, warning)
}

fn round_robin_repos(repos_by_owner: Vec<Vec<RepoSummary>>, limit: usize) -> Vec<RepoSummary> {
    let mut repos = Vec::new();
    let max_owner_repos = repos_by_owner
        .iter()
        .map(|owner_repos| owner_repos.len())
        .max()
        .unwrap_or(0);

    for index in 0..max_owner_repos {
        for owner_repos in &repos_by_owner {
            if repos.len() >= limit {
                return unique_repos(repos, limit);
            }
            if let Some(repo) = owner_repos.get(index) {
                repos.push(repo.clone());
            }
        }
    }

    unique_repos(repos, limit)
}

fn unique_repos(repos: Vec<RepoSummary>, limit: usize) -> Vec<RepoSummary> {
    let mut unique = Vec::new();
    let mut seen = HashSet::new();

    for repo in repos {
        if seen.insert(repo.name_with_owner.clone()) {
            unique.push(repo);
        }
        if unique.len() >= limit {
            break;
        }
    }

    unique
}

fn exact_repo_query(query: &str) -> Option<&str> {
    let (owner, name) = query.split_once('/')?;
    if owner.is_empty()
        || name.is_empty()
        || name.contains('/')
        || query.contains(char::is_whitespace)
    {
        return None;
    }
    Some(query)
}

fn view_repo(repo: &str) -> Result<RepoSummary, String> {
    let stdout = run_gh(&[
        "repo",
        "view",
        repo,
        "--json",
        "name,nameWithOwner,description,isPrivate,languages,stargazerCount,forkCount,issues,pullRequests",
    ])?;

    let details = serde_json::from_str::<GhRepoDetails>(&stdout)
        .map_err(|error| format!("Failed to parse repo details: {error}"))?;
    let mut repo = repo_from_details(details);
    repo.contributor_count = contributor_count(&repo.name_with_owner);

    Ok(repo)
}

fn repo_from_search_result(repo: GhSearchRepo) -> RepoSummary {
    RepoSummary {
        name: repo.name,
        name_with_owner: repo.full_name,
        description: repo.description,
        is_private: repo.is_private,
        languages: repo
            .language
            .map(|name| vec![RepoLanguage { name, size: None }])
            .unwrap_or_default(),
        stargazer_count: repo.stargazers_count,
        fork_count: repo.forks_count,
        issue_count: repo.open_issues_count,
        pull_request_count: None,
        contributor_count: None,
    }
}

fn repo_from_details(repo: GhRepoDetails) -> RepoSummary {
    RepoSummary {
        name: repo.name,
        name_with_owner: repo.name_with_owner,
        description: repo.description,
        is_private: repo.is_private,
        languages: repo
            .languages
            .into_iter()
            .map(|language| RepoLanguage {
                name: language.node.name,
                size: language.size,
            })
            .collect(),
        stargazer_count: repo.stargazer_count,
        fork_count: repo.fork_count,
        issue_count: repo.issues.map(|issues| issues.total_count),
        pull_request_count: repo
            .pull_requests
            .map(|pull_requests| pull_requests.total_count),
        contributor_count: None,
    }
}

fn with_contributor_counts(repos: Vec<RepoSummary>) -> Vec<RepoSummary> {
    repos
        .into_iter()
        .map(|mut repo| {
            if repo.contributor_count.is_none() {
                repo.contributor_count = contributor_count(&repo.name_with_owner);
            }
            repo
        })
        .collect()
}

fn contributor_count(repo: &str) -> Option<u32> {
    let endpoint = format!("repos/{repo}/contributors?per_page=1");
    let response = run_gh(&["api", "-i", &endpoint]).ok()?;

    parse_contributor_count_response(&response)
}

fn parse_contributor_count_response(response: &str) -> Option<u32> {
    if let Some(link) = response
        .lines()
        .find(|line| line.to_ascii_lowercase().starts_with("link:"))
    {
        if let Some(count) = parse_last_page_number(link) {
            return Some(count);
        }
    }

    let body = response
        .split("\r\n\r\n")
        .last()
        .and_then(|body| {
            if body == response {
                response.split("\n\n").last()
            } else {
                Some(body)
            }
        })?
        .trim();
    let contributors = serde_json::from_str::<Vec<serde_json::Value>>(body).ok()?;

    Some(contributors.len() as u32)
}

fn parse_last_page_number(link_header: &str) -> Option<u32> {
    link_header
        .split(',')
        .find(|part| part.contains("rel=\"last\""))
        .and_then(|part| part.split("page=").nth(1))
        .and_then(|page| {
            let digits: String = page
                .chars()
                .take_while(|character| character.is_ascii_digit())
                .collect();
            digits.parse().ok()
        })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn repo(name_with_owner: &str) -> RepoSummary {
        let name = name_with_owner
            .split('/')
            .next_back()
            .unwrap_or(name_with_owner)
            .to_string();

        RepoSummary {
            name,
            name_with_owner: name_with_owner.to_string(),
            description: None,
            is_private: None,
            languages: Vec::new(),
            stargazer_count: None,
            fork_count: None,
            issue_count: None,
            pull_request_count: None,
            contributor_count: None,
        }
    }

    #[test]
    fn per_owner_limit_splits_requested_limit_across_owners() {
        assert_eq!(per_owner_limit(20, 4), 5);
        assert_eq!(per_owner_limit(20, 3), 7);
        assert_eq!(per_owner_limit(20, 0), 20);
    }

    #[test]
    fn round_robin_repos_keeps_visible_orgs_near_the_front() {
        let repos = round_robin_repos(
            vec![
                vec![repo("viewer/a"), repo("viewer/b"), repo("viewer/c")],
                vec![repo("org/one"), repo("org/two")],
            ],
            4,
        );

        let names: Vec<_> = repos.into_iter().map(|repo| repo.name_with_owner).collect();
        assert_eq!(names, vec!["viewer/a", "org/one", "viewer/b", "org/two"]);
    }

    #[test]
    fn unique_repos_prefers_first_occurrence() {
        let repos = unique_repos(
            vec![
                repo("org/project"),
                repo("org/project"),
                repo("viewer/project"),
            ],
            10,
        );

        let names: Vec<_> = repos.into_iter().map(|repo| repo.name_with_owner).collect();
        assert_eq!(names, vec!["org/project", "viewer/project"]);
    }

    #[test]
    fn exact_repo_query_accepts_only_owner_repo_shape() {
        assert_eq!(exact_repo_query("owner/repo"), Some("owner/repo"));
        assert_eq!(exact_repo_query("owner/repo/extra"), None);
        assert_eq!(exact_repo_query("owner /repo"), None);
        assert_eq!(exact_repo_query("owner/"), None);
    }
}
