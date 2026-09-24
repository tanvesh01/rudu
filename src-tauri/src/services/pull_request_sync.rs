use crate::github::run_gh;
use crate::models::PullRequestSummary;

#[derive(Debug)]
pub struct PullRequestSyncInput {
    pub repo: String,
}

impl PullRequestSyncInput {
    pub fn new(repo: String) -> Result<Self, String> {
        let repo = repo.trim().to_string();
        if repo.is_empty() {
            return Err("Repo is required".into());
        }
        Ok(Self { repo })
    }
}

#[derive(Debug)]
pub struct PullRequestSyncResult {
    pub pull_requests: Vec<PullRequestSummary>,
}

pub trait PullRequestSource: Send + Sync {
    fn list_open_pull_requests(&self, repo: &str) -> Result<Vec<PullRequestSummary>, String>;
    fn get_pull_request(&self, repo: &str, number: u32) -> Result<PullRequestSummary, String>;
}

pub trait PullRequestStore: Send + Sync {
    fn write_pull_requests_cache(
        &self,
        repo: &str,
        prs: &[PullRequestSummary],
    ) -> Result<(), String>;
    fn upsert_pull_request_summary(
        &self,
        repo: &str,
        pr: &PullRequestSummary,
    ) -> Result<(), String>;
    fn update_repo_access_timestamp(&self, repo: &str) -> Result<(), String>;
}

pub struct PullRequestSyncService<S: PullRequestSource, T: PullRequestStore> {
    source: S,
    store: T,
}

impl<S: PullRequestSource, T: PullRequestStore> PullRequestSyncService<S, T> {
    pub fn new(source: S, store: T) -> Self {
        Self { source, store }
    }

    pub fn refresh_repo_pull_requests(
        &self,
        input: PullRequestSyncInput,
    ) -> Result<PullRequestSyncResult, String> {
        let pull_requests = self.source.list_open_pull_requests(&input.repo)?;
        self.store
            .write_pull_requests_cache(&input.repo, &pull_requests)?;
        self.store.update_repo_access_timestamp(&input.repo)?;
        Ok(PullRequestSyncResult { pull_requests })
    }

    pub fn refresh_pull_request_summary(
        &self,
        input: PullRequestSyncInput,
        number: u32,
    ) -> Result<PullRequestSummary, String> {
        let pull_request = self.source.get_pull_request(&input.repo, number)?;
        self.store
            .upsert_pull_request_summary(&input.repo, &pull_request)?;
        self.store.update_repo_access_timestamp(&input.repo)?;
        Ok(pull_request)
    }
}

fn to_pull_request_summary(pull_request: crate::models::GhPullRequest) -> PullRequestSummary {
    let merged = pull_request.merged_at.is_some();

    PullRequestSummary {
        core: crate::models::PullRequestCore {
            state: if merged {
                "MERGED".to_string()
            } else {
                pull_request.core.state
            },
            ..pull_request.core
        },
        is_draft: pull_request.is_draft,
        merge_state_status: pull_request
            .merge_state_status
            .unwrap_or_else(|| "UNKNOWN".to_string()),
        mergeable: pull_request
            .mergeable
            .unwrap_or_else(|| "UNKNOWN".to_string()),
        additions: pull_request.additions.unwrap_or(0),
        deletions: pull_request.deletions.unwrap_or(0),
        author_login: pull_request
            .author
            .map(|author| author.login)
            .unwrap_or_else(|| "unknown".into()),
        head_sha: pull_request.head_ref_oid,
        base_sha: pull_request.base_ref_oid,
    }
}

pub struct GhPullRequestSource;

impl PullRequestSource for GhPullRequestSource {
    fn list_open_pull_requests(&self, repo: &str) -> Result<Vec<PullRequestSummary>, String> {
        let stdout = run_gh(&[
            "pr",
            "list",
            "-R",
            repo,
            "--state",
            "open",
            "--limit",
            "100",
            "--json",
            "number,title,state,isDraft,mergeStateStatus,mergeable,additions,deletions,author,updatedAt,url,headRefOid,baseRefOid",
        ])?;

        let pull_requests = serde_json::from_str::<Vec<crate::models::GhPullRequest>>(&stdout)
            .map_err(|error| format!("Failed to parse pull requests: {error}"))?;

        Ok(pull_requests
            .into_iter()
            .map(to_pull_request_summary)
            .collect())
    }

    fn get_pull_request(&self, repo: &str, number: u32) -> Result<PullRequestSummary, String> {
        let stdout = run_gh(&[
            "pr",
            "view",
            &number.to_string(),
            "-R",
            repo,
            "--json",
            "number,title,state,isDraft,mergeStateStatus,mergeable,additions,deletions,author,updatedAt,url,headRefOid,baseRefOid,mergedAt",
        ])?;

        let pull_request = serde_json::from_str::<crate::models::GhPullRequest>(&stdout)
            .map_err(|error| format!("Failed to parse pull request #{number}: {error}"))?;

        Ok(to_pull_request_summary(pull_request))
    }
}

pub struct SqlitePullRequestStore;

impl PullRequestStore for SqlitePullRequestStore {
    fn write_pull_requests_cache(
        &self,
        repo: &str,
        prs: &[PullRequestSummary],
    ) -> Result<(), String> {
        crate::cache::write_pull_requests_cache(repo, prs)
    }

    fn upsert_pull_request_summary(
        &self,
        repo: &str,
        pr: &PullRequestSummary,
    ) -> Result<(), String> {
        crate::cache::upsert_pull_request_summary(repo, pr)
    }

    fn update_repo_access_timestamp(&self, repo: &str) -> Result<(), String> {
        crate::cache::update_repo_access_timestamp(repo)
    }
}

#[cfg(test)]
mod tests {
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::{Arc, Mutex};

    use super::*;

    struct MockSourceInner {
        list_result: Mutex<Result<Vec<PullRequestSummary>, String>>,
        get_result: Mutex<Result<PullRequestSummary, String>>,
        list_called: AtomicBool,
        get_called: AtomicBool,
    }

    #[derive(Clone)]
    struct MockSource {
        inner: Arc<MockSourceInner>,
    }

    impl MockSource {
        fn new() -> Self {
            Self {
                inner: Arc::new(MockSourceInner {
                    list_result: Mutex::new(Ok(Vec::new())),
                    get_result: Mutex::new(Err("not set".into())),
                    list_called: AtomicBool::new(false),
                    get_called: AtomicBool::new(false),
                }),
            }
        }
    }

    impl PullRequestSource for MockSource {
        fn list_open_pull_requests(&self, _repo: &str) -> Result<Vec<PullRequestSummary>, String> {
            self.inner.list_called.store(true, Ordering::SeqCst);
            self.inner.list_result.lock().unwrap().clone()
        }

        fn get_pull_request(
            &self,
            _repo: &str,
            _number: u32,
        ) -> Result<PullRequestSummary, String> {
            self.inner.get_called.store(true, Ordering::SeqCst);
            self.inner.get_result.lock().unwrap().clone()
        }
    }

    struct MockStoreInner {
        write_cache_called: AtomicBool,
        upsert_summary_called: AtomicBool,
        update_timestamp_called: AtomicBool,
        last_written: Mutex<Vec<PullRequestSummary>>,
        last_summary_upserted: Mutex<Vec<PullRequestSummary>>,
    }

    #[derive(Clone)]
    struct MockStore {
        inner: Arc<MockStoreInner>,
    }

    impl MockStore {
        fn new() -> Self {
            Self {
                inner: Arc::new(MockStoreInner {
                    write_cache_called: AtomicBool::new(false),
                    upsert_summary_called: AtomicBool::new(false),
                    update_timestamp_called: AtomicBool::new(false),
                    last_written: Mutex::new(Vec::new()),
                    last_summary_upserted: Mutex::new(Vec::new()),
                }),
            }
        }
    }

    impl PullRequestStore for MockStore {
        fn write_pull_requests_cache(
            &self,
            _repo: &str,
            prs: &[PullRequestSummary],
        ) -> Result<(), String> {
            self.inner.write_cache_called.store(true, Ordering::SeqCst);
            *self.inner.last_written.lock().unwrap() = prs.to_vec();
            Ok(())
        }

        fn upsert_pull_request_summary(
            &self,
            _repo: &str,
            pr: &PullRequestSummary,
        ) -> Result<(), String> {
            self.inner
                .upsert_summary_called
                .store(true, Ordering::SeqCst);
            self.inner
                .last_summary_upserted
                .lock()
                .unwrap()
                .push(pr.clone());
            Ok(())
        }

        fn update_repo_access_timestamp(&self, _repo: &str) -> Result<(), String> {
            self.inner
                .update_timestamp_called
                .store(true, Ordering::SeqCst);
            Ok(())
        }
    }

    fn make_pr(number: u32, state: &str, title: &str) -> PullRequestSummary {
        PullRequestSummary {
            core: crate::models::PullRequestCore {
                number,
                title: title.into(),
                state: state.into(),
                updated_at: "2025-01-01T00:00:00Z".into(),
                url: format!("https://github.com/owner/repo/pull/{number}"),
            },
            is_draft: false,
            merge_state_status: "CLEAN".into(),
            mergeable: "MERGEABLE".into(),
            additions: 10,
            deletions: 5,
            author_login: "testuser".into(),
            head_sha: "abc123".into(),
            base_sha: Some("def456".into()),
        }
    }

    #[test]
    fn refresh_repo_writes_cache_and_updates_timestamp() {
        let source = MockSource::new();
        let prs = vec![make_pr(1, "OPEN", "feat: foo")];
        *source.inner.list_result.lock().unwrap() = Ok(prs.clone());

        let store = MockStore::new();
        let store_clone = store.clone();
        let service = PullRequestSyncService::new(source, store);
        let input = PullRequestSyncInput::new("owner/repo".into()).unwrap();

        let result = service.refresh_repo_pull_requests(input).unwrap();
        assert_eq!(result.pull_requests.len(), 1);
        assert_eq!(result.pull_requests[0].core.number, 1);
        assert!(store_clone.inner.write_cache_called.load(Ordering::SeqCst));
        assert!(store_clone
            .inner
            .update_timestamp_called
            .load(Ordering::SeqCst));
        assert_eq!(store_clone.inner.last_written.lock().unwrap().len(), 1);
    }

    #[test]
    fn source_error_propagates_without_cache_write() {
        let source = MockSource::new();
        *source.inner.list_result.lock().unwrap() = Err("gh failed".into());

        let store = MockStore::new();
        let store_clone = store.clone();
        let service = PullRequestSyncService::new(source, store);
        let input = PullRequestSyncInput::new("owner/repo".into()).unwrap();

        let result = service.refresh_repo_pull_requests(input);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("gh failed"));
        assert!(!store_clone.inner.write_cache_called.load(Ordering::SeqCst));
    }

    #[test]
    fn empty_repo_fails() {
        let result = PullRequestSyncInput::new("   ".into());
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("Repo"));
    }

    #[test]
    fn summary_refresh_fetches_single_pr_and_updates_cache() {
        let source = MockSource::new();
        *source.inner.get_result.lock().unwrap() = Ok(make_pr(7, "OPEN", "feat: selected"));

        let store = MockStore::new();
        let store_clone = store.clone();
        let service = PullRequestSyncService::new(source, store);
        let input = PullRequestSyncInput::new("owner/repo".into()).unwrap();

        let result = service.refresh_pull_request_summary(input, 7).unwrap();
        assert_eq!(result.core.number, 7);
        assert!(store_clone
            .inner
            .upsert_summary_called
            .load(Ordering::SeqCst));
        assert!(store_clone
            .inner
            .update_timestamp_called
            .load(Ordering::SeqCst));

        let upserted = store_clone.inner.last_summary_upserted.lock().unwrap();
        assert_eq!(upserted.len(), 1);
        assert_eq!(upserted[0].core.title, "feat: selected");
    }
}
